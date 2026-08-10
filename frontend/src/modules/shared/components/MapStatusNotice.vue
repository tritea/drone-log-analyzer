<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useMapStateStore } from '@/modules/shared/map-state'
import { useScene3dStore } from '@/modules/scene-3d'

const mapStore = useMapStateStore()
const sceneStore = useScene3dStore()
const { map } = storeToRefs(mapStore)
const { three } = storeToRefs(sceneStore)

const noGeoOrigin = (): boolean =>
  three.value.telemetry.samples.length > 0 && !three.value.telemetry.meta.geoOrigin
</script>

<template>
  <div v-if="map.loading" class="geo-notice">正在加载底图...</div>
  <div v-else-if="map.error" class="geo-notice is-error">{{ map.error }}</div>
  <div v-else-if="noGeoOrigin()" class="geo-notice">当前轨迹没有 GPS 经纬度，无法叠加轨迹与航点。</div>
</template>

<style scoped>
.geo-notice {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 1100;
  transform: translate(-50%, -50%);
  padding: 8px 14px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  color: #334155;
  font-size: 13px;
}

.geo-notice.is-error {
  color: #dc2626;
}
</style>
