<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useAnalysisStore } from '@/modules/analysis'
import { useUiStore } from '@/modules/shared/ui-store'
import AppIcon from '@/modules/shared/components/AppIcon.vue'

const { t } = useI18n()
const { ui } = storeToRefs(useUiStore())
const chartStore = useAnalysisStore()
const { visibleCurves } = storeToRefs(chartStore)
const { isCurveDrawn, toggleCurveDrawn, removeCurveById } = chartStore
</script>

<template>
  <div v-if="ui.mainView === 'chart' && visibleCurves.length" class="chart-legend" :aria-label="t('analysis.legend.aria')">
    <div
      v-for="curve in visibleCurves"
      :key="'legend-' + curve.id"
      class="chart-legend-item"
      :class="{ 'is-drawn-off': !isCurveDrawn(curve.id) }"
      :title="curve.label"
    >
      <span class="chart-legend-line" :style="{ background: curve.color }"></span>
      <span class="chart-legend-name">{{ curve.label }}</span>
      <button
        class="legend-eye-btn"
        type="button"
        :title="isCurveDrawn(curve.id) ? t('analysis.legend.hideDraw') : t('analysis.legend.restoreDraw')"
        @click="toggleCurveDrawn(curve)"
      >
        <AppIcon name="eye" :size="13" />
      </button>
      <button
        class="legend-del-btn"
        type="button"
        :title="t('analysis.legend.remove')"
        @click="removeCurveById(curve.id)"
      >
        <AppIcon name="close" :size="12" />
      </button>
    </div>
  </div>
</template>
