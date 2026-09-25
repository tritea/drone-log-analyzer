<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@/modules/shared/ui-store'
import { useLogStore } from '@/modules/log'
import { useAgentStore } from '../store/agent-store'
import AppButton from '@/modules/shared/components/AppButton.vue'
import MessageList from './MessageList.vue'
import ChatInput from './ChatInput.vue'
import LlmSettingsDialog from './LlmSettingsDialog.vue'

const { t } = useI18n()

const uiStore = useUiStore()
const { ui } = storeToRefs(uiStore)

const logStore = useLogStore()
const { log } = storeToRefs(logStore)

const agentStore = useAgentStore()
const { agent, llmConfigured } = storeToRefs(agentStore)

const inputDisabled = computed(() => !log.value.loaded || !llmConfigured.value)
const disabledHint = computed(() => {
  if (!log.value.loaded) return t('agent.panel.hintOpenLog')
  if (!llmConfigured.value) return t('agent.panel.hintConfigureLlm')
  return ''
})

function close(): void {
  ui.value.agentOpen = false
}

/** 面板宽度：左边缘拖拽调整，记忆到 localStorage。 */
const WIDTH_KEY = 'agentPanelWidth'
const MIN_WIDTH = 340
const panelWidth = ref(loadWidth())

function loadWidth(): number {
  const saved = Number(localStorage.getItem(WIDTH_KEY))
  if (!Number.isFinite(saved) || saved < MIN_WIDTH) return 380
  return Math.min(saved, Math.floor(window.innerWidth * 0.9))
}

function saveWidth(): void {
  localStorage.setItem(WIDTH_KEY, String(panelWidth.value))
}

let dragging = false

function onDragStart(ev: PointerEvent): void {
  dragging = true
  const startX = ev.clientX
  const startWidth = panelWidth.value
  const onMove = (e: PointerEvent): void => {
    if (!dragging) return
    const max = Math.floor(window.innerWidth * 0.9)
    panelWidth.value = Math.min(max, Math.max(MIN_WIDTH, startWidth + (startX - e.clientX)))
  }
  const onUp = (): void => {
    dragging = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    saveWidth()
    document.body.style.cursor = ''
  }
  document.body.style.cursor = 'col-resize'
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

onMounted(() => {
  void agentStore.initialize()
})

// 面板真正打开时、切换日志文件时重新拉取会话（历史按日志隔离）。
watch(
  () => [ui.value.agentOpen, log.value.fileName] as const,
  ([open]) => {
    if (open) void agentStore.refreshHistory()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  agentStore.dispose()
})
</script>

<template>
  <transition name="agent-slide">
    <aside v-if="ui.agentOpen" class="agent-panel" :style="{ width: panelWidth + 'px' }">
      <div class="agent-resize-handle" :title="t('agent.panel.resizeTitle')" @pointerdown="onDragStart"></div>

      <header class="agent-head">
        <strong>{{ t('agent.panel.title') }}</strong>
        <span class="agent-head-sub">{{ log.summary?.vehicleType || '' }} {{ log.summary?.format || '' }}</span>
        <div class="agent-head-actions">
          <AppButton size="xs" icon="download" icon-only :title="t('agent.panel.exportMdTitle')" @click="agentStore.exportMarkdown()" />
          <AppButton size="xs" :title="t('agent.panel.exportPdfTitle')" @click="agentStore.exportPdf()">PDF</AppButton>
          <AppButton size="xs" icon="settings" icon-only :title="t('agent.panel.llmSettingsTitle')" @click="agent.settingsOpen = true" />
          <AppButton size="xs" icon="trash" icon-only :title="t('agent.panel.clearSessionTitle')" @click="agentStore.clearSession()" />
          <AppButton size="xs" icon="close" icon-only :title="t('agent.panel.collapseTitle')" @click="close" />
        </div>
      </header>

      <MessageList
        :messages="agent.messages"
        :streaming-active="agent.streaming.active"
        :streaming-text="agent.streaming.text"
        :streaming-reasoning="agent.streaming.reasoning"
        :streaming-tools="agent.streaming.tools"
      />

      <p v-if="agent.error" class="agent-error">{{ agent.error }}</p>

      <ChatInput
        :streaming="agent.streaming.active"
        :disabled="inputDisabled"
        :disabled-hint="disabledHint"
        @send="(text) => agentStore.send(text)"
        @stop="agentStore.stop()"
      />

      <LlmSettingsDialog />
    </aside>
  </transition>
</template>

<style scoped>
.agent-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  max-width: 90vw;
  background: var(--surface-soft);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  z-index: 60;
}
.agent-resize-handle {
  position: absolute;
  top: 0;
  left: -4px;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  z-index: 1;
}
.agent-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.agent-head strong { font-size: 14px; color: var(--text); }
.agent-head-sub { font-size: 12px; color: var(--text3); flex: 1; }
.agent-head-actions { display: flex; gap: 4px; align-items: center; }
/* 面板头混排 icon-only（28×28）与文本（默认 24 高）按钮，统一高度对齐。 */
.agent-head-actions :deep(.app-btn.is-xs) { height: 28px; }
.agent-error {
  margin: 0;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--red);
  border-top: 1px solid var(--border-soft);
  background: #fff5f5;
}
.agent-slide-enter-active, .agent-slide-leave-active { transition: transform 0.2s ease; }
.agent-slide-enter-from, .agent-slide-leave-to { transform: translateX(100%); }
</style>
