<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ChatMessage } from '@/services/agent'
import type { ToolCallView } from '../store/agent-store'
import MessageItem from './MessageItem.vue'
import ToolCallCard from './ToolCallCard.vue'
import MarkdownView from './MarkdownView.vue'

const { t } = useI18n()

const props = defineProps<{
  messages: ChatMessage[]
  streamingActive: boolean
  streamingText: string
  streamingReasoning: string
  streamingTools: ToolCallView[]
}>()

const root = ref<HTMLElement | null>(null)

/** 滚动策略：任何更新（新消息/流式增量）都自动置底。 */
async function scrollToBottom(): Promise<void> {
  await nextTick()
  const el = root.value
  if (el) el.scrollTop = el.scrollHeight
}

/** 本轮已运行秒数：长时间无输出时让用户确认仍在工作。用起始时间戳差值
 * 重算而非累加——webview 窗口被遮挡时定时器会被系统节流（每分钟一醒），
 * 累加会永久丢失错过的增量导致计数卡住，差值重算在节流恢复后自愈。 */
const elapsed = ref(0)
let timer: number | null = null
let startedAt = 0

function refreshElapsed(): void {
  elapsed.value = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
}

function onVisibilityChange(): void {
  if (!document.hidden) refreshElapsed()
}

function stopTimer(): void {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
  document.removeEventListener('visibilitychange', onVisibilityChange)
}

watch(
  () => props.streamingActive,
  (active) => {
    stopTimer()
    if (active) {
      startedAt = Date.now()
      elapsed.value = 0
      document.addEventListener('visibilitychange', onVisibilityChange)
      timer = window.setInterval(refreshElapsed, 1000)
    }
  },
  { immediate: true },
)

onBeforeUnmount(stopTimer)

watch(
  () => [props.messages.length, props.streamingText, props.streamingReasoning, props.streamingTools.length] as const,
  () => void scrollToBottom(),
)
</script>

<template>
  <div ref="root" class="msg-list">
    <div v-if="!messages.length && !streamingActive" class="msg-empty">
      {{ t('agent.messages.empty') }}
    </div>
    <MessageItem v-for="(m, i) in messages" :key="i" :message="m" />
    <div v-if="streamingActive" class="msg assistant">
      <div v-if="streamingTools.length" class="msg-tools">
        <ToolCallCard
          v-for="(t, i) in streamingTools"
          :key="i"
          :trace="t"
          :pending="t.pending"
        />
      </div>
      <details v-if="streamingReasoning" class="msg-reasoning" open>
        <summary>{{ t('agent.messages.reasoning') }}</summary>
        <div class="msg-reasoning-body">{{ streamingReasoning }}</div>
      </details>
      <div v-if="streamingText" class="msg-bubble md-streaming">
        <MarkdownView :source="streamingText" />
      </div>
      <div v-else class="msg-typing">
        <span class="spinner"></span>{{ t('agent.messages.thinking') }} · {{ elapsed }}s
      </div>
    </div>
  </div>
</template>

<style scoped>
.msg-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 12px;
}
.msg-empty {
  margin: auto;
  color: var(--text3);
  font-size: 13px;
  text-align: center;
  max-width: 260px;
  line-height: 1.7;
}
.msg { display: flex; flex-direction: column; max-width: 92%; }
.msg + .msg { margin-top: 10px; }
.msg.assistant { align-self: flex-start; align-items: flex-start; }
.msg-tools { width: 100%; margin-bottom: 4px; }
.msg-reasoning {
  width: 100%;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  background: transparent;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--text3);
}
.msg-reasoning summary {
  cursor: pointer;
  padding: 3px 8px;
  user-select: none;
  list-style: none;
}
.msg-reasoning summary::-webkit-details-marker { display: none; }
.msg-reasoning-body {
  padding: 0 8px 6px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
  max-height: 160px;
  overflow-y: auto;
}
.msg-bubble {
  padding: 8px 12px;
  border-radius: var(--radius-lg);
  border-bottom-left-radius: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.md-streaming { white-space: normal; }
.msg-typing {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text3);
  font-size: 13px;
  padding: 4px 2px;
  font-variant-numeric: tabular-nums;
}
.spinner {
  width: 10px;
  height: 10px;
  border: 2px solid var(--border);
  border-top-color: var(--blue);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
