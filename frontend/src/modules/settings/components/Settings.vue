<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useAnalysisStore } from '@/modules/analysis'
import { useScene3dStore } from '@/modules/scene-3d'
import { useMapStateStore } from '@/modules/shared/map-state'
import { useLogStore } from '@/modules/log'
import type { PositionSource } from '@/profiles'
import AppIcon from '@/modules/shared/components/AppIcon.vue'

/* ---------------- props / emits ---------------------------------------- */
defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

/* ---------------- stores ----------------------------------------------- */
const analysis = useAnalysisStore()
const scene = useScene3dStore()
const mapState = useMapStateStore()
const logStore = useLogStore()

const { chart } = storeToRefs(analysis)
const { three } = storeToRefs(scene)
const { map } = storeToRefs(mapState)
const { log } = storeToRefs(logStore)

/* ---------------- derived ---------------------------------------------- */
/**
 * Position-source presets depend on the active log format (each format
 * exposes different sources), so the list is recomputed whenever the
 * format changes. The `void` read registers that reactive dependency.
 */
const positionPresets = computed<PositionSource[]>(() => {
  void log.value.summary?.format
  return Object.values(scene.threePositionPresets())
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
</script>

<template>
  <div v-if="open" class="settings-overlay" @click.self="emit('close')">
    <div class="settings-modal">
      <div class="settings-head">
        <strong>设置</strong>
        <button class="btn-icon" type="button" title="关闭" @click="emit('close')">
          <AppIcon name="close" :size="15" />
        </button>
      </div>

      <div class="settings-body">
        <div class="settings-group">
          <div class="settings-group-title">曲线</div>
          <div class="settings-row">
            <span class="settings-label">线宽</span>
            <input class="settings-range" type="range" min="1" max="6" step="0.5" :value="chart.lineWidth" @input="analysis.onLinewidthChange(num($event))" />
            <span class="settings-value">{{ chart.lineWidth }}</span>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">主 3D 视图</div>
          <div class="settings-row">
            <span class="settings-label">模型</span>
            <select class="settings-select" :value="three.model" @change="scene.onModelChange(str($event))">
              <option value="glb">精细 GLB</option>
              <option value="lowpoly">轻量模型</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="settings-label">位置来源</span>
            <select class="settings-select" v-model="three.view.positionSource" @change="scene.onThreePositionSourceChange()">
              <option v-for="preset in positionPresets" :key="preset.key" :value="preset.key">{{ preset.label }}</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="settings-label">无人机缩放</span>
            <input class="settings-range" type="range" min="0.1" max="20" step="0.1" :value="three.droneScale" @input="scene.onDroneScaleChange(num($event))" />
            <span class="settings-value">{{ three.droneScale.toFixed(1) }}</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">地面网格</span>
            <input class="settings-check" type="checkbox" :checked="three.ground.show" @change="scene.onGroundToggle(flag($event))" />
          </div>
          <div class="settings-row">
            <span class="settings-label">位置调试面板</span>
            <input class="settings-check" type="checkbox" v-model="three.debug.posPanel" />
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">光照与天空</div>
          <div class="settings-row">
            <span class="settings-label">高质量光照<span class="settings-hint">关闭可提升低端设备帧率</span></span>
            <input class="settings-check" type="checkbox" :checked="three.lighting.enabled" @change="scene.onLightingToggle(flag($event))" />
          </div>
          <div class="settings-row">
            <span class="settings-label">环境反射</span>
            <input class="settings-range" type="range" min="0" max="3" step="0.1" :value="three.lighting.env" :disabled="!three.lighting.enabled" @input="scene.onLightingChange('env', num($event))" />
            <span class="settings-value">{{ three.lighting.env.toFixed(1) }}</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">环境光</span>
            <input class="settings-range" type="range" min="0" max="2" step="0.1" :value="three.lighting.ambient" @input="scene.onLightingChange('ambient', num($event))" />
            <span class="settings-value">{{ three.lighting.ambient.toFixed(1) }}</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">主光</span>
            <input class="settings-range" type="range" min="0" max="2" step="0.1" :value="three.lighting.key" @input="scene.onLightingChange('key', num($event))" />
            <span class="settings-value">{{ three.lighting.key.toFixed(1) }}</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">天空</span>
            <input class="settings-check" type="checkbox" :checked="three.sky.enabled" @change="scene.onSkyToggle(flag($event))" />
          </div>
          <div class="settings-row">
            <span class="settings-label">云量</span>
            <input class="settings-range" type="range" min="0" max="1" step="0.1" :value="three.sky.cloud" :disabled="!three.sky.enabled" @input="scene.onSkyCloudChange(num($event))" />
            <span class="settings-value">{{ three.sky.cloud.toFixed(1) }}</span>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">水面</div>
          <div class="settings-row">
            <span class="settings-label">启用水面</span>
            <input class="settings-check" type="checkbox" :checked="three.water.enabled" @change="scene.onWaterToggle(flag($event))" />
          </div>
          <div class="settings-row">
            <span class="settings-label">波浪强度</span>
            <input class="settings-range" type="range" min="0" max="1" step="0.1" :value="three.water.wave" :disabled="!three.water.enabled" @input="scene.onWaterWaveChange(num($event))" />
            <span class="settings-value">{{ three.water.wave.toFixed(1) }}</span>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">渲染</div>
          <div class="settings-row">
            <span class="settings-label">画质</span>
            <select class="settings-select" :value="three.render.quality" @change="scene.onQualityChange(str($event))">
              <option value="auto">自动</option>
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="settings-label">主视图抗锯齿</span>
            <select class="settings-select" :value="three.render.main.aa" @change="scene.onMainAaChange(str($event))">
              <option value="msaa">MSAA</option>
              <option value="fxaa">FXAA</option>
              <option value="off">关闭</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="settings-label">主视图分辨率</span>
            <input class="settings-range" type="range" min="25" max="100" step="5" :value="Math.round(three.render.main.resolution * 100)" @input="scene.onMainResolutionChange(resolutionFromPct($event))" />
            <span class="settings-value">{{ Math.round(three.render.main.resolution * 100) }}%</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">帧率上限</span>
            <select class="settings-select" :value="three.render.fps" @change="scene.onMainFpsChange(num($event))">
              <option :value="0">不限</option>
              <option :value="30">30 FPS</option>
              <option :value="60">60 FPS</option>
              <option :value="120">120 FPS</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="settings-label">姿态仪模型</span>
            <select class="settings-select" :value="three.attitudeModel" @change="scene.onAttitudeModelChange(str($event))">
              <option value="glb">精细 GLB</option>
              <option value="lowpoly">轻量模型</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="settings-label">姿态仪抗锯齿</span>
            <select class="settings-select" :value="three.render.attitude.aa" @change="scene.onAttitudeAaChange(str($event))">
              <option value="msaa">MSAA</option>
              <option value="fxaa">FXAA</option>
              <option value="off">关闭</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="settings-label">姿态仪分辨率</span>
            <input class="settings-range" type="range" min="25" max="100" step="5" :value="Math.round(three.render.attitude.resolution * 100)" @input="scene.onAttitudeResolutionChange(resolutionFromPct($event))" />
            <span class="settings-value">{{ Math.round(three.render.attitude.resolution * 100) }}%</span>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">地图视图</div>
          <div class="settings-row">
            <span class="settings-label">地图无人机模型</span>
            <select class="settings-select" :value="map.droneModel" @change="mapState.setMapDroneModel(str($event))">
              <option value="glb">精细 GLB</option>
              <option value="lowpoly">轻量模型</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="settings-label">模型着色</span>
            <input class="settings-check" type="checkbox" :checked="map.droneShaded" @change="mapState.setMapDroneShaded(flag($event))" />
          </div>
          <div class="settings-row">
            <span class="settings-label">地图模型缩放</span>
            <input class="settings-range" type="range" min="0.1" max="20" step="0.1" :value="map.droneScale" @input="mapState.setMapDroneScale(num($event))" />
            <span class="settings-value">{{ map.droneScale.toFixed(1) }}</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">地图帧率</span>
            <select class="settings-select" :value="map.mapFps" @change="mapState.setMapFps(num($event))">
              <option :value="0">不限</option>
              <option :value="30">30 FPS</option>
              <option :value="60">60 FPS</option>
              <option :value="120">120 FPS</option>
            </select>
          </div>
        </div>
      </div>

      <div class="settings-actions">
        <span class="settings-author">Drone Log Analyzer(by tritea)</span>
        <button class="btn btn-primary btn-xs" type="button" @click="emit('close')">完成</button>
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
