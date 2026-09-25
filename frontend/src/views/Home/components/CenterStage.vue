<script setup lang="ts">
import ChartLegend from '@/modules/analysis/components/ChartLegend.vue'
import MainChart from '@/modules/analysis/components/MainChart.vue'
import Stage from '@/modules/view3d/components/Stage.vue'
</script>

<template>
  <div class="panel-center">
    <ChartLegend />
    <MainChart />
    <Stage />
  </div>
</template>
