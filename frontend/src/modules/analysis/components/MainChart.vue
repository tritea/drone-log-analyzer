<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useAnalysisStore } from '@/modules/analysis'
import { useUiStore } from '@/modules/shared/ui-store'

const { t } = useI18n()
const { ui } = storeToRefs(useUiStore())
const chartStore = useAnalysisStore()
const { chart, aiCurves } = storeToRefs(chartStore)

/** 图上是否完全没有可画曲线：用户曲线与 AI 临时叠加都算——空状态提示
 * 只在真正空图时显示（点 AI 卡片加载的临时曲线也该顶掉占位文字）。 */
const chartEmpty = computed(() => !chart.value.activeCurves.length && !aiCurves.value.length)
</script>

<template>
  <div class="chart-wrap" v-show="ui.mainView === 'chart'">
    <div id="main-chart" class="main-chart"></div>
    <div v-if="chartEmpty" class="chart-empty">{{ t('analysis.chart.empty') }}</div>
  </div>
</template>
