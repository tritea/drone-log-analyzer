<script setup lang="ts">
import { storeToRefs } from 'pinia'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useEarthStore } from '@/modules/earth'
import { useView3dStore } from '@/modules/view3d'
import { useCustomModelsStore } from '@/modules/custom-models'
import { useTilesetsStore } from '@/modules/tilesets'
import RcHud from '@/modules/view3d/components/RcHud.vue'
import GeoSurfaceControls from '@/modules/shared/components/GeoSurfaceControls.vue'
import MapCachePanel from '@/modules/shared/components/MapCachePanel.vue'
import MapStatusNotice from '@/modules/shared/components/MapStatusNotice.vue'

const earthStore = useEarthStore()
const view3dStore = useView3dStore()
const cms = useCustomModelsStore()
const tilesetsStore = useTilesetsStore()
const { view3d } = storeToRefs(view3dStore)
</script>

<template>
  <div class="earth-view">
    <div :ref="earthStore.registerEarthMain" class="earth-canvas"></div>

    <GeoSurfaceControls
      :focus="earthStore.focusDrone"
      terrain
      models
      :models-active="cms.panelOpen"
      :toggle-models="cms.togglePanel"
      tiles
      :tiles-active="tilesetsStore.panelOpen"
      :toggle-tiles="tilesetsStore.togglePanel"
      :apply-terrain="earthStore.applyTerrain"
    />

    <MapStatusNotice />

    <RcHud v-if="view3d.rc.hud" :overlay="true" />
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
