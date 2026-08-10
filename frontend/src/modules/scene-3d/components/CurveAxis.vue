<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useScene3dStore } from '@/modules/scene-3d'

const threeStore = useScene3dStore()
const { three } = storeToRefs(threeStore)
const { onThreeCurveResizeDown, onThreePlayheadDown, toggleThreePlayback } = threeStore
const registerThreePlayhead = (el: any): void => { threeStore.registerThreePlayhead(el) }
const registerThreePlayheadTag = (el: any): void => { threeStore.registerThreePlayheadTag(el) }
</script>

<template>
  <div v-if="three.playback.curveAxis" class="three-curve-panel">
    <div class="three-curve-resizer" @mousedown="onThreeCurveResizeDown" title="拖动调整曲线图高度"></div>
    <div class="three-curve-wrap">
      <div id="three-curve-chart" class="three-curve-chart"></div>
      <div class="three-playhead" :ref="registerThreePlayhead" @mousedown="onThreePlayheadDown" title="拖动定位">
        <span class="three-playhead-line"></span>
        <span class="three-playhead-thumb"></span>
        <span class="three-playhead-tag" :ref="registerThreePlayheadTag"></span>
        <button
          class="three-play-round"
          :class="{ 'is-playing': three.playback.playing }"
          :title="three.playback.playing ? '暂停' : '播放'"
          @mousedown.stop.prevent
          @click.stop="toggleThreePlayback"
        >
          <span class="three-play-icon"></span>
        </button>
      </div>
    </div>
  </div>
</template>
