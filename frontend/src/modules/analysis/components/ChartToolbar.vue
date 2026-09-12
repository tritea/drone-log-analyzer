<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useAnalysisStore } from '@/modules/analysis'
import { useUiStore } from '@/modules/shared/ui-store'
import { useLogStore } from '@/modules/log'
import { useScene3dStore } from '@/modules/scene-3d'
import { useMapStateStore } from '@/modules/shared/map-state'
import AppIcon from '@/modules/shared/components/AppIcon.vue'
import AppButton from '@/modules/shared/components/AppButton.vue'
import ToolbarToggle from './ToolbarToggle.vue'
import Settings from '@/modules/settings/components/Settings.vue'
import type { ToggleDef } from './toggles'

const threeStore = useScene3dStore()
const { three } = storeToRefs(threeStore)
const {
  setMainView,
  setThreeViewMode,
  setThreeCameraMode,
  toggleThreeCurveAxis,
  toggleThreeMissionRoute,
  toggleThreeWaypoints,
  toggleFullTrajectory,
  toggleThreePath,
} = threeStore

const uiStore = useUiStore()
const { ui } = storeToRefs(uiStore)

const logStore = useLogStore()
const { currentLogFileName, log } = storeToRefs(logStore)
const { openLogFile } = logStore

const chartStore = useAnalysisStore()
const { chart, hiddenCurveCount } = storeToRefs(chartStore)
const { onChartTooltipToggle, onEventMarkToggle, formatDuration } = chartStore

const mapStore = useMapStateStore()
const { map } = storeToRefs(mapStore)

const settingsOpen = ref(false)
const togglesOpen = ref(false)
const togglesBtnRef = ref<HTMLElement | null>(null)
const togglesPopupRef = ref<HTMLElement | null>(null)
const togglesPopupStyle = ref<Record<string, string>>({})

function selectRenderer3D(): void {
  mapStore.setMapActive(false)
  setThreeViewMode('free')
}

function selectRendererMap2D(): void {
  mapStore.setMapRenderer('2d')
  mapStore.setMapActive(true)
}

function selectRendererMap3D(): void {
  mapStore.setMapRenderer('3d')
  mapStore.setMapActive(true)
}

function selectRendererEarth(): void {
  mapStore.setMapRenderer('earth')
  mapStore.setMapActive(true)
}

const chartToggles = computed<ToggleDef[]>(() => [
  { key: 'tip', label: '悬浮值', title: '鼠标悬停时显示采样值', checked: () => chart.value.tooltip, change: () => { chart.value.tooltip = !chart.value.tooltip; onChartTooltipToggle() } },
  { key: 'err', label: '错误', labelClass: 'event-tag event-tag-err', title: '在时间轴上标出错误记录', checked: () => chart.value.showErrors, change: () => { chart.value.showErrors = !chart.value.showErrors; onEventMarkToggle() } },
  { key: 'ev', label: '事件', labelClass: 'event-tag event-tag-ev', title: '在时间轴上标出飞行事件', checked: () => chart.value.showEvents, change: () => { chart.value.showEvents = !chart.value.showEvents; onEventMarkToggle() } },
  { key: 'msg', label: '消息', labelClass: 'event-tag event-tag-msg', title: '在时间轴上标出文本消息', checked: () => chart.value.showMessages, change: () => { chart.value.showMessages = !chart.value.showMessages; onEventMarkToggle() } },
  { key: 'ai', label: 'AI标记', labelClass: 'event-tag event-tag-ai', title: '在时间轴上标出 AI 分析的问题时段', checked: () => chart.value.showAiMarks, change: () => { chart.value.showAiMarks = !chart.value.showAiMarks; onEventMarkToggle() } },
  { key: 'aicurve', label: 'AI曲线', labelClass: 'event-tag event-tag-ai', title: '一键移除/恢复 AI 定位问题时自动加载的曲线', checked: () => chartStore.aiCurvesActive, change: () => { void chartStore.toggleAiCurves() } },
])

const threeToggles = computed<ToggleDef[]>(() => [
  { key: 'path', label: '轨迹', title: '显示或隐藏已飞行轨迹', checked: () => map.value.showPath, change: toggleThreePath },
  { key: 'full', label: '全量轨迹', title: '显示完整轨迹，点数较多时会更耗性能', checked: () => three.value.view.fullTrajectory, change: toggleFullTrajectory },
  { key: 'curve', label: '曲线轴', title: '在可视化视图底部显示时间轴曲线', checked: () => three.value.playback.curveAxis, change: toggleThreeCurveAxis },
  { key: 'route', label: '航线', title: '叠加任务航线', checked: () => map.value.showRoute, change: toggleThreeMissionRoute },
  { key: 'wp', label: '航点', title: '显示或隐藏航点标记', checked: () => map.value.showWaypoints, change: toggleThreeWaypoints },
  { key: 'rc', label: '遥控器', title: '显示遥控器摇杆面板', checked: () => three.value.rc.hud, change: () => { three.value.rc.hud = !three.value.rc.hud } },
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

    <AppButton variant="primary" size="xs" icon="folder" class="open-file-btn" title="打开或切换日志文件" @click="openLogFile">打开</AppButton>

    <div class="chart-title">
      <div class="view-tabs">
        <button class="view-tab" :class="{ 'is-active': ui.mainView === 'chart' }" type="button" @click="setMainView('chart')">曲线</button>
        <button class="view-tab" :class="{ 'is-active': ui.mainView === 'three' }" type="button" @click="setMainView('three')">可视化</button>
      </div>
      <span v-if="currentLogFileName" class="chart-file-name" :title="currentLogFileName">{{ currentLogFileName }}</span>
    </div>

    <div class="topbar-spacer"></div>

    <div class="chart-controls">
      <span v-if="ui.mainView === 'chart' && hiddenCurveCount" class="chart-hidden-count">隐藏 {{ hiddenCurveCount }}</span>
      <template v-if="ui.mainView === 'three'">
        <div class="seg">
          <button class="seg-btn" :class="{ 'is-active': !map.active && three.view.mode === 'free' }" type="button" @click="selectRenderer3D" title="纯 3D 视图">3D</button>
          <button class="seg-btn" :class="{ 'is-active': map.active && map.renderer === '2d' }" type="button" @click="selectRendererMap2D" title="2D 地图">2D</button>
          <button class="seg-btn" :class="{ 'is-active': map.active && map.renderer === '3d' }" type="button" @click="selectRendererMap3D" title="3D 地图">地图3D</button>
          <button class="seg-btn" :class="{ 'is-active': map.active && map.renderer === 'earth' }" type="button" @click="selectRendererEarth" title="测绘地图（Cesium 全球地形）">测绘</button>
        </div>
        <div class="seg" v-if="three.view.mode === 'free'">
          <button class="seg-btn" :class="{ 'is-active': three.view.cameraMode === 'fps' }" type="button" @click="setThreeCameraMode('fps')" title="自由移动相机">自由</button>
          <button class="seg-btn" :class="{ 'is-active': three.view.cameraMode === 'lock' }" type="button" @click="setThreeCameraMode('lock')" title="锁定跟随无人机">锁定</button>
        </div>
      </template>

      <button ref="togglesBtnRef" class="btn btn-xs" :class="{ 'btn-primary': togglesOpen }" type="button" @click="toggleToggles" title="当前视图开关">
        开关
        <AppIcon :name="togglesOpen ? 'chevron-down' : 'chevron-right'" :size="13" />
      </button>
    </div>

    <div class="topbar-actions">
      <AppButton size="xs" :active="ui.agentOpen" title="AI 日志分析" @click="ui.agentOpen = !ui.agentOpen">AI 分析</AppButton>
      <AppButton size="xs" title="查看消息、命令和参数" @click="ui.recordOpen = true">记录</AppButton>
      <AppButton icon="settings" icon-only title="设置" @click="settingsOpen = true" />
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
