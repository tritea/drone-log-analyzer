<script setup lang="ts">
import { storeToRefs } from 'pinia'
import 'leaflet/dist/leaflet.css'
import { useMapStateStore } from '@/modules/shared/map-state'
import { useMap2dStore } from '@/modules/map-2d'
import { useScene3dStore } from '@/modules/scene-3d'
import RcHud from '@/modules/scene-3d/components/RcHud.vue'
import MapCachePanel from '@/modules/shared/components/MapCachePanel.vue'
import MapStatusNotice from '@/modules/shared/components/MapStatusNotice.vue'
import GeoSurfaceControls from '@/modules/shared/components/GeoSurfaceControls.vue'

const mapState = useMapStateStore()
const map2d = useMap2dStore()
const threeStore = useScene3dStore()
const { map } = storeToRefs(mapState)
const { three } = storeToRefs(threeStore)
</script>

<template>
  <div class="geo-board" v-show="map.active">
    <div :ref="map2d.registerMapMain" class="geo-canvas"></div>

    <GeoSurfaceControls :focus="map2d.focusDrone" />

    <MapStatusNotice />

    <RcHud v-if="three.rc.hud" :overlay="true" />

    <div v-if="map.tileError" class="geo-tile-warning">当前底图源加载失败，可以在右上角切换其他来源。</div>

    <MapCachePanel />
  </div>
</template>

<style>
.geo-board {
  position: absolute;
  inset: 0;
  z-index: 5;
  background: #e5eaf0;
}

.geo-canvas {
  position: absolute;
  inset: 0;
}

.geo-board .rc-hud-overlay {
  z-index: 1100;
}

.geo-board .rc-hud-overlay .rc-stick-pad {
  bottom: 40px;
}

.geo-board .leaflet-control-attribution {
  max-width: 90px;
  overflow: hidden;
  padding: 1px 6px;
  border-radius: 4px 0 0 0;
  background: rgba(255, 255, 255, 0.78);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  color: #475569;
  font-size: 10px;
  line-height: 16px;
  text-overflow: ellipsis;
  transition: max-width 0.25s ease;
  white-space: nowrap;
}

.geo-board .leaflet-control-attribution:hover {
  max-width: 85%;
}

.geo-tile-warning {
  position: absolute;
  top: 8px;
  left: 50%;
  z-index: 1100;
  max-width: calc(100% - 220px);
  transform: translateX(-50%);
  padding: 6px 12px;
  border: 1px solid #fecaca;
  border-radius: 6px;
  background: rgba(254, 226, 226, 0.96);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  color: #b91c1c;
  font-size: 12px;
  pointer-events: none;
}

.map-drone-icon,
.map-waypoint-icon {
  background: transparent;
  border: none;
}

.map-waypoint {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}

.map-waypoint-home {
  background: #0d9488;
}

.map-waypoint-nav {
  background: #7c3aed;
}
</style>
