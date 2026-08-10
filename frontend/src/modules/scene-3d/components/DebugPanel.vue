<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useScene3dStore } from '@/modules/scene-3d'
import { useAnalysisStore } from '@/modules/analysis'

const threeStore = useScene3dStore()
const chartStore = useAnalysisStore()
const { three } = storeToRefs(threeStore)
const di = computed(() => threeStore.threeDebugInfo)
const timeLabel = computed(() => chartStore.formatTime(di.value.timeMs, false))

function fmt(v: number | null, d = 7): string {
  if (v === null || v === undefined || !isFinite(v as number)) return '—'
  return Number(v).toFixed(d)
}
</script>

<template>
  <div v-if="three.debug.posPanel && di.source" class="three-debug-panel">
    <div class="three-debug-head">
      <span>位置调试</span>
      <button class="three-debug-close" title="隐藏（设置里可重新打开）" @click="three.debug.posPanel = false">×</button>
    </div>
    <div class="three-debug-src">{{ di.source }} · geoExact={{ di.geoExact }}</div>
    <table class="three-debug-table">
      <tr><th>时间</th><td>{{ timeLabel }} ({{ di.timeMs }}ms)</td></tr>
      <template v-if="di.useGeo">
        <tr><th>原始 Lat</th><td>{{ fmt(di.rawLat) }}</td></tr>
        <tr><th>原始 Lng</th><td>{{ fmt(di.rawLng) }}</td></tr>
        <tr><th>原始 Alt</th><td>{{ fmt(di.rawAlt, 3) }}</td></tr>
      </template>
      <template v-else>
        <tr><th>原始 PE(m)</th><td>{{ fmt(di.rawPx, 4) }}</td></tr>
        <tr><th>原始 PN(m)</th><td>{{ fmt(di.rawPy, 4) }}</td></tr>
      </template>
      <tr class="three-debug-sep"><th colspan="2">↓ 转换</th></tr>
      <tr><th>north(m)</th><td>{{ fmt(di.north, 4) }}</td></tr>
      <tr><th>east(m)</th><td>{{ fmt(di.east, 4) }}</td></tr>
      <tr><th>down(m)</th><td>{{ fmt(di.down, 4) }}</td></tr>
      <tr><th>X</th><td>{{ fmt(di.x, 4) }}</td></tr>
      <tr><th>Y</th><td>{{ fmt(di.y, 4) }}</td></tr>
      <tr><th>Z</th><td>{{ fmt(di.z, 4) }}</td></tr>
    </table>
    <div class="three-debug-note">原始值走 float32(7位可见量化步长)，XYZ 走 int32 全精度(1cm)</div>
  </div>
</template>

<style scoped>
.three-debug-panel {
  position: absolute; right: 10px; top: 10px; z-index: 20;
  background: rgba(15, 23, 42, 0.85); color: #e2e8f0;
  border: 1px solid rgba(148, 163, 184, 0.4); border-radius: 6px;
  padding: 8px 10px; min-width: 230px;
  font: 11px/1.5 ui-monospace, Menlo, Consolas, monospace;
  pointer-events: auto;
}
.three-debug-head { display: flex; justify-content: space-between; align-items: center; font-weight: 700; margin-bottom: 2px; }
.three-debug-close { background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px; }
.three-debug-close:hover { color: #f1f5f9; }
.three-debug-src { color: #93c5fd; margin-bottom: 4px; }
.three-debug-table { border-collapse: collapse; }
.three-debug-table th { text-align: right; color: #94a3b8; padding-right: 8px; font-weight: 400; white-space: nowrap; }
.three-debug-table td { text-align: left; color: #f1f5f9; }
.three-debug-sep th { color: #64748b; text-align: left; padding-top: 4px; border-top: 1px dashed rgba(148, 163, 184, 0.3); }
.three-debug-note { margin-top: 4px; color: #64748b; font-size: 10px; }
</style>
