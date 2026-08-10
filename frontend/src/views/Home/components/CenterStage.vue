<script setup lang="ts">
import ChartLegend from '@/modules/analysis/components/ChartLegend.vue'
import MainChart from '@/modules/analysis/components/MainChart.vue'
import Scene from '@/modules/scene-3d/components/Scene.vue'
</script>

<template>
  <div class="panel-center">
    <ChartLegend />
    <MainChart />
    <Scene />
  </div>
</template>
