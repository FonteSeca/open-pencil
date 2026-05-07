<script setup lang="ts">
import { ref } from 'vue'
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'

import { useI18n } from '@open-pencil/vue'

import AppMenu from './AppMenu.vue'
import LayerTree from './LayerTree.vue'
import PagesPanel from './PagesPanel.vue'
import CloudPanel from './CloudPanel.vue'

const { panels } = useI18n()
const activeTab = ref<'layers' | 'cloud'>('layers')
</script>

<template>
  <aside
    data-test-id="layers-panel"
    class="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-border bg-panel"
    style="contain: paint layout style"
  >
    <AppMenu />
    
    <!-- Tab Switcher -->
    <div class="flex border-b border-border px-1">
      <button 
        class="px-3 py-2 text-[11px] font-medium tracking-wider uppercase transition-colors"
        :class="activeTab === 'layers' ? 'text-surface border-b border-blue-500' : 'text-muted hover:text-surface'"
        @click="activeTab = 'layers'"
      >
        {{ panels.layers }}
      </button>
      <button 
        class="px-3 py-2 text-[11px] font-medium tracking-wider uppercase transition-colors"
        :class="activeTab === 'cloud' ? 'text-surface border-b border-blue-500' : 'text-muted hover:text-surface'"
        @click="activeTab = 'cloud'"
      >
        Cloud
      </button>
    </div>

    <div v-if="activeTab === 'layers'" class="flex-1 flex flex-col overflow-hidden">
      <SplitterGroup direction="vertical" auto-save-id="layers-layout" class="flex-1 overflow-hidden">
        <SplitterPanel
          :default-size="30"
          :min-size="10"
          :max-size="60"
          class="flex flex-col overflow-hidden"
        >
          <PagesPanel />
        </SplitterPanel>
        <SplitterResizeHandle class="group relative z-10 -my-1 h-2 cursor-row-resize">
          <div
            class="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border"
          />
        </SplitterResizeHandle>
        <SplitterPanel :default-size="70" :min-size="20" class="flex flex-col overflow-hidden">
          <header
            data-test-id="layers-header"
            class="shrink-0 px-3 py-2 text-[11px] tracking-wider text-muted uppercase"
          >
            {{ panels.layers }}
          </header>
          <LayerTree />
        </SplitterPanel>
      </SplitterGroup>
    </div>

    <div v-else class="flex-1 overflow-hidden">
      <CloudPanel />
    </div>
  </aside>
</template>

