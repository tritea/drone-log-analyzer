<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useMapStateStore } from '@/modules/shared/map-state'
import AppIcon from '@/modules/shared/components/AppIcon.vue'

const props = defineProps<{
  focus: () => void
  terrain?: boolean
  models?: boolean
  modelsActive?: boolean
  toggleModels?: () => void
  applyTerrain?: () => void
  tiles?: boolean
  tilesActive?: boolean
  toggleTiles?: () => void
}>()

const mapStore = useMapStateStore()
const { map } = storeToRefs(mapStore)

function setTerrain(checked: boolean): void {
  mapStore.setMapTerrain(checked)
  props.applyTerrain?.()
}
</script>

<template>
  <div class="geo-controls" :class="{ 'is-folded': map.controlBarCollapsed }">
    <button class="btn btn-xs geo-locate" type="button" @click="focus" title="定位到无人机当前位置">定位</button>
    <div class="geo-control-set">
      <select class="geo-provider" :value="map.providerId" @change="mapStore.setProvider(($event.target as HTMLSelectElement).value)" title="底图来源">
        <option v-for="provider in map.providers" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
      </select>
      <label v-if="terrain" class="geo-toggle" :title="mapStore.terrainAllowed() ? '启用 DEM 地形' : '当前底图不支持地形'">
        <input
          type="checkbox"
          :checked="map.terrainOn && mapStore.terrainAllowed()"
          :disabled="!mapStore.terrainAllowed()"
          @change="setTerrain(($event.target as HTMLInputElement).checked)"
        />
        <span>地形</span>
      </label>
      <label v-if="terrain" class="geo-toggle" title="锁定追随视角">
        <input type="checkbox" :checked="map.lockView" @change="mapStore.setMapLockView(($event.target as HTMLInputElement).checked)" />
        <span>锁定</span>
      </label>
      <button class="btn btn-xs" type="button" @click="mapStore.openCachePanel" title="查看或清理瓦片缓存">缓存</button>
      <button v-if="models" class="btn btn-xs" type="button" :class="{ active: modelsActive }" @click="toggleModels" title="管理自定义 3D 模型">模型</button>
      <button v-if="tiles" class="btn btn-xs" type="button" :class="{ active: tilesActive }" @click="toggleTiles" title="管理 3D Tiles 测绘模型">3D Tiles</button>
    </div>
    <button class="btn btn-xs geo-fold" type="button" @click="mapStore.toggleControlBar" :title="map.controlBarCollapsed ? '展开控件' : '收起控件'">
      <AppIcon :name="map.controlBarCollapsed ? 'chevron-down' : 'chevron-right'" :size="13" />
    </button>
  </div>
</template>

<style scoped>
.geo-controls {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1100;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  font-size: 12px;
}

.geo-control-set {
  display: flex;
  align-items: center;
  gap: 8px;
}

.geo-provider {
  height: 24px;
  box-sizing: border-box;
  padding: 2px 4px;
  font-size: 12px;
}

.geo-locate {
  font-weight: 600;
}

.geo-fold {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  padding: 0 6px;
  line-height: 1;
}

.geo-controls.is-folded {
  gap: 6px;
  padding: 4px;
}

.geo-controls.is-folded .geo-control-set {
  display: none;
}

.geo-toggle {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  user-select: none;
}
</style>
