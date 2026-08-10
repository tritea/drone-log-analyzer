<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useScene3dStore } from '@/modules/scene-3d'

const props = defineProps<{ overlay?: boolean }>()
const threeStore = useScene3dStore()
const { three } = storeToRefs(threeStore)
const { rcAvailable, formatPwm } = threeStore
const rcKnobStyleX = (pwm: number | null, invert = false) => threeStore.rcKnobStyleX(pwm, invert)
const rcKnobStyleY = (pwm: number | null, invert = false) => threeStore.rcKnobStyleY(pwm, invert)
</script>

<template>
  <div v-if="props.overlay" class="rc-hud-overlay" v-show="three.rc.hud">
    <div class="rc-stick-pad rc-pad-bl" :class="{ 'is-disabled': !rcAvailable() }">
      <span class="rc-tick rc-tick-n"></span>
      <span class="rc-tick rc-tick-e"></span>
      <span class="rc-tick rc-tick-s"></span>
      <span class="rc-tick rc-tick-w"></span>
      <div class="rc-stick-cross"></div>
      <div class="rc-stick-center"></div>
      <div class="rc-knob" :style="[rcKnobStyleX(three.current.rcYaw), rcKnobStyleY(three.current.rcThrottle)]"></div>
    </div>
    <div class="rc-stick-pad rc-pad-br" :class="{ 'is-disabled': !rcAvailable() }">
      <span class="rc-tick rc-tick-n"></span>
      <span class="rc-tick rc-tick-e"></span>
      <span class="rc-tick rc-tick-s"></span>
      <span class="rc-tick rc-tick-w"></span>
      <div class="rc-stick-cross"></div>
      <div class="rc-stick-center"></div>
      <div class="rc-knob" :style="[rcKnobStyleX(three.current.rcRoll, three.rc.invert.roll), rcKnobStyleY(three.current.rcPitch, three.rc.invert.pitch)]"></div>
    </div>
  </div>

  <div
    v-else
    class="rc-hud"
    :class="{ 'rc-hud-side three-side-panel': three.rc.layout === 'side' }"
    v-show="three.rc.hud"
  >
    <div class="rc-hud-head">
      <strong>遥控器</strong>
      <span>Mode 2 · {{ three.telemetry.meta.rc || '未识别' }}</span>
    </div>
    <div class="rc-hud-sticks">
      <div class="rc-stick">
        <div class="rc-stick-pad" :class="{ 'is-disabled': !rcAvailable() }">
          <span class="rc-tick rc-tick-n"></span>
          <span class="rc-tick rc-tick-e"></span>
          <span class="rc-tick rc-tick-s"></span>
          <span class="rc-tick rc-tick-w"></span>
          <div class="rc-stick-cross"></div>
          <div class="rc-stick-center"></div>
          <div class="rc-knob" :style="[rcKnobStyleX(three.current.rcYaw), rcKnobStyleY(three.current.rcThrottle)]"></div>
          <div v-if="!rcAvailable()" class="rc-stick-empty">未识别<br/>RCIN</div>
        </div>
        <div class="rc-stick-label">油门 / 偏航</div>
      </div>
      <div class="rc-stick">
        <div class="rc-stick-pad" :class="{ 'is-disabled': !rcAvailable() }">
          <span class="rc-tick rc-tick-n"></span>
          <span class="rc-tick rc-tick-e"></span>
          <span class="rc-tick rc-tick-s"></span>
          <span class="rc-tick rc-tick-w"></span>
          <div class="rc-stick-cross"></div>
          <div class="rc-stick-center"></div>
          <div class="rc-knob" :style="[rcKnobStyleX(three.current.rcRoll, three.rc.invert.roll), rcKnobStyleY(three.current.rcPitch, three.rc.invert.pitch)]"></div>
          <div v-if="!rcAvailable()" class="rc-stick-empty">未识别<br/>RCIN</div>
        </div>
        <div class="rc-stick-label">俯仰 / 横滚</div>
      </div>
    </div>
    <div class="rc-readout" v-show="three.rc.readout">
      <div><span>横滚</span><b>{{ formatPwm(three.current.rcRoll) }}</b></div>
      <div><span>俯仰</span><b>{{ formatPwm(three.current.rcPitch) }}</b></div>
      <div><span>油门</span><b>{{ formatPwm(three.current.rcThrottle) }}</b></div>
      <div><span>偏航</span><b>{{ formatPwm(three.current.rcYaw) }}</b></div>
    </div>
  </div>
</template>
