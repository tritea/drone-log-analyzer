<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useAnalysisStore } from '@/modules/analysis'
import CurveGroupCard from '@/modules/curves/components/CurveGroupCard.vue'

const analysis = useAnalysisStore()
const { activeFieldGroups, chart } = storeToRefs(analysis)

const hasAnyCurve = computed<boolean>(() => chart.value.activeCurves.length > 0)
</script>

<template>
  <div class="curve-list">
    <CurveGroupCard
      v-for="fieldGroup in activeFieldGroups"
      :key="fieldGroup.name"
      :group="fieldGroup"
    />
    <div v-if="!hasAnyCurve" class="empty-hint">从左侧字段面板添加曲线，图表会立即同步。</div>
  </div>
</template>
