<script setup lang="ts">
import { computed } from 'vue'
import type { ToolCallTrace } from '@/services/agent'

const props = defineProps<{ trace: ToolCallTrace; pending?: boolean }>()

interface ToolView {
  label: string
  detail: string
}

/**
 * 面向用户的步骤描述：不暴露内部工具名与参数 JSON，只显示人话标签 +
 * 人性化参数摘要，避免用户从界面反推实现方式。
 */
function describeTool(tool: string, args?: Record<string, unknown>): ToolView {
  const group = asText(args?.group)
  const prefix = asText(args?.name_prefix)
  switch (tool) {
    case 'get_overview':
    case 'get_log_overview':
      return { label: '读取日志概况', detail: '' }
    case 'list_groups':
      return { label: '检索数据分组', detail: '' }
    case 'get_fields':
    case 'get_group_fields':
      return { label: '查看字段说明', detail: group }
    case 'query_data':
    case 'query_signal': {
      const queries = Array.isArray(args?.queries) ? (args.queries as unknown[]) : []
      const names = queries
        .map((q) => asText((q as Record<string, unknown>)?.name))
        .filter((name) => name !== '')
      return { label: '查询数据', detail: names.join('、') }
    }
    case 'get_records':
    case 'get_flight_events':
      return { label: '读取飞行记录', detail: asText(args?.kind) }
    case 'get_params':
    case 'get_parameters':
      return { label: '读取参数', detail: prefix }
    case 'list_param_groups':
      return { label: '查看参数分组', detail: '' }
    default:
      return { label: '处理中', detail: '' }
  }
}

function asText(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

const view = computed(() => describeTool(props.trace.tool, props.trace.args))
</script>

<template>
  <div class="tool-card" :class="{ 'is-pending': pending }">
    <span class="tool-dot"></span>
    <span class="tool-label">
      {{ view.label }}<span v-if="view.detail" class="tool-detail"> · {{ view.detail }}</span>
    </span>
    <span v-if="!pending && trace.durationMs != null" class="tool-dur">{{ trace.durationMs }}ms</span>
    <span v-else class="tool-dur is-running">进行中</span>
  </div>
</template>

<style scoped>
.tool-card {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--surface-soft);
  padding: 3px 8px;
  font-size: 12px;
  color: var(--text2);
  max-width: 100%;
}
.tool-card + .tool-card { margin-top: 3px; }
.tool-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--green);
  flex: none;
}
.is-pending .tool-dot { background: var(--amber); }
.tool-label { min-width: 0; }
.tool-detail { color: var(--text3); }
.tool-dur {
  margin-left: auto;
  color: var(--text3);
  font-variant-numeric: tabular-nums;
  flex: none;
}
.tool-dur.is-running { color: var(--amber); }
</style>
