<script setup lang="ts">
import { storeToRefs } from 'pinia'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useMapStateStore } from '@/modules/shared/map-state'
import { useMap3dStore } from '@/modules/map-3d'
import { useScene3dStore } from '@/modules/scene-3d'
import RcHud from '@/modules/scene-3d/components/RcHud.vue'
import GeoSurfaceControls from '@/modules/shared/components/GeoSurfaceControls.vue'
import MapCachePanel from '@/modules/shared/components/MapCachePanel.vue'
import MapStatusNotice from '@/modules/shared/components/MapStatusNotice.vue'

const mapStore = useMapStateStore()
const mapLibreStore = useMap3dStore()
const threeStore = useScene3dStore()
const { map } = storeToRefs(mapStore)
const { three } = storeToRefs(threeStore)
</script>

<template>
  <div class="maplibre-view">
    <div :ref="mapLibreStore.registerMapLibreMain" class="maplibre-canvas"></div>

    <GeoSurfaceControls
      :focus="mapLibreStore.focusDrone"
      terrain
      models
      :models-active="mapLibreStore.customModelsPanelOpen"
      :toggle-models="mapLibreStore.toggleCustomModelsPanel"
      :apply-terrain="() => mapLibreStore.applyTerrain(map.terrainOn)"
    />

    <MapStatusNotice />

    <RcHud v-if="three.rc.hud" :overlay="true" />
    <MapCachePanel />
  </div>
</template>

<style>
.maplibre-view {
  position: absolute;
  inset: 0;
  z-index: 5;
  background: #dfe5ec;
}

.maplibre-canvas {
  position: absolute;
  inset: 0;
}

.maplibre-view .rc-hud-overlay {
  z-index: 1100;
}

.maplibre-view .rc-hud-overlay .rc-stick-pad {
  bottom: 40px;
}
</style>
