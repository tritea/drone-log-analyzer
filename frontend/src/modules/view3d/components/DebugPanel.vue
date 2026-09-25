<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useView3dStore } from '@/modules/view3d'
import { usePlaybackStore } from '@/modules/playback'
import { useAnalysisStore } from '@/modules/analysis'

const { t } = useI18n()
const view3dStore = useView3dStore()
const playbackStore = usePlaybackStore()
const chartStore = useAnalysisStore()
const { view3d } = storeToRefs(view3dStore)
const di = computed(() => playbackStore.threeDebugInfo)
const timeLabel = computed(() => chartStore.formatTime(di.value.timeMs, false))

function fmt(v: number | null, d = 7): string {
  if (v === null || v === undefined || !isFinite(v as number)) return '—'
  return Number(v).toFixed(d)
}
</script>

<template>
  <div v-if="view3d.debug.posPanel && di.source" class="three-debug-panel">
    <div class="three-debug-head">
      <span>{{ t('scene3d.debug.title') }}</span>
      <button class="three-debug-close" :title="t('scene3d.debug.hideTitle')" @click="view3d.debug.posPanel = false">×</button>
    </div>
    <div class="three-debug-src">{{ di.source }} · geoExact={{ di.geoExact }}</div>
    <table class="three-debug-table">
      <tr><th>{{ t('scene3d.debug.time') }}</th><td>{{ timeLabel }} ({{ di.timeMs }}ms)</td></tr>
      <template v-if="di.useGeo">
        <tr><th>{{ t('scene3d.debug.rawLat') }}</th><td>{{ fmt(di.rawLat) }}</td></tr>
        <tr><th>{{ t('scene3d.debug.rawLng') }}</th><td>{{ fmt(di.rawLng) }}</td></tr>
        <tr><th>{{ t('scene3d.debug.rawAlt') }}</th><td>{{ fmt(di.rawAlt, 3) }}</td></tr>
      </template>
      <template v-else>
        <tr><th>{{ t('scene3d.debug.rawPE') }}</th><td>{{ fmt(di.rawPx, 4) }}</td></tr>
        <tr><th>{{ t('scene3d.debug.rawPN') }}</th><td>{{ fmt(di.rawPy, 4) }}</td></tr>
      </template>
      <tr class="three-debug-sep"><th colspan="2">{{ t('scene3d.debug.convert') }}</th></tr>
      <tr><th>north(m)</th><td>{{ fmt(di.north, 4) }}</td></tr>
      <tr><th>east(m)</th><td>{{ fmt(di.east, 4) }}</td></tr>
      <tr><th>down(m)</th><td>{{ fmt(di.down, 4) }}</td></tr>
      <tr><th>X</th><td>{{ fmt(di.x, 4) }}</td></tr>
      <tr><th>Y</th><td>{{ fmt(di.y, 4) }}</td></tr>
      <tr><th>Z</th><td>{{ fmt(di.z, 4) }}</td></tr>
    </table>
    <div class="three-debug-note">{{ t('scene3d.debug.note') }}</div>
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
