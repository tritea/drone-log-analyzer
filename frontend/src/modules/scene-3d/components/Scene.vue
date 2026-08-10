<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useUiStore } from '@/modules/shared/ui-store'
import { useScene3dStore } from '@/modules/scene-3d'
import { useMapStateStore } from '@/modules/shared/map-state'
import { useMap3dStore } from '@/modules/map-3d'
import { useLogStore } from '@/modules/log'
import RcHud from '@/modules/scene-3d/components/RcHud.vue'
import FlightMetricsGrid from '@/modules/flight-metrics/components/FlightMetricsGrid.vue'
import AttitudePanel from '@/modules/scene-3d/components/AttitudePanel.vue'
import AttitudeDial from '@/modules/scene-3d/components/AttitudeDial.vue'
import CurveAxis from '@/modules/scene-3d/components/CurveAxis.vue'
import Timeline from '@/modules/scene-3d/components/Timeline.vue'
import DebugPanel from '@/modules/scene-3d/components/DebugPanel.vue'
import Map2dView from '@/modules/map-2d/components/Map2dView.vue'
import Map3dView from '@/modules/map-3d/components/Map3dView.vue'
import EarthView from '@/modules/earth/components/EarthView.vue'
import CustomModelsPanel from '@/modules/custom-models/components/CustomModelsPanel.vue'
import TilesetsPanel from '@/modules/tilesets/components/TilesetsPanel.vue'
import { useTilesetsStore } from '@/modules/tilesets'

const threeStore = useScene3dStore()
const { three } = storeToRefs(threeStore)
const { fitThreeCamera, onThreeAttitudeSourceChange, onCompareAttitudeToggle, onCompareSourceChange } = threeStore
const { log } = storeToRefs(useLogStore())
const attitudeOptions = computed(() => { void log.value.summary?.format; return Object.values(threeStore.threeAttitudePresets()) })
const registerThreeMain = (el: any): void => { threeStore.registerThreeMain(el) }
const { ui } = storeToRefs(useUiStore())
const { map } = storeToRefs(useMapStateStore())
const mapLibreStore = useMap3dStore()
const tilesetsStore = useTilesetsStore()
const customModelsSideOpen = computed(() => map.value.active && (map.value.renderer === '3d' || map.value.renderer === 'earth') && mapLibreStore.customModelsPanelOpen)
const tilesetsSideOpen = computed(() => map.value.active && map.value.renderer === 'earth' && tilesetsStore.panelOpen)
const sidePanelOpen = computed(() => customModelsSideOpen.value || tilesetsSideOpen.value)
</script>

<template>
  <div class="three-view" :class="{ 'three-curve-on': three.playback.curveAxis }" :style="three.playback.curveAxis ? { '--three-curve-h': three.playback.curveHeight + 'px' } : null" v-show="ui.mainView === 'three'">
    <div class="three-main">
      <div :ref="registerThreeMain" class="three-canvas" v-show="!map.active"></div>
      <Map2dView v-show="map.active && map.renderer === '2d'" />
      <Map3dView v-show="map.active && map.renderer === '3d'" />
      <EarthView v-show="map.active && map.renderer === 'earth'" />
      <RcHud v-if="three.rc.hud" :overlay="true" />
      <DebugPanel />
      <div v-if="three.telemetry.loading" class="three-empty">正在加载3D遥测...</div>
      <div v-if="three.telemetry.error" class="three-empty error">{{ three.telemetry.error }}</div>
    </div>
    <div class="three-side">
      <div v-show="tilesetsSideOpen" class="custom-models-side">
        <TilesetsPanel />
      </div>
      <div v-show="!tilesetsSideOpen && customModelsSideOpen" class="custom-models-side">
        <CustomModelsPanel />
      </div>
      <div v-show="!sidePanelOpen" class="attitude-card">
        <div class="three-side-head attitude-card-head">
          <strong>当前姿态</strong>
          <select
            class="three-attitude-source"
            v-model="three.view.attitudeSource"
            @change="onThreeAttitudeSourceChange"
            :title="three.telemetry.meta.attitude || '姿态数据来源'"
          >
            <option v-for="s in attitudeOptions" :key="s.key" :value="s.key">{{ s.label }}</option>
          </select>
          <label class="attitude-compare-toggle" title="叠加第二姿态源(半透明虚影)与主无人机对照">
            <input type="checkbox" v-model="three.view.compareAttitude" @change="onCompareAttitudeToggle" />
            <span>对比</span>
          </label>
          <select
            v-if="three.view.compareAttitude"
            class="three-attitude-source"
            v-model="three.view.compareSource"
            @change="onCompareSourceChange"
            title="虚影无人机姿态源"
          >
            <option v-for="s in attitudeOptions" :key="s.key" :value="s.key">{{ s.label }}</option>
          </select>
        </div>
        <AttitudePanel />
        <AttitudeDial />
      </div>
      <FlightMetricsGrid v-show="!sidePanelOpen" />
    </div>
    <CurveAxis />
    <Timeline v-if="!three.playback.curveAxis" />
  </div>
</template>

<style scoped>

.custom-models-side {
  grid-row: 1 / -1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.custom-models-side :deep(.custom-models-panel) {
  flex: 1;
  overflow: auto;
}
</style>