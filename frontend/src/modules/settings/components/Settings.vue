<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useAnalysisStore } from '@/modules/analysis'
import { useView3dStore } from '@/modules/view3d'
import { usePlaybackStore } from '@/modules/playback'
import { useMapStateStore } from '@/modules/shared/map-state'
import { useLogStore } from '@/modules/log'
import { useUiStore } from '@/modules/shared/ui-store'
import { sourceLabel, type AppLocale } from '@/locales'
import type { PositionSource } from '@/profiles'
import AppIcon from '@/modules/shared/components/AppIcon.vue'

/* ---------------- props / emits ---------------------------------------- */
defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

/* ---------------- i18n / stores ----------------------------------------- */
const { t } = useI18n()
const analysis = useAnalysisStore()
const scene = useView3dStore()
const playbackStore = usePlaybackStore()
const mapState = useMapStateStore()
const logStore = useLogStore()
const uiStore = useUiStore()

const { chart } = storeToRefs(analysis)
const { view3d } = storeToRefs(scene)
const { map } = storeToRefs(mapState)
const { log } = storeToRefs(logStore)
const { ui } = storeToRefs(uiStore)

/* ---------------- derived ---------------------------------------------- */
/**
 * Position-source presets depend on the active log format (each format
 * exposes different sources), so the list is recomputed whenever the
 * format changes. The `void` read registers that reactive dependency.
 */
const positionPresets = computed<PositionSource[]>(() => {
  void log.value.summary?.format
  return Object.values(playbackStore.threePositionPresets())
})

/* ---------------- event helpers ---------------------------------------- */
// Tiny extractors so the template never needs inline `$event.target as ...`
// casts. Each maps an Event to the exact primitive the store action wants.

function num(evt: Event): number {
  return Number((evt.target as HTMLInputElement).value)
}

function str(evt: Event): string {
  return (evt.target as HTMLSelectElement).value
}

function flag(evt: Event): boolean {
  return (evt.target as HTMLInputElement).checked
}

/** Range inputs render resolution as a 25–100 percentage; divide back to 0–1. */
function resolutionFromPct(evt: Event): number {
  return num(evt) / 100
}

function onLanguageChange(evt: Event): void {
  uiStore.setLanguage(str(evt) as AppLocale)
}
</script>

<template>
  <div v-if="open" class="settings-overlay" @click.self="emit('close')">
    <div class="settings-modal">
      <div class="settings-head">
        <strong>{{ t('settings.title') }}</strong>
        <button class="btn-icon" type="button" :title="t('common.close')" @click="emit('close')">
          <AppIcon name="close" :size="15" />
        </button>
      </div>

      <div class="settings-body">
        <div class="settings-group">
          <div class="settings-group-title">{{ t('settings.general.title') }}</div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.language.label') }}</span>
            <select class="settings-select" :value="ui.language" @change="onLanguageChange($event)">
              <option value="zh-CN">中文</option>
              <option value="en-US">English</option>
            </select>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">{{ t('settings.curves.title') }}</div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.curves.lineWidth') }}</span>
            <input class="settings-range" type="range" min="1" max="6" step="0.5" :value="chart.lineWidth" @input="analysis.applyLineWidth(num($event))" />
            <span class="settings-value">{{ chart.lineWidth }}</span>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">{{ t('settings.main3d.title') }}</div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.main3d.model') }}</span>
            <select class="settings-select" :value="view3d.model" @change="scene.setModelForm(str($event))">
              <option value="glb">{{ t('settings.modelGlb') }}</option>
              <option value="lowpoly">{{ t('settings.modelLowpoly') }}</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.main3d.positionSource') }}</span>
            <select class="settings-select" v-model="view3d.camera.positionSource" @change="scene.handlePositionSourceChange()">
              <option v-for="preset in positionPresets" :key="preset.key" :value="preset.key">{{ sourceLabel(preset.label) }}</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.main3d.droneScale') }}</span>
            <input class="settings-range" type="range" min="0.1" max="20" step="0.1" :value="view3d.droneScale" @input="scene.setDroneScale(num($event))" />
            <span class="settings-value">{{ view3d.droneScale.toFixed(1) }}</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.main3d.groundGrid') }}</span>
            <input class="settings-check" type="checkbox" :checked="view3d.ground.show" @change="scene.toggleGround(flag($event))" />
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.main3d.debugPanel') }}</span>
            <input class="settings-check" type="checkbox" v-model="view3d.debug.posPanel" />
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">{{ t('settings.lighting.title') }}</div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.lighting.quality') }}<span class="settings-hint">{{ t('settings.lighting.qualityHint') }}</span></span>
            <input class="settings-check" type="checkbox" :checked="view3d.lighting.enabled" @change="scene.toggleLighting(flag($event))" />
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.lighting.env') }}</span>
            <input class="settings-range" type="range" min="0" max="3" step="0.1" :value="view3d.lighting.env" :disabled="!view3d.lighting.enabled" @input="scene.setLightingFactor('env', num($event))" />
            <span class="settings-value">{{ view3d.lighting.env.toFixed(1) }}</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.lighting.ambient') }}</span>
            <input class="settings-range" type="range" min="0" max="2" step="0.1" :value="view3d.lighting.ambient" @input="scene.setLightingFactor('ambient', num($event))" />
            <span class="settings-value">{{ view3d.lighting.ambient.toFixed(1) }}</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.lighting.key') }}</span>
            <input class="settings-range" type="range" min="0" max="2" step="0.1" :value="view3d.lighting.key" @input="scene.setLightingFactor('key', num($event))" />
            <span class="settings-value">{{ view3d.lighting.key.toFixed(1) }}</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.lighting.sky') }}</span>
            <input class="settings-check" type="checkbox" :checked="view3d.sky.enabled" @change="scene.toggleSky(flag($event))" />
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.lighting.cloud') }}</span>
            <input class="settings-range" type="range" min="0" max="1" step="0.1" :value="view3d.sky.cloud" :disabled="!view3d.sky.enabled" @input="scene.setCloudAmount(num($event))" />
            <span class="settings-value">{{ view3d.sky.cloud.toFixed(1) }}</span>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">{{ t('settings.water.title') }}</div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.water.enable') }}</span>
            <input class="settings-check" type="checkbox" :checked="view3d.water.enabled" @change="scene.toggleWater(flag($event))" />
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.water.wave') }}</span>
            <input class="settings-range" type="range" min="0" max="1" step="0.1" :value="view3d.water.wave" :disabled="!view3d.water.enabled" @input="scene.setWaveAmount(num($event))" />
            <span class="settings-value">{{ view3d.water.wave.toFixed(1) }}</span>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">{{ t('settings.render.title') }}</div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.render.quality') }}</span>
            <select class="settings-select" :value="view3d.render.quality" @change="scene.setQuality(str($event))">
              <option value="auto">{{ t('settings.quality.auto') }}</option>
              <option value="high">{{ t('settings.quality.high') }}</option>
              <option value="medium">{{ t('settings.quality.medium') }}</option>
              <option value="low">{{ t('settings.quality.low') }}</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.render.mainAa') }}</span>
            <select class="settings-select" :value="view3d.render.main.aa" @change="scene.setMainAa(str($event))">
              <option value="msaa">MSAA</option>
              <option value="fxaa">FXAA</option>
              <option value="off">{{ t('settings.aaOff') }}</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.render.mainResolution') }}</span>
            <input class="settings-range" type="range" min="25" max="100" step="5" :value="Math.round(view3d.render.main.resolution * 100)" @input="scene.setMainResolution(resolutionFromPct($event))" />
            <span class="settings-value">{{ Math.round(view3d.render.main.resolution * 100) }}%</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.render.fpsLimit') }}</span>
            <select class="settings-select" :value="view3d.render.fps" @change="scene.setMainFps(num($event))">
              <option :value="0">{{ t('settings.fpsUnlimited') }}</option>
              <option :value="30">30 FPS</option>
              <option :value="60">60 FPS</option>
              <option :value="120">120 FPS</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.render.attitudeModel') }}</span>
            <select class="settings-select" :value="view3d.dialModel" @change="scene.setDialModelForm(str($event))">
              <option value="glb">{{ t('settings.modelGlb') }}</option>
              <option value="lowpoly">{{ t('settings.modelLowpoly') }}</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.render.attitudeAa') }}</span>
            <select class="settings-select" :value="view3d.render.dial.aa" @change="scene.setDialAa(str($event))">
              <option value="msaa">MSAA</option>
              <option value="fxaa">FXAA</option>
              <option value="off">{{ t('settings.aaOff') }}</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.render.attitudeResolution') }}</span>
            <input class="settings-range" type="range" min="25" max="100" step="5" :value="Math.round(view3d.render.dial.resolution * 100)" @input="scene.setDialResolution(resolutionFromPct($event))" />
            <span class="settings-value">{{ Math.round(view3d.render.dial.resolution * 100) }}%</span>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">{{ t('settings.mapView.title') }}</div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.mapView.droneModel') }}</span>
            <select class="settings-select" :value="map.droneModel" @change="mapState.setMapDroneModel(str($event))">
              <option value="glb">{{ t('settings.modelGlb') }}</option>
              <option value="lowpoly">{{ t('settings.modelLowpoly') }}</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.mapView.shading') }}</span>
            <input class="settings-check" type="checkbox" :checked="map.droneShaded" @change="mapState.setMapDroneShaded(flag($event))" />
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.mapView.droneScale') }}</span>
            <input class="settings-range" type="range" min="0.1" max="20" step="0.1" :value="map.droneScale" @input="mapState.setMapDroneScale(num($event))" />
            <span class="settings-value">{{ map.droneScale.toFixed(1) }}</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">{{ t('settings.mapView.fps') }}</span>
            <select class="settings-select" :value="map.mapFps" @change="mapState.setMapFps(num($event))">
              <option :value="0">{{ t('settings.fpsUnlimited') }}</option>
              <option :value="30">30 FPS</option>
              <option :value="60">60 FPS</option>
              <option :value="120">120 FPS</option>
            </select>
          </div>
        </div>
      </div>

      <div class="settings-actions">
        <span class="settings-author">Drone Log Analyzer(by tritea)</span>
        <button class="btn btn-primary btn-xs" type="button" @click="emit('close')">{{ t('settings.done') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.settings-modal {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(15, 23, 42, 0.2);
  min-width: 380px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}
.settings-body {
  padding: 12px 16px;
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 0;
}
.settings-group + .settings-group { margin-top: 16px; }
.settings-group-title {
  font-size: 11px;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}
.settings-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}
.settings-label {
  flex: 1;
  font-size: 13px;
  color: #374151;
}
.settings-hint {
  margin-left: 6px;
  font-size: 11px;
  color: #9ca3af;
  font-weight: 400;
}
.settings-range { width: 150px; }
.settings-range:disabled { opacity: 0.45; cursor: not-allowed; }
.settings-check { width: 16px; height: 16px; cursor: pointer; }
.settings-select {
  min-width: 90px;
  padding: 3px 6px;
  font-size: 13px;
  color: #374151;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}
.settings-value {
  min-width: 40px;
  text-align: right;
  font: 600 12px Consolas, monospace;
  color: #6b7280;
}
.settings-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: 10px 16px;
  border-top: 1px solid #e5e7eb;
  flex-shrink: 0;
}
.settings-author {
  margin-right: auto;
  font-size: 10px;
  color: #b0b4bc;
  font-weight: 400;
  letter-spacing: 0.3px;
}
</style>
