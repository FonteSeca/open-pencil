<script setup lang="ts">
import { onMounted, onUnmounted, toRaw } from 'vue'

import { useCloudStorage } from '../composables/use-cloud-storage'
import { useEditorStore } from '../stores/editor'
import { useCollabInjected } from '../composables/use-collab'
import { ScrollAreaRoot, ScrollAreaViewport, ScrollAreaScrollbar, ScrollAreaThumb } from 'reka-ui'
import { formatDistanceToNow } from 'date-fns'

import IconRefreshCw from '~icons/lucide/refresh-cw'
import IconPlus from '~icons/lucide/plus'
import IconCloudOff from '~icons/lucide/cloud-off'
import IconExternalLink from '~icons/lucide/external-link'

const { documents, loading, listDocuments, loadDocument, saveDocument, updateDocument } = useCloudStorage()
const editorStore = useEditorStore()
const collab = useCollabInjected()

async function handleLoad(doc: any) {
  try {
    const data = await loadDocument(doc)
    const file = new File([data], doc.name + '.fig', { type: 'application/octet-stream' })
    await editorStore.openFigFile(file)
    
    // Configura o sync
    editorStore.state.cloudId = doc.id
    editorStore.state.autosaveEnabled = true

    // Conecta ao canal de sincronização em tempo real
    collab?.connect(doc.id)
  } catch (e) {
    console.error('Failed to load document:', e)
  }
}

async function handleAutosave(e: any) {
  const { id, data } = e.detail
  console.log('CloudPanel received autosave event', { id, bytes: data?.length })
  try {
    await updateDocument(id, data)
    console.log('✅ Cloud autosave success at Supabase')
    
    // Atualiza o tempo na lista local para o UI refletir a mudança
    const doc = documents.value.find(d => d.id === id)
    if (doc) {
      doc.updated_at = new Date().toISOString()
    }
  } catch (err) {
    console.error('❌ Cloud autosave failed at Supabase:', err)
  }
}


onMounted(() => {
  listDocuments()
  window.addEventListener('editor:cloud-autosave', handleAutosave)
})

onUnmounted(() => {
  window.removeEventListener('editor:cloud-autosave', handleAutosave)
})

async function handleSaveNew() {
  const name = prompt('File name:', 'Untitled Cloud Design')
  if (!name) return
  
  try {
    // Use toRaw to avoid Proxy issues with Web Workers during export
    const rawStore = toRaw(editorStore)
    // @ts-ignore
    const bytes = await rawStore.buildFigFile()
    const doc = await saveDocument(name, new Uint8Array(bytes))
    
    // Marca como arquivo ativo da nuvem
    if (doc) {
      editorStore.state.cloudId = doc.id
      editorStore.state.autosaveEnabled = true
      collab?.connect(doc.id)
    }
    
    await listDocuments()

  } catch (e) {
    console.error('Failed to save document:', e)
  }
}
</script>

<template>
  <div class="flex flex-col h-full bg-panel text-surface p-4">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-[11px] font-semibold uppercase tracking-wider text-muted">Cloud Files</h2>
      <button 
        class="p-1.5 rounded-md hover:bg-hover text-muted hover:text-surface transition-colors" 
        @click="listDocuments" 
        :disabled="loading"
      >
        <IconRefreshCw :class="{ 'animate-spin': loading }" class="w-3.5 h-3.5" />
      </button>
    </div>

    <button 
      class="mb-4 w-full flex items-center justify-center gap-2 h-8 px-3 text-xs font-medium bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors" 
      @click="handleSaveNew"
    >
      <IconPlus class="w-3.5 h-3.5" />
      Save Current to Cloud
    </button>

    <ScrollAreaRoot class="flex-1 overflow-hidden flex flex-col">
      <ScrollAreaViewport class="h-full w-full">
        <div v-if="documents.length === 0 && !loading" class="text-center py-12 text-muted">
          <IconCloudOff class="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p class="text-xs">No cloud files found</p>
        </div>

        <div class="space-y-1.5">
          <div 
            v-for="doc in documents" 
            :key="doc.id"
            class="group flex flex-col p-2.5 rounded-lg border border-border/50 hover:border-accent/40 bg-zinc-800/20 hover:bg-zinc-800/40 transition-all cursor-pointer"
            @click="handleLoad(doc)"
          >
            <div class="flex items-center justify-between">
              <span class="text-[13px] font-medium truncate">{{ doc.name }}</span>
              <IconExternalLink class="w-3 h-3 text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <span class="text-[10px] text-muted mt-0.5">
              Edited {{ formatDistanceToNow(new Date(doc.updated_at)) }} ago
            </span>
          </div>
        </div>
      </ScrollAreaViewport>
      
      <ScrollAreaScrollbar class="flex select-none touch-none p-0.5 bg-transparent transition-colors duration-150 ease-out hover:bg-black/5 data-[orientation=vertical]:w-1.5" orientation="vertical">
        <ScrollAreaThumb class="flex-1 bg-zinc-700/50 rounded-lg relative before:content-[''] before:absolute before:top-1/2 before:left-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:w-full before:h-full before:min-w-[44px] before:min-h-[44px]" />
      </ScrollAreaScrollbar>
    </ScrollAreaRoot>
  </div>
</template>
