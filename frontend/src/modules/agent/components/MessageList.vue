<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ChatMessage } from '@/services/agent'
import type { ToolCallView } from '../store/agent-store'
import MessageItem from './MessageItem.vue'
import ToolCallCard from './ToolCallCard.vue'

const props = defineProps<{
  messages: ChatMessage[]
  streamingActive: boolean
  streamingText: string
  streamingReasoning: string
  streamingTools: ToolCallView[]
}>()

const root = ref<HTMLElement | null>(null)

/** 本轮已运行秒数：长时间无输出时让用户确认仍在工作。 */
const elapsed = ref(0)
let timer: number | null = null

function stopTimer(): void {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}

watch(
  () => props.streamingActive,
  (active) => {
    stopTimer()
    if (active) {
      elapsed.value = 0
      timer = window.setInterval(() => {
        elapsed.value += 1
      }, 1000)
    }
  },
  { immediate: true },
)

onBeforeUnmount(stopTimer)

/**
 * 滚动策略：流式增量只在"贴底"（距底 <80px）时跟随——用户主动上滚回看
 * 时不打扰；新消息到达（发送/回复完成）才强制滚到底。
 */
const NEAR_BOTTOM_PX = 80

async function scrollToBottom(force: boolean): Promise<void> {
  await nextTick()
  const el = root.value
  if (!el) return
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
  if (force || nearBottom) {
    el.scrollTop = el.scrollHeight
  }
}

watch(
  () => [props.messages.length] as const,
  () => void scrollToBottom(true),
)

watch(
  () => [props.streamingText, props.streamingReasoning, props.streamingTools.length] as const,
  () => void scrollToBottom(false),
)
</script>

<template>
  <div ref="root" class="msg-list">
    <div v-if="!messages.length && !streamingActive" class="msg-empty">
      问点什么，例如：这次飞行 GPS 信号质量怎么样？电池电压下降是否正常？
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
        <summary>思考过程</summary>
        <div class="msg-reasoning-body">{{ streamingReasoning }}</div>
      </details>
      <div v-if="streamingText" class="msg-bubble">{{ streamingText }}</div>
      <div v-else class="msg-typing">
        <span class="spinner"></span>思考中 · {{ elapsed }}s
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
