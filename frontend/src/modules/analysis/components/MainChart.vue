<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useAnalysisStore } from '@/modules/analysis'
import { useUiStore } from '@/modules/shared/ui-store'

const { ui } = storeToRefs(useUiStore())
const chartStore = useAnalysisStore()
const { chart } = storeToRefs(chartStore)
</script>

<template>
  <div class="chart-wrap" v-show="ui.mainView === 'chart'">
    <div id="main-chart" class="main-chart"></div>
    <div v-if="!chart.activeCurves.length" class="chart-empty">选择左侧字段后显示曲线。</div>
  </div>
</template>
