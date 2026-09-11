<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useScene3dStore } from '@/modules/scene-3d'

const threeStore = useScene3dStore()
const { three, threeCurrentTimeLabel, threeTimelinePct, threeEndTimeLabel, threeModeSegments, threeIncidentSegments } = storeToRefs(threeStore)
const { toggleThreePlayback, seekThreeByPct } = threeStore

const trackEl = ref<HTMLElement | null>(null)
const dragging = ref(false)

const pctFromClientX = (clientX: number): number => {
  const el = trackEl.value
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return 0
  return (clientX - rect.left) / rect.width
}

const onPointerDown = (e: PointerEvent): void => {
  dragging.value = true
  seekThreeByPct(pctFromClientX(e.clientX))
  const move = (ev: PointerEvent): void => {
    if (!dragging.value) return
    seekThreeByPct(pctFromClientX(ev.clientX))
  }
  const up = (): void => {
    dragging.value = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

const onKeyDown = (e: KeyboardEvent): void => {
  if (e.key === 'ArrowLeft') { seekThreeByPct((threeTimelinePct.value - 1) / 100); e.preventDefault() }
  else if (e.key === 'ArrowRight') { seekThreeByPct((threeTimelinePct.value + 1) / 100); e.preventDefault() }
}
</script>

<template>
  <div class="three-timeline">
    <button
      class="btn btn-xs btn-primary three-play-btn"
      :class="{ 'is-playing': three.playback.playing }"
      :title="three.playback.playing ? '暂停' : '播放'"
      @click="toggleThreePlayback"
    >
      <span class="three-play-icon"></span>
      <span class="three-play-text">{{ three.playback.playing ? '暂停' : '播放' }}</span>
    </button>
    <span class="three-time three-time-current">{{ threeCurrentTimeLabel }}</span>
    <div
      v-if="!three.playback.curveAxis"
      class="three-range"
      :class="{ 'three-range-drag': dragging }"
      role="slider"
      tabindex="0"
      :aria-valuenow="Math.round(threeTimelinePct)"
      aria-valuemin="0"
      aria-valuemax="100"
      :title="'拖动/点击定位 · ' + threeCurrentTimeLabel"
      @pointerdown="onPointerDown"
      @keydown="onKeyDown"
    >
      <div class="three-range-track" ref="trackEl">
        <div
          v-for="(seg, i) in threeModeSegments"
          :key="i"
          class="three-range-seg"
          :style="{ left: seg.startPct + '%', width: seg.widthPct + '%', background: seg.color }"
          :title="seg.label"
        ></div>
        <!-- AI 问题时段警示条：纯视觉标记（不拦截拖拽），点击定位走消息卡片/主图标记 -->
        <div
          v-for="(seg, i) in threeIncidentSegments"
          :key="'ai' + i"
          class="three-range-ai"
          :style="{ left: seg.startPct + '%', width: seg.widthPct + '%', background: seg.color }"
        ></div>
        <div class="three-range-ahead" :style="{ left: threeTimelinePct + '%' }"></div>
      </div>
      <div class="three-range-thumb" :style="{ left: threeTimelinePct + '%' }"></div>
    </div>
    <span class="three-time three-time-total">{{ threeEndTimeLabel }}</span>
    <select class="three-speed" v-model.number="three.playback.rate" title="播放速度">
      <option :value="0.25">0.25x</option>
      <option :value="0.5">0.5x</option>
      <option :value="1">1x</option>
      <option :value="2">2x</option>
      <option :value="5">5x</option>
      <option :value="10">10x</option>
    </select>
  </div>
</template>

<style scoped>
/* AI 问题时段警示条：叠在模式分段之上，细边框勾勒 + 半透明填充，不拦截指针 */
.three-range-ai {
  position: absolute;
  top: 0;
  bottom: 0;
  min-width: 2px;
  opacity: 0.55;
  pointer-events: none;
  box-shadow: inset 0 0 0 1.5px rgba(0, 0, 0, 0.25);
}
</style>
