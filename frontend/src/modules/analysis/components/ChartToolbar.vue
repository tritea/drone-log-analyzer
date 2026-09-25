<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useAnalysisStore } from '@/modules/analysis'
import { useUiStore } from '@/modules/shared/ui-store'
import { useLogStore } from '@/modules/log'
import { useView3dStore } from '@/modules/view3d'
import { usePlaybackStore } from '@/modules/playback'
import { useMapStateStore } from '@/modules/shared/map-state'
import AppIcon from '@/modules/shared/components/AppIcon.vue'
import AppButton from '@/modules/shared/components/AppButton.vue'
import ToolbarToggle from './ToolbarToggle.vue'
import Settings from '@/modules/settings/components/Settings.vue'
import type { ToggleDef } from './toggles'

const { t } = useI18n()

const view3dStore = useView3dStore()
const { view3d } = storeToRefs(view3dStore)
const { playback } = storeToRefs(usePlaybackStore())
const {
  setPrimaryView,
  setViewMode,
  setCameraControl,
  toggleCurveAxis,
  toggleMissionRoute,
  toggleWaypoints,
  toggleWholeTrajectory,
  togglePathOverlay,
} = view3dStore

const uiStore = useUiStore()
const { ui } = storeToRefs(uiStore)

const logStore = useLogStore()
const { currentLogFileName, log } = storeToRefs(logStore)
const { openLogFile } = logStore

const chartStore = useAnalysisStore()
const { chart, hiddenCurveCount } = storeToRefs(chartStore)
const { applyTooltipToggle, applyTagToggles, formatDuration, setRectZoomActive, resetZoom } = chartStore

/** 框选开关：激活后左键拖拽=框选放大，否则拖拽=平移（右键恒为重置）。 */
function toggleRectZoom(): void {
  setRectZoomActive(!ui.value.shiftZoomActive)
}

const mapStore = useMapStateStore()
const { map } = storeToRefs(mapStore)

const settingsOpen = ref(false)
const togglesOpen = ref(false)
const togglesBtnRef = ref<HTMLElement | null>(null)
const togglesPopupRef = ref<HTMLElement | null>(null)
const togglesPopupStyle = ref<Record<string, string>>({})

// 渲染器互斥切换：激活哪个只渲染哪个（切走的销毁、切回从头重建）。
function selectRenderer3D(): void {
  view3dStore.switchViewport('scene')
  setViewMode('free')
}

function selectRendererMap2D(): void {
  view3dStore.switchViewport('map2d')
}

function selectRendererEarth(): void {
  view3dStore.switchViewport('earth')
}

const chartToggles = computed<ToggleDef[]>(() => [
  { key: 'tip', label: t('analysis.toggles.tip.label'), title: t('analysis.toggles.tip.title'), checked: () => chart.value.tooltip, change: () => { chart.value.tooltip = !chart.value.tooltip; applyTooltipToggle() } },
  { key: 'err', label: t('analysis.toggles.err.label'), labelClass: 'event-tag event-tag-err', title: t('analysis.toggles.err.title'), checked: () => chart.value.showErrors, change: () => { chart.value.showErrors = !chart.value.showErrors; applyTagToggles() } },
  { key: 'ev', label: t('analysis.toggles.ev.label'), labelClass: 'event-tag event-tag-ev', title: t('analysis.toggles.ev.title'), checked: () => chart.value.showEvents, change: () => { chart.value.showEvents = !chart.value.showEvents; applyTagToggles() } },
  { key: 'msg', label: t('analysis.toggles.msg.label'), labelClass: 'event-tag event-tag-msg', title: t('analysis.toggles.msg.title'), checked: () => chart.value.showMessages, change: () => { chart.value.showMessages = !chart.value.showMessages; applyTagToggles() } },
])

const threeToggles = computed<ToggleDef[]>(() => [
  { key: 'path', label: t('analysis.toggles.path.label'), title: t('analysis.toggles.path.title'), checked: () => map.value.showPath, change: togglePathOverlay },
  { key: 'full', label: t('analysis.toggles.full.label'), title: t('analysis.toggles.full.title'), checked: () => view3d.value.camera.fullTrajectory, change: toggleWholeTrajectory },
  { key: 'curve', label: t('analysis.toggles.curve.label'), title: t('analysis.toggles.curve.title'), checked: () => playback.value.curveAxis, change: toggleCurveAxis },
  { key: 'route', label: t('analysis.toggles.route.label'), title: t('analysis.toggles.route.title'), checked: () => map.value.showRoute, change: toggleMissionRoute },
  { key: 'wp', label: t('analysis.toggles.wp.label'), title: t('analysis.toggles.wp.title'), checked: () => map.value.showWaypoints, change: toggleWaypoints },
  { key: 'rc', label: t('analysis.toggles.rc.label'), title: t('analysis.toggles.rc.title'), checked: () => view3d.value.rc.hud, change: () => { view3d.value.rc.hud = !view3d.value.rc.hud } },
])

const currentToggles = computed(() => (ui.value.mainView === 'chart' ? chartToggles.value : threeToggles.value))

function positionTogglesPopup(): void {
  const btn = togglesBtnRef.value
  if (!btn) return
  const rect = btn.getBoundingClientRect()
  togglesPopupStyle.value = {
    top: `${rect.bottom + 6}px`,
    right: `${document.documentElement.clientWidth - rect.right}px`,
  }
}

function toggleToggles(): void {
  togglesOpen.value = !togglesOpen.value
  if (togglesOpen.value) void nextTick(positionTogglesPopup)
}

function onDocDown(e: MouseEvent): void {
  if (!togglesOpen.value) return
  const target = e.target as Node
  if (togglesBtnRef.value?.contains(target)) return
  if (togglesPopupRef.value?.contains(target)) return
  togglesOpen.value = false
}

function onWinResize(): void {
  if (togglesOpen.value) positionTogglesPopup()
}

onMounted(() => {
  document.addEventListener('mousedown', onDocDown)
  window.addEventListener('resize', onWinResize)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown)
  window.removeEventListener('resize', onWinResize)
})

watch(() => ui.value.mainView, () => {
  togglesOpen.value = false
})
</script>

<template>
  <div class="chart-toolbar topbar">
    <img class="brand-mark" src="/image/logo.png" alt="Drone Log Analyzer" />

    <AppButton variant="primary" size="xs" icon="folder" class="open-file-btn" :title="t('analysis.toolbar.openTitle')" @click="openLogFile">{{ t('analysis.toolbar.open') }}</AppButton>

    <div class="chart-title">
      <div class="view-tabs">
        <button class="view-tab" :class="{ 'is-active': ui.mainView === 'chart' }" type="button" @click="setPrimaryView('chart')">{{ t('analysis.toolbar.viewTab.chart') }}</button>
        <button class="view-tab" :class="{ 'is-active': ui.mainView === 'three' }" type="button" @click="setPrimaryView('three')">{{ t('analysis.toolbar.viewTab.viz') }}</button>
      </div>
      <span v-if="currentLogFileName" class="chart-file-name" :title="currentLogFileName">{{ currentLogFileName }}</span>
    </div>

    <div class="topbar-spacer"></div>

    <div class="chart-controls">
      <template v-if="ui.mainView === 'chart'">
        <AppButton size="xs" icon-only icon="rect-zoom" :active="ui.shiftZoomActive" :title="t('analysis.toolbar.rectZoomTitle')" @click="toggleRectZoom" />
        <AppButton size="xs" icon-only icon="reset" :title="t('analysis.toolbar.resetZoomTitle')" @click="resetZoom" />
      </template>
      <span v-if="ui.mainView === 'chart' && hiddenCurveCount" class="chart-hidden-count">{{ t('analysis.toolbar.hiddenCount', { n: hiddenCurveCount }) }}</span>
      <template v-if="ui.mainView === 'three'">
        <div class="seg">
          <button class="seg-btn" :class="{ 'is-active': !map.active && view3d.camera.mode === 'free' }" type="button" @click="selectRenderer3D" :title="t('analysis.toolbar.seg.threeTitle')">3D</button>
          <button class="seg-btn" :class="{ 'is-active': map.active && map.renderer === '2d' }" type="button" @click="selectRendererMap2D" :title="t('analysis.toolbar.seg.map2dTitle')">2D</button>
          <button class="seg-btn" :class="{ 'is-active': map.active && map.renderer === 'earth' }" type="button" @click="selectRendererEarth" :title="t('analysis.toolbar.seg.earthTitle')">{{ t('analysis.toolbar.seg.earthBtn') }}</button>
        </div>
        <div class="seg" v-if="view3d.camera.mode === 'free'">
          <button class="seg-btn" :class="{ 'is-active': view3d.camera.control === 'fps' }" type="button" @click="setCameraControl('fps')" :title="t('analysis.toolbar.camera.freeTitle')">{{ t('analysis.toolbar.camera.free') }}</button>
          <button class="seg-btn" :class="{ 'is-active': view3d.camera.control === 'lock' }" type="button" @click="setCameraControl('lock')" :title="t('analysis.toolbar.camera.lockTitle')">{{ t('analysis.toolbar.camera.lock') }}</button>
        </div>
      </template>

      <button ref="togglesBtnRef" class="btn btn-xs" :class="{ 'btn-primary': togglesOpen }" type="button" @click="toggleToggles" :title="t('analysis.toolbar.togglesTitle')">
        {{ t('analysis.toolbar.togglesBtn') }}
        <AppIcon :name="togglesOpen ? 'chevron-down' : 'chevron-right'" :size="13" />
      </button>
    </div>

    <div class="topbar-actions">
      <AppButton size="xs" :active="ui.agentOpen" :title="t('analysis.toolbar.agentTitle')" @click="ui.agentOpen = !ui.agentOpen">{{ t('analysis.toolbar.agentBtn') }}</AppButton>
      <AppButton size="xs" :title="t('analysis.toolbar.recordsTitle')" @click="ui.recordOpen = true">{{ t('analysis.toolbar.recordsBtn') }}</AppButton>
      <AppButton icon="settings" icon-only :title="t('analysis.toolbar.settingsTitle')" @click="settingsOpen = true" />
    </div>

    <div class="topbar-status" v-if="log.summary">
      <span class="badge">{{ log.summary.vehicleType || '?' }}</span>
      <span class="badge">{{ log.summary.firmwareVersion || 'N/A' }}</span>
      <span class="badge badge-green">{{ formatDuration(log.summary.durationSecs || 0) }}</span>
      <span class="badge" v-if="log.summary.frame">{{ log.summary.frame }}</span>
    </div>

    <Teleport to="body">
      <div v-if="togglesOpen" ref="togglesPopupRef" class="stats-overflow-popup" :style="togglesPopupStyle">
        <ToolbarToggle v-for="toggle in currentToggles" :key="toggle.key" :item="toggle" />
      </div>
    </Teleport>

    <Settings :open="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>
