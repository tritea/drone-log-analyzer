<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useMapStateStore } from '@/modules/shared/map-state'
import { formatBytes } from '@/modules/shared/utils/format'
import AppButton from '@/modules/shared/components/AppButton.vue'

const { t } = useI18n()
const mapStore = useMapStateStore()
const { cache } = storeToRefs(mapStore)
</script>

<template>
  <div v-if="cache.open" class="geo-cache-backdrop" @click.self="mapStore.closeCachePanel">
    <div class="geo-cache-sheet">
      <div class="geo-cache-titlebar">
        <strong>{{ t('map.cache.title') }}</strong>
        <AppButton size="xs" @click="mapStore.closeCachePanel">{{ t('common.close') }}</AppButton>
      </div>
      <div class="geo-cache-path" :title="cache.dir">{{ t('map.cache.dir', { dir: cache.dir || '-' }) }}</div>
      <div class="geo-cache-total">{{ t('map.cache.total', { total: formatBytes(cache.totalBytes), cap: formatBytes(cache.capBytes) }) }}</div>
      <div class="geo-cache-list">
        <div v-for="provider in cache.providers" :key="provider.id" class="geo-cache-item">
          <span class="geo-cache-name">{{ provider.name }}</span>
          <span class="geo-cache-meta">{{ t('map.cache.tiles', { size: formatBytes(provider.sizeBytes), n: provider.tileCount }) }}</span>
          <AppButton size="xs" :disabled="provider.sizeBytes === 0" @click="mapStore.clearCacheProvider(provider.id)">{{ t('map.cache.clean') }}</AppButton>
        </div>
      </div>
      <div class="geo-cache-actions">
        <AppButton size="xs" :disabled="cache.loading" @click="mapStore.loadCacheStats">{{ t('common.refresh') }}</AppButton>
        <AppButton size="xs" variant="danger" @click="mapStore.clearCacheAll">{{ t('map.cache.clearAll') }}</AppButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.geo-cache-backdrop {
  position: absolute;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.35);
}

.geo-cache-sheet {
  width: min(420px, 92%);
  padding: 14px 16px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
  color: #1e293b;
  font-size: 13px;
}

.geo-cache-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.geo-cache-path {
  overflow: hidden;
  color: #64748b;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.geo-cache-total {
  margin: 6px 0 10px;
  color: #334155;
}

.geo-cache-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.geo-cache-item {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 6px;
  background: #f8fafc;
}

.geo-cache-name {
  font-weight: 600;
}

.geo-cache-meta {
  color: #64748b;
  font-size: 12px;
}

.geo-cache-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.geo-cache-actions .is-danger {
  border-color: #fecaca;
  color: #b91c1c;
}
</style>
