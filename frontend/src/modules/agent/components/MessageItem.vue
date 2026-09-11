<script setup lang="ts">
import { computed } from 'vue'
import type { ChatMessage } from '@/services/agent'
import { useAgentStore } from '../store/agent-store'
import { SEVERITY_META, parseIncidents, stripIncidentBlock } from '../utils/incidents'
import { formatTime } from '@/modules/analysis/utils/format'
import { useAnalysisStore } from '@/modules/analysis'
import ToolCallCard from './ToolCallCard.vue'
import MarkdownView from './MarkdownView.vue'

const props = defineProps<{ message: ChatMessage }>()

const agentStore = useAgentStore()

/** 机读 incident 块剥离后再渲染 Markdown；问题时段以可点击卡片呈现。 */
const displaySource = computed(() =>
  props.message.role === 'assistant' ? stripIncidentBlock(props.message.content) : props.message.content,
)
const incidents = computed(() =>
  props.message.role === 'assistant' ? parseIncidents(props.message.content) : [],
)

/** 相对秒 → 时刻标签（锚定日志起点；无曲线基准时退化为相对时长显示）。 */
const timeLabel = (sec: number): string =>
  formatTime(useAnalysisStore().chartBaseTimeMs() + sec * 1000)

function fmtTok(n?: number): string {
  if (n == null) return '-'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}
</script>

<template>
  <div class="msg" :class="message.role">
    <div v-if="message.toolTrace?.length" class="msg-tools">
      <ToolCallCard v-for="(t, i) in message.toolTrace" :key="i" :trace="t" />
    </div>
    <div class="msg-bubble" :class="{ 'is-queued': message.queued }">
      <!-- 助手回复渲染 Markdown；用户消息保持纯文本 -->
      <MarkdownView v-if="message.role === 'assistant'" :source="displaySource" />
      <template v-else>{{ message.content }}</template>
      <span v-if="message.queued" class="queued-tag">排队中</span>
      <!-- 问题时段卡片：点击定位（3D 跳转 + 主图缩放），供二次分析快速复核 -->
      <div v-if="incidents.length" class="msg-incidents">
        <button
          v-for="inc in incidents"
          :key="inc.id"
          class="incident-chip"
          :style="{ borderColor: SEVERITY_META[inc.severity].color, color: SEVERITY_META[inc.severity].color }"
          :title="`【${SEVERITY_META[inc.severity].label}】${inc.desc || inc.title}\n点击定位到该时段（3D 跳转 / 图表缩放）${inc.fields.length ? '\n字段：' + inc.fields.join(', ') : ''}`"
          @click="agentStore.focusIncident(inc)"
        >
          <span class="incident-dot" :style="{ background: SEVERITY_META[inc.severity].color }"></span>
          {{ timeLabel(inc.startSec) }}~{{ timeLabel(inc.endSec) }} · {{ inc.title }}
        </button>
      </div>
    </div>
    <div v-if="message.role === 'assistant' && message.stats" class="msg-stats">
      <span>⏱ {{ ((message.stats.durationMs ?? 0) / 1000).toFixed(1) }}s</span>
      <span v-if="message.stats.totalTokens">
        · ↑{{ fmtTok(message.stats.promptTokens) }} ↓{{ fmtTok(message.stats.completionTokens) }} · Σ{{ fmtTok(message.stats.totalTokens) }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.msg {
  display: flex;
  flex-direction: column;
  max-width: 92%;
}
.msg.user { align-self: flex-end; align-items: flex-end; }
.msg.assistant { align-self: flex-start; align-items: flex-start; }
.msg + .msg { margin-top: 10px; }
.msg-tools {
  width: 100%;
  margin-bottom: 4px;
}
.msg-bubble {
  padding: 8px 12px;
  border-radius: var(--radius-lg);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg.assistant .msg-bubble {
  /* Markdown 渲染为块级 HTML，交给 .md-view 控制排版 */
  white-space: normal;
}
.msg.user .msg-bubble {
  background: var(--blue);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.msg-stats {
  margin-top: 3px;
  font-size: 11px;
  color: var(--text3);
  font-variant-numeric: tabular-nums;
}
.msg.user .msg-bubble.is-queued {
  background: var(--blue-soft);
  color: var(--text2);
  border: 1px dashed var(--blue);
}
.queued-tag {
  display: inline-block;
  margin-left: 6px;
  font-size: 10px;
  padding: 0 4px;
  border-radius: 4px;
  background: rgba(37, 99, 235, 0.12);
  vertical-align: 1px;
}
.msg.assistant .msg-bubble {
  background: var(--surface);
  border: 1px solid var(--border);
  border-bottom-left-radius: 4px;
  box-shadow: var(--shadow-sm);
}
.msg-incidents {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}
.incident-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid;
  background: var(--surface-strong, transparent);
  cursor: pointer;
  white-space: nowrap;
}
.incident-chip:hover { filter: brightness(0.92); }
.incident-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}
</style>
