<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { sourceLabel } from '@/locales'
import { useUiStore } from '@/modules/shared/ui-store'
import { useView3dStore } from '@/modules/view3d'
import { usePlaybackStore } from '@/modules/playback'
import { useMapStateStore } from '@/modules/shared/map-state'
import { useCustomModelsStore } from '@/modules/custom-models'
import { useLogStore } from '@/modules/log'
import RcHud from '@/modules/view3d/components/RcHud.vue'
import FlightMetricsGrid from '@/modules/flight-metrics/components/FlightMetricsGrid.vue'
import DialPanel from '@/modules/view3d/components/DialPanel.vue'
import HorizonDial from '@/modules/view3d/components/HorizonDial.vue'
import CurveAxis from '@/modules/view3d/components/CurveAxis.vue'
import Timeline from '@/modules/view3d/components/Timeline.vue'
import DebugPanel from '@/modules/view3d/components/DebugPanel.vue'
import Map2dView from '@/modules/map-2d/components/Map2dView.vue'
import EarthView from '@/modules/earth/components/EarthView.vue'
import CustomModelsPanel from '@/modules/custom-models/components/CustomModelsPanel.vue'
import TilesetsPanel from '@/modules/tilesets/components/TilesetsPanel.vue'
import { useTilesetsStore } from '@/modules/tilesets'

const { t } = useI18n()
const view3dStore = useView3dStore()
const playbackStore = usePlaybackStore()
const { view3d } = storeToRefs(view3dStore)
const { playback, telemetry } = storeToRefs(playbackStore)
const { handleAttitudeSourceChange, toggleAttitudeCompare, setCompareSource } = view3dStore
const { log } = storeToRefs(useLogStore())
const attitudeOptions = computed(() => { void log.value.summary?.format; return Object.values(playbackStore.threeAttitudePresets()) })
const registerMainHost = (el: any): void => { view3dStore.registerMainHost(el) }
const { ui } = storeToRefs(useUiStore())
const { map } = storeToRefs(useMapStateStore())
const cms = useCustomModelsStore()
const tilesetsStore = useTilesetsStore()
const customModelsSideOpen = computed(() => map.value.active && map.value.renderer === 'earth' && cms.panelOpen)
const tilesetsSideOpen = computed(() => map.value.active && map.value.renderer === 'earth' && tilesetsStore.panelOpen)
const sidePanelOpen = computed(() => customModelsSideOpen.value || tilesetsSideOpen.value)
</script>

<template>
  <div class="three-view" :class="{ 'three-curve-on': playback.curveAxis }" :style="playback.curveAxis ? { '--three-curve-h': playback.curveHeight + 'px' } : null" v-show="ui.mainView === 'three'">
    <div class="three-main">
      <div :ref="registerMainHost" class="three-canvas" v-show="!map.active"></div>
      <Map2dView v-show="map.active && map.renderer === '2d'" />
      <EarthView v-show="map.active && map.renderer === 'earth'" />
      <RcHud v-if="view3d.rc.hud" :overlay="true" />
      <DebugPanel />
      <div v-if="telemetry.loading" class="three-empty">{{ t('scene3d.scene.loadingTelemetry') }}</div>
      <div v-if="telemetry.error" class="three-empty error">{{ telemetry.error }}</div>
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
          <strong>{{ t('scene3d.scene.attitudeTitle') }}</strong>
          <select
            class="three-attitude-source"
            v-model="view3d.camera.attitudeSource"
            @change="handleAttitudeSourceChange"
            :title="telemetry.meta.attitude || t('scene3d.scene.attitudeSourceTitle')"
          >
            <option v-for="s in attitudeOptions" :key="s.key" :value="s.key">{{ sourceLabel(s.label) }}</option>
          </select>
          <label class="attitude-compare-toggle" :title="t('scene3d.scene.compareTitle')">
            <input type="checkbox" v-model="view3d.camera.compareAttitude" @change="toggleAttitudeCompare" />
            <span>{{ t('scene3d.scene.compare') }}</span>
          </label>
          <select
            v-if="view3d.camera.compareAttitude"
            class="three-attitude-source"
            v-model="view3d.camera.compareSource"
            @change="setCompareSource"
            :title="t('scene3d.scene.compareSourceTitle')"
          >
            <option v-for="s in attitudeOptions" :key="s.key" :value="s.key">{{ sourceLabel(s.label) }}</option>
          </select>
        </div>
        <DialPanel />
        <HorizonDial />
      </div>
      <FlightMetricsGrid v-show="!sidePanelOpen" />
    </div>
    <CurveAxis />
    <Timeline v-if="!playback.curveAxis" />
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
