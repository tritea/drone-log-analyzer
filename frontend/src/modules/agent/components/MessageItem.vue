<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import type { ChatMessage } from '@/services/agent'
import { useAgentStore } from '../store/agent-store'
import { SEVERITY_META, parseIncidents, stripIncidentBlock, type Incident } from '../utils/incidents'
import { formatTime } from '@/modules/analysis/utils/format'
import { useAnalysisStore } from '@/modules/analysis'
import ToolCallCard from './ToolCallCard.vue'
import MarkdownView from './MarkdownView.vue'

const props = defineProps<{ message: ChatMessage }>()

const { t } = useI18n()
const agentStore = useAgentStore()
const { focusedIncidentId } = storeToRefs(agentStore)

/** 机读 incident 块剥离后再渲染 Markdown；问题时段以可点击卡片呈现。 */
const displaySource = computed(() =>
  props.message.role === 'assistant' ? stripIncidentBlock(props.message.content) : props.message.content,
)
const incidents = computed(() =>
  props.message.role === 'assistant' ? parseIncidents(props.message.content) : [],
)

/** 相对秒 → 时刻标签（统一 incident 锚点；无 UTC 基准时退化为相对时长显示）。 */
const timeLabel = (sec: number): string =>
  formatTime(useAnalysisStore().incidentAnchorMs() + sec * 1000)

/** 卡片悬停说明：严重度/描述/交互提示/涉及字段，全部按当前语言拼接。 */
function incidentTooltip(inc: Incident): string {
  const head = t('agent.incident.tipHeader', { severity: t('agent.severity.' + inc.severity) }) + (inc.desc || inc.title)
  const fields = inc.fields.length ? '\n' + t('agent.incident.tipFields', { fields: inc.fields.join(', ') }) : ''
  return head + '\n' + t('agent.incident.tipFocus') + fields
}

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
      <span v-if="message.queued" class="queued-tag">{{ t('agent.messages.queued') }}</span>
      <!-- 问题时段卡片：点击定位（临时叠加相关字段曲线 + 3D 跳转 + 主图缩放），
           再点同一张卡片取消聚焦并清掉临时曲线 -->
      <div v-if="incidents.length" class="msg-incidents">
        <button
          v-for="inc in incidents"
          :key="inc.id"
          class="incident-chip"
          :class="{ 'is-focused': focusedIncidentId === inc.id }"
          :style="{ '--inc': SEVERITY_META[inc.severity].color }"
          :title="incidentTooltip(inc)"
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
  border: 1px solid var(--inc);
  color: var(--inc);
  background: var(--surface-strong, transparent);
  cursor: pointer;
  white-space: nowrap;
}
.incident-chip:hover { filter: brightness(0.92); }
/* 聚焦态：实心填充，白字白点 */
.incident-chip.is-focused {
  background: var(--inc);
  color: #fff;
}
.incident-chip.is-focused .incident-dot { background: #fff; }
.incident-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}
</style>
