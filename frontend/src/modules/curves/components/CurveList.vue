<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useAnalysisStore } from '@/modules/analysis'
import CurveGroupCard from '@/modules/curves/components/CurveGroupCard.vue'

const { t } = useI18n()
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
    <div v-if="!hasAnyCurve" class="empty-hint">{{ t('curves.list.emptyHint') }}</div>
  </div>
</template>
