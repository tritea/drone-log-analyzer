<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useView3dStore } from '@/modules/view3d'
import { usePlaybackStore } from '@/modules/playback'

const view3dStore = useView3dStore()
const playbackStore = usePlaybackStore()
const { playback } = storeToRefs(playbackStore)
const { onCurveAxisResizeStart, onPlayheadDragStart } = view3dStore
const { toggleThreePlayback } = playbackStore
const registerPlayhead = (el: any): void => { view3dStore.registerPlayhead(el) }
const registerPlayheadTag = (el: any): void => { view3dStore.registerPlayheadTag(el) }
</script>

<template>
  <div v-if="playback.curveAxis" class="three-curve-panel">
    <div class="three-curve-resizer" @mousedown="onCurveAxisResizeStart" title="拖动调整曲线图高度"></div>
    <div class="three-curve-wrap">
      <div id="three-curve-chart" class="three-curve-chart"></div>
      <div class="three-playhead" :ref="registerPlayhead" @mousedown="onPlayheadDragStart" title="拖动定位">
        <span class="three-playhead-line"></span>
        <span class="three-playhead-thumb"></span>
        <span class="three-playhead-tag" :ref="registerPlayheadTag"></span>
        <button
          class="three-play-round"
          :class="{ 'is-playing': playback.playing }"
          :title="playback.playing ? '暂停' : '播放'"
          @mousedown.stop.prevent
          @click.stop="toggleThreePlayback"
        >
          <span class="three-play-icon"></span>
        </button>
      </div>
    </div>
  </div>
</template>
