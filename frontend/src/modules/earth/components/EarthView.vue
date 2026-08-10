<script setup lang="ts">
import { storeToRefs } from 'pinia'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useEarthStore } from '@/modules/earth'
import { useScene3dStore } from '@/modules/scene-3d'
import { useMap3dStore } from '@/modules/map-3d'
import { useTilesetsStore } from '@/modules/tilesets'
import RcHud from '@/modules/scene-3d/components/RcHud.vue'
import GeoSurfaceControls from '@/modules/shared/components/GeoSurfaceControls.vue'
import MapCachePanel from '@/modules/shared/components/MapCachePanel.vue'
import MapStatusNotice from '@/modules/shared/components/MapStatusNotice.vue'

const earthStore = useEarthStore()
const threeStore = useScene3dStore()
const mapLibreStore = useMap3dStore()
const tilesetsStore = useTilesetsStore()
const { three } = storeToRefs(threeStore)
</script>

<template>
  <div class="earth-view">
    <div :ref="earthStore.registerEarthMain" class="earth-canvas"></div>

    <GeoSurfaceControls
      :focus="earthStore.focusDrone"
      terrain
      models
      :models-active="mapLibreStore.customModelsPanelOpen"
      :toggle-models="mapLibreStore.toggleCustomModelsPanel"
      tiles
      :tiles-active="tilesetsStore.panelOpen"
      :toggle-tiles="tilesetsStore.togglePanel"
      :apply-terrain="earthStore.applyTerrain"
    />

    <MapStatusNotice />

    <RcHud v-if="three.rc.hud" :overlay="true" />
    <MapCachePanel />
  </div>
</template>

<style>
.earth-view {
  position: absolute;
  inset: 0;
  z-index: 5;
  background: #000;
}

.earth-canvas {
  position: absolute;
  inset: 0;
}

.earth-view .cesium-viewer {
  background: #000;
}

.earth-view .cesium-viewer-bottom {
  display: none;
}

.earth-view .rc-hud-overlay {
  z-index: 1100;
}

.earth-view .rc-hud-overlay .rc-stick-pad {
  bottom: 12px;
}
</style>
