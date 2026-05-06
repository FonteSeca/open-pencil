import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

import SYSTEM_PROMPT from '@/ai/system-prompt.md?raw'
import { decodeTauriStderr } from '@/utils/tauri'

import { mapUpdate } from './acp-map-update'
import { addAutomationListener, sendAutomationMessage } from '@/automation/server'
import { IS_TAURI } from '@open-pencil/core'

import type {
  Client,
  Agent,
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse
} from '@agentclientprotocol/sdk'
import type { ACPAgentDef } from '@open-pencil/core'
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

type SpawnerChild = {
  write(data: number[] | string): Promise<void>
  kill(): Promise<void>
  onExit?: (code: number) => void
}

interface ACPSession {
  connection: ClientSideConnection
  sessionId: string
  child: SpawnerChild
  onUpdate: ((params: SessionNotification) => void) | null
  onExit: ((code: number) => void) | null
  dead: boolean
}

function isMissingCommandError(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('enoent') || normalized.includes('program not found')
}

function missingCommandMessage(agentDef?: ACPAgentDef): string {
  if (!agentDef) return 'ACP agent CLI is not installed.'
  if (!agentDef.installCommand) {
    return `"${agentDef.command}" is not installed. Install it and restart OpenPencil.`
  }
  return `"${agentDef.command}" is not installed. Install it with: ${agentDef.installCommand}`
}

export function formatConnectionError(e: unknown, agentDef?: ACPAgentDef): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (
    msg.includes('ECONNREFUSED') ||
    msg.includes('fetch failed') ||
    msg.includes('Failed to fetch')
  ) {
    return 'MCP server is not running. Make sure the editor is open.'
  }
  if (msg.includes('timeout') || msg.includes('Timeout') || msg.includes('ETIMEDOUT')) {
    return 'MCP server did not respond in time.'
  }
  if (isMissingCommandError(msg)) {
    return missingCommandMessage(agentDef)
  }
  return msg
}

export function buildCrashChunks(
  destroying: boolean,
  textId: string,
  textStarted: boolean
): { chunks: UIMessageChunk[]; shouldNullSession: boolean } {
  if (destroying) return { chunks: [], shouldNullSession: false }
  const chunks: UIMessageChunk[] = []
  if (textStarted) chunks.push({ type: 'text-end', id: textId })
  chunks.push({ type: 'error', errorText: 'Agent process exited unexpectedly.' })
  chunks.push({ type: 'finish-step' })
  chunks.push({ type: 'finish', finishReason: 'error' })
  return { chunks, shouldNullSession: true }
}

interface ACPDebugEntry {
  ts: number
  type: string
  data: unknown
}

const MAX_LOG_AGE_MS = 5 * 60 * 1000
const IS_DEV = import.meta.env.DEV

export const acpDebugLog: ACPDebugEntry[] = []

function pruneOldEntries() {
  const cutoff = Date.now() - MAX_LOG_AGE_MS
  while (acpDebugLog.length > 0 && acpDebugLog[0].ts < cutoff) {
    acpDebugLog.shift()
  }
}

export function getAcpDebugText(): string {
  pruneOldEntries()
  return acpDebugLog
    .map((e) => `[${new Date(e.ts).toISOString()}] ${e.type}\n${JSON.stringify(e.data, null, 2)}`)
    .join('\n\n---\n\n')
}

export function clearAcpDebugLog() {
  acpDebugLog.length = 0
}

export function hasAcpDebugEntries(): boolean {
  pruneOldEntries()
  return acpDebugLog.length > 0
}

export class ACPChatTransport implements ChatTransport<UIMessage> {
  private session: ACPSession | null = null
  private agentDef: ACPAgentDef
  private cwd: string
  private sentContext = false
  private destroying = false

  constructor(options: { agentDef: ACPAgentDef; cwd?: string }) {
    this.agentDef = options.agentDef
    this.cwd = options.cwd ?? '.'
  }

  async sendMessages({
    messages,
    abortSignal
  }: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
    const text =
      lastUserMessage?.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n') ?? ''

    if (this.session?.dead) {
      this.session = null
    }

    if (!this.session) {
      this.session = IS_TAURI && !this.agentDef.mcp ? await this.spawnAgent() : await this.spawnAgentProxy()
    }

    const promptText = this.sentContext ? text : `${SYSTEM_PROMPT}\n\n${text}`
    this.sentContext = true

    const { connection, sessionId } = this.session
    const session = this.session

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        const baseId = Date.now().toString(36) + '-' + crypto.getRandomValues(new Uint32Array(1))[0].toString(36)
        let textStarted = false
        let reasoningStarted = false
        let partCounter = 0
        let currentTextId = ''
        let currentReasoningId = ''
        const seenToolCalls = new Set<string>()
        let closed = false

        function finish(reason: 'stop' | 'other' | 'error', errorText?: string) {
          if (closed) return
          closed = true
          if (errorText) controller.enqueue({ type: 'error', errorText })
          if (reasoningStarted) {
            controller.enqueue({ type: 'reasoning-end', id: currentReasoningId })
            reasoningStarted = false
          }
          if (textStarted) {
            controller.enqueue({ type: 'text-end', id: currentTextId })
            textStarted = false
          }
          controller.enqueue({ type: 'finish-step' })
          controller.enqueue({ type: 'finish', finishReason: reason })
          session.onUpdate = null
          controller.close()
        }

        session.onUpdate = (params) => {
          if (closed) return
          if (IS_DEV) {
            acpDebugLog.push({
              ts: Date.now(),
              type: params.update.sessionUpdate,
              data: params.update
            })
          }
          const result = mapUpdate(
            params.update,
            baseId,
            textStarted,
            reasoningStarted,
            partCounter,
            currentTextId,
            currentReasoningId,
            seenToolCalls
          )
          textStarted = result.textStarted
          reasoningStarted = result.reasoningStarted
          partCounter = result.partCounter
          currentTextId = result.currentTextId
          currentReasoningId = result.currentReasoningId

          if (closed) return
          if (IS_DEV && result.chunks.length > 0) {
            console.log(`[ACP] Enqueuing ${result.chunks.length} chunks for ${params.update.sessionUpdate}`)
          }
          for (const chunk of result.chunks) {
            try {
              if (!closed) controller.enqueue(chunk)
            } catch (e) {
              console.warn('[ACP] Failed to enqueue chunk (stream probably closed):', e)
              break
            }
          }
        }

        abortSignal?.addEventListener('abort', () => {
          void connection.cancel({ sessionId })
          finish('stop')
        })

        session.onExit = (code) => {
          finish(code === 0 ? 'stop' : 'error', code === 0 ? undefined : `Agent process exited with code ${code}`)
        }

        if (IS_DEV) console.log('[ACP] Enqueuing start / start-step')
        controller.enqueue({ type: 'start' })
        controller.enqueue({ type: 'start-step' })

        connection
          .prompt({
            sessionId,
            prompt: [{ type: 'text', text: promptText }]
          })
          .catch((e) => {
            console.error('[ACP] Prompt failed:', e)
            finish('error', formatConnectionError(e, this.agentDef))
          })
      }
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  async destroy(): Promise<void> {
    this.destroying = true
    if (this.session) {
      await this.session.child.kill()
      this.session = null
    }
  }

  private async spawnAgent(): Promise<ACPSession> {
    const { Command } = await import('@tauri-apps/plugin-shell')

    const command = Command.create(this.agentDef.command, this.agentDef.args, {
      encoding: 'raw'
    })

    const stdoutChunks: Uint8Array[] = []
    let stdoutResolver: ((chunk: Uint8Array | null) => void) | null = null
    let stdoutClosed = false
    let stdoutClosedError: Error | null = null

    command.stdout.on('data', (raw: Uint8Array | number[]) => {
      const chunk = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
      if (stdoutResolver) {
        const resolve = stdoutResolver
        stdoutResolver = null
        resolve(chunk)
      } else {
        stdoutChunks.push(chunk)
      }
    })

    command.stderr.on('data', (raw: Uint8Array | number[] | string) => {
      console.error(`[ACP ${this.agentDef.id}]`, decodeTauriStderr(raw))
    })

    command.on('close', () => {
      stdoutClosed = true
      stdoutClosedError = this.destroying ? null : new Error('Agent process exited unexpectedly.')
      if (stdoutResolver) {
        const resolve = stdoutResolver
        stdoutResolver = null
        resolve(null)
      }
      if (this.destroying || !this.session) return
      this.session.dead = true
      this.session = null
    })

    let child: SpawnerChild
    try {
      const tauriChild = await command.spawn()
      child = {
        write: (data) => tauriChild.write(data as number[]),
        kill: () => tauriChild.kill()
      }
      command.on('close', ({ code }) => {
        child.onExit?.(code ?? 0)
      })
    } catch (e) {
      throw new Error(formatConnectionError(e, this.agentDef))
    }

    const output = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const buffered = stdoutChunks.shift()
        if (buffered) {
          controller.enqueue(buffered)
          return
        }
        if (stdoutClosed) {
          if (stdoutClosedError) controller.error(stdoutClosedError)
          else controller.close()
          return
        }
        const chunk = await new Promise<Uint8Array | null>((resolve) => {
          stdoutResolver = resolve
        })
        if (chunk) {
          controller.enqueue(chunk)
          return
        }
        if (stdoutClosedError) controller.error(stdoutClosedError)
        else controller.close()
      }
    })

    const input = new WritableStream<Uint8Array>({
      async write(chunk) {
        await child.write(Array.from(chunk))
      }
    })

    const stream = ndJsonStream(input, output)
    let onUpdate: ACPSession['onUpdate'] = null
    let onExit: ACPSession['onExit'] = null

    const clientImpl: Client = {
      async requestPermission(
        params: RequestPermissionRequest
      ): Promise<RequestPermissionResponse> {
        const { requestPermissionFromUser } = await import('@/ai/acp-permission')
        return requestPermissionFromUser(params)
      },

      async sessionUpdate(params: SessionNotification): Promise<void> {
        onUpdate?.(params)
      }
    }

    const connection = new ClientSideConnection((_agent: Agent) => clientImpl, stream)
    const { getAutomationAuthToken } = await import('@/automation/spawn-mcp')
    const automationAuthToken = await getAutomationAuthToken()

    await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        // @ts-ignore
        sessionUpdates: {}
      }
    })

    let sessionResult
    try {
      sessionResult = await connection.newSession({
        cwd: this.cwd,
        mcpServers: [
          {
            type: 'http' as const,
            name: 'open-pencil',
            url: 'http://127.0.0.1:7600/mcp',
            headers: automationAuthToken
              ? [{ name: 'Authorization', value: `Bearer ${automationAuthToken}` }]
              : []
          }
        ]
      })
    } catch (e) {
      await child.kill()
      throw new Error(formatConnectionError(e, this.agentDef))
    }

    const session: ACPSession = {
      connection,
      sessionId: sessionResult.sessionId,
      child,
      dead: false,
      get onUpdate() {
        return onUpdate
      },
      set onUpdate(fn) {
        onUpdate = fn
      },
      get onExit() {
        return onExit
      },
      set onExit(fn) {
        onExit = fn
      }
    }

    return session
  }

  private async spawnAgentProxy(): Promise<ACPSession> {
    const agentId = this.agentDef.id
    const id = `spawn-${crypto.randomUUID()}`

    let resolve: (value: { sessionId: string }) => void
    let reject: (reason?: any) => void
    const promise = new Promise<{ sessionId: string }>((res, rej) => {
      resolve = res
      reject = rej
    })

    const removeListener = addAutomationListener((msg) => {
      if (msg.type === 'response' && msg.id === id) {
        if (msg.ok) resolve({ sessionId: msg.sessionId })
        else reject(new Error(msg.error ?? 'Failed to spawn agent over MCP'))
      }
    })

    const sent = sendAutomationMessage({ type: 'acp_spawn', agentId, id })
    if (!sent) {
      removeListener()
      throw new Error('Automation server not connected')
    }

    let result
    try {
      result = await promise
    } finally {
      removeListener()
    }

    const { sessionId } = result
    let onUpdate: ACPSession['onUpdate'] = null
    let onExit: ACPSession['onExit'] = null
    let dead = false

    const removeOutputListener = addAutomationListener((msg) => {
      if (msg.sessionId !== sessionId) return
      if (msg.type === 'acp_output' && msg.chunk) {
        outputController?.enqueue(new TextEncoder().encode(msg.chunk))
      } else if (msg.type === 'acp_stderr' && msg.chunk) {
        console.error(`[ACP ${agentId}]`, msg.chunk)
      } else if (msg.type === 'acp_exit') {
        dead = true
        const exitHandler = onExit as ((code: number) => void) | null
        exitHandler?.(msg.code ?? 0)
        if (msg.code === 0 || this.destroying) outputController?.close()
        else outputController?.error(new Error(`Agent process exited with code ${msg.code}`))
        removeOutputListener()
      }
    })

    let outputController: ReadableStreamDefaultController<Uint8Array> | null = null
    const output = new ReadableStream<Uint8Array>({
      start(c) {
        outputController = c
      }
    })

    const input = new WritableStream<Uint8Array>({
      write(chunk) {
        sendAutomationMessage({
          type: 'acp_send',
          sessionId,
          chunk: new TextDecoder().decode(chunk)
        })
      }
    })

    const stream = ndJsonStream(input, output)
    const clientImpl: Client = {
      async requestPermission(
        params: RequestPermissionRequest
      ): Promise<RequestPermissionResponse> {
        // Auto-accept all requests as requested
        const allow = params.options.find((o) => o.kind.startsWith('allow'))
        const optionId = allow?.optionId ?? params.options[0]?.optionId
        return { outcome: { outcome: 'selected', optionId } }
      },
      async sessionUpdate(params) {
        try {
          onUpdate?.(params)
        } catch (e) {
          console.error('[ACP] Error handling session update:', e, params)
        }
      }
    }

    const connection = new ClientSideConnection((_agent: Agent) => clientImpl, stream)
    const { getAutomationAuthToken } = await import('@/automation/spawn-mcp')
    const automationAuthToken = await getAutomationAuthToken()

    await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        // @ts-ignore
        sessionUpdates: {}
      }
    })

    let sessionResult
    try {
      sessionResult = await connection.newSession({
        cwd: this.cwd,
        mcpServers: [
          {
            type: 'http' as const,
            name: 'open-pencil',
            url: 'http://127.0.0.1:7600/mcp',
            headers: automationAuthToken
              ? [{ name: 'Authorization', value: `Bearer ${automationAuthToken}` }]
              : []
          }
        ]
      })
    } catch (e) {
      sendAutomationMessage({ type: 'acp_kill', sessionId })
      throw new Error(formatConnectionError(e, this.agentDef))
    }

    const session: ACPSession = {
      connection,
      sessionId: sessionResult.sessionId,
      child: {
        write: async (data) => {
          const chunk =
            typeof data === 'string' ? data : new TextDecoder().decode(new Uint8Array(data))
          sendAutomationMessage({ type: 'acp_send', sessionId, chunk })
        },
        kill: async () => {
          sendAutomationMessage({ type: 'acp_kill', sessionId })
        }
      },
      dead,
      get onUpdate() {
        return onUpdate
      },
      set onUpdate(fn) {
        onUpdate = fn
      },
      get onExit() {
        return onExit
      },
      set onExit(fn) {
        onExit = fn
      }
    }

    return session
  }
}
