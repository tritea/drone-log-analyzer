<script setup lang="ts">
import { computed } from 'vue'
import DOMPurify from 'dompurify'
import { agentMd } from '../utils/markdown'

/** 助手回复的 Markdown 渲染：agentMd 解析（GFM，删除线还原，见 utils/markdown）
 * + DOMPurify 消毒（模型输出不可信，防 XSS）。 */
const props = defineProps<{ source: string }>()

const html = computed<string>(() => {
  const raw = agentMd.parse(props.source ?? '', { async: false }) as string
  return DOMPurify.sanitize(raw)
})
</script>

<template>
  <div class="md-view" v-html="html"></div>
</template>

<style scoped>
.md-view {
  font-size: 13px;
  line-height: 1.65;
  word-break: break-word;
}
.md-view :deep(h1),
.md-view :deep(h2),
.md-view :deep(h3),
.md-view :deep(h4) {
  margin: 0.6em 0 0.3em;
  font-size: 1em;
  font-weight: 600;
  color: var(--text);
}
.md-view :deep(h1) { font-size: 1.15em; }
.md-view :deep(h2) { font-size: 1.08em; }
.md-view :deep(p) { margin: 0.35em 0; }
.md-view :deep(ul),
.md-view :deep(ol) { margin: 0.35em 0; padding-left: 1.4em; }
.md-view :deep(li) { margin: 0.15em 0; }
.md-view :deep(strong) { color: var(--text); }
.md-view :deep(code) {
  font-family: Consolas, monospace;
  font-size: 0.92em;
  background: var(--surface-strong);
  border-radius: 4px;
  padding: 0 4px;
}
.md-view :deep(pre) {
  margin: 0.45em 0;
  padding: 8px 10px;
  background: var(--surface-strong);
  border-radius: var(--radius);
  overflow-x: auto;
}
.md-view :deep(pre code) { background: none; padding: 0; }
/* 表格随容器宽度自适应：fixed 布局按可用宽度分配列，避免列宽被最宽内容
   撑死后面板缩小也不回收；放不下的长词在单元格内换行。 */
.md-view :deep(table) {
  border-collapse: collapse;
  margin: 0.45em 0;
  font-size: 0.95em;
  width: 100%;
  table-layout: fixed;
}
.md-view :deep(th),
.md-view :deep(td) {
  border: 1px solid var(--border);
  padding: 3px 8px;
  text-align: left;
  overflow-wrap: anywhere;
}
.md-view :deep(th) { background: var(--surface-strong); }
.md-view :deep(blockquote) {
  margin: 0.45em 0;
  padding: 2px 10px;
  border-left: 3px solid var(--blue);
  color: var(--text2);
}
.md-view :deep(a) { color: var(--blue); }
.md-view :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 0.6em 0; }
</style>
