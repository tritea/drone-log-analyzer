<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useFlightMetricsStore } from '@/modules/flight-metrics';
import AppButton from '@/modules/shared/components/AppButton.vue';
import FlightMetricTile from './FlightMetricTile.vue';
import FlightMetricDialog from './FlightMetricDialog.vue';

const metrics = useFlightMetricsStore();
const { flightMetrics } = storeToRefs(metrics);
</script>

<template>
  <div class="three-side-panel metrics-panel">
    <div class="three-side-head">
      <strong>飞行数据</strong>
      <AppButton size="xs" icon="plus" class="metric-add-btn" title="添加显示项" @click="metrics.openPicker()" />
    </div>
    <div class="three-side-scroll">
      <div class="metric-grid">
        <FlightMetricTile v-for="it in flightMetrics.items" :key="it.id" :item="it" />
      </div>
      <div v-if="!flightMetrics.items.length" class="metric-empty-hint">无显示项，点击 + 添加</div>
    </div>
    <FlightMetricDialog />
  </div>
</template>
