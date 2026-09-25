<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useMapStateStore } from '@/modules/shared/map-state'
import { usePlaybackStore } from '@/modules/playback'

const { t } = useI18n()
const mapStore = useMapStateStore()
const playbackStore = usePlaybackStore()
const { map } = storeToRefs(mapStore)
const { telemetry } = storeToRefs(playbackStore)

const noGeoOrigin = (): boolean =>
  telemetry.value.samples.length > 0 && !telemetry.value.meta.geoOrigin
</script>

<template>
  <div v-if="map.loading" class="geo-notice">{{ t('map.notice.loading') }}</div>
  <div v-else-if="map.error" class="geo-notice is-error">{{ map.error }}</div>
  <div v-else-if="noGeoOrigin()" class="geo-notice">{{ t('map.notice.noGeo') }}</div>
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
