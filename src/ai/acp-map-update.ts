import type { SessionUpdate } from '@agentclientprotocol/sdk'
import type { UIMessageChunk } from 'ai'

export interface MapResult {
  chunks: UIMessageChunk[]
  textStarted: boolean
  reasoningStarted: boolean
  partCounter: number
  currentTextId: string
  currentReasoningId: string
  seenToolCalls: Set<string>
}

export function mapUpdate(
  update: SessionUpdate,
  baseId: string,
  textStarted: boolean,
  reasoningStarted: boolean,
  partCounter: number,
  currentTextId: string,
  currentReasoningId: string,
  seenToolCalls: Set<string>
): MapResult {
  const chunks: UIMessageChunk[] = []

  if (!update || !update.sessionUpdate) {
    return { chunks, textStarted, reasoningStarted, partCounter, currentTextId, currentReasoningId, seenToolCalls }
  }

  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const content = update.content as any
      const text = typeof content?.text === 'string' 
        ? content.text 
        : (Array.isArray(content) ? textFromContent(content) : undefined)

      if (text) {
        if (reasoningStarted) {
          chunks.push({ type: 'reasoning-end', id: currentReasoningId })
          reasoningStarted = false
        }
        if (!textStarted) {
          partCounter++
          currentTextId = `text-${baseId}-${partCounter}`
          chunks.push({ type: 'text-start', id: currentTextId })
          textStarted = true
        }
        chunks.push({
          type: 'text-delta',
          id: currentTextId,
          delta: text
        })
      }
      break
    }
    case 'agent_thought_chunk': {
      const content = update.content as any
      const text = typeof content?.text === 'string' 
        ? content.text 
        : (Array.isArray(content) ? textFromContent(content) : undefined)

      if (text) {
        if (textStarted) {
          chunks.push({ type: 'text-end', id: currentTextId })
          textStarted = false
        }
        if (!reasoningStarted) {
          partCounter++
          currentReasoningId = `reasoning-${baseId}-${partCounter}`
          chunks.push({ type: 'reasoning-start', id: currentReasoningId })
          reasoningStarted = true
        }
        chunks.push({
          type: 'reasoning-delta',
          id: currentReasoningId,
          delta: text
        })
      }
      break
    }
    case 'tool_call': {
      if (!update.toolCallId) break

      seenToolCalls.add(update.toolCallId)

      if (reasoningStarted) {
        chunks.push({ type: 'reasoning-end', id: currentReasoningId })
        reasoningStarted = false
      }
      if (textStarted) {
        chunks.push({ type: 'text-end', id: currentTextId })
        textStarted = false
      }

      const inferredName = update.toolCallId.split('-')[0]
      const toolName = update.title && update.title.length < 50 ? update.title : inferredName

      chunks.push({
        type: 'tool-input-start',
        toolCallId: update.toolCallId,
        toolName,
        providerExecuted: true,
        title: update.title && update.title.length < 50 ? update.title : undefined
      })
      if (update.rawInput) {
        chunks.push({
          type: 'tool-input-available',
          toolCallId: update.toolCallId,
          toolName,
          input: update.rawInput,
          providerExecuted: true,
          title: update.title && update.title.length < 50 ? update.title : undefined
        })
      }
      break
    }
    case 'tool_call_update': {
      if (!update.toolCallId) break

      if (!seenToolCalls.has(update.toolCallId)) {
        seenToolCalls.add(update.toolCallId)
        if (reasoningStarted) {
          chunks.push({ type: 'reasoning-end', id: currentReasoningId })
          reasoningStarted = false
        }
        if (textStarted) {
          chunks.push({ type: 'text-end', id: currentTextId })
          textStarted = false
        }

        const inferredName = update.toolCallId.split('-')[0]
        const toolName = update.title && update.title.length < 50 ? update.title : inferredName

        chunks.push({
          type: 'tool-input-start',
          toolCallId: update.toolCallId,
          toolName,
          providerExecuted: true,
          title: update.title && update.title.length < 50 ? update.title : undefined
        })
      }

      if (update.status === 'completed') {
        const output = update.rawOutput ?? textFromContent(update.content ?? undefined)
        if (output !== undefined) {
          chunks.push({
            type: 'tool-output-available',
            toolCallId: update.toolCallId,
            output,
            providerExecuted: true
          })
        }
      } else if (update.status === 'failed') {
        chunks.push({
          type: 'tool-output-error',
          toolCallId: update.toolCallId,
          errorText: textFromContent(update.content ?? undefined) ?? 'Tool call failed',
          providerExecuted: true
        })
      }
      break
    }
  }

  return { chunks, textStarted, reasoningStarted, partCounter, currentTextId, currentReasoningId, seenToolCalls }
}

export function textFromContent(
  content: Record<string, unknown>[] | undefined
): string | undefined {
  if (!content) return undefined
  const parts: string[] = []
  for (const c of content) {
    if (c.type !== 'content') continue
    const inner = c.content as Record<string, unknown> | undefined
    if (inner?.type === 'text' && typeof inner.text === 'string') {
      parts.push(inner.text)
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined
}
