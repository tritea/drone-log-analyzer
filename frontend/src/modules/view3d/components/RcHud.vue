<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useView3dStore } from '@/modules/view3d'
import { usePlaybackStore } from '@/modules/playback'
import { rcAvailable, formatPwm, rcKnobStyleX, rcKnobStyleY } from '@/modules/view3d/utils/rc-hud'

const { t } = useI18n()
const props = defineProps<{ overlay?: boolean }>()
const view3dStore = useView3dStore()
const playbackStore = usePlaybackStore()
const { view3d } = storeToRefs(view3dStore)
const { current, rcInvert, telemetry } = storeToRefs(playbackStore)
const knobX = (pwm: number | null, invert = false) => rcKnobStyleX(pwm, invert)
const knobY = (pwm: number | null, invert = false) => rcKnobStyleY(pwm, invert)
</script>

<template>
  <div v-if="props.overlay" class="rc-hud-overlay" v-show="view3d.rc.hud">
    <div class="rc-stick-pad rc-pad-bl" :class="{ 'is-disabled': !rcAvailable() }">
      <span class="rc-tick rc-tick-n"></span>
      <span class="rc-tick rc-tick-e"></span>
      <span class="rc-tick rc-tick-s"></span>
      <span class="rc-tick rc-tick-w"></span>
      <div class="rc-stick-cross"></div>
      <div class="rc-stick-center"></div>
      <div class="rc-knob" :style="[knobX(current.rcYaw), knobY(current.rcThrottle)]"></div>
    </div>
    <div class="rc-stick-pad rc-pad-br" :class="{ 'is-disabled': !rcAvailable() }">
      <span class="rc-tick rc-tick-n"></span>
      <span class="rc-tick rc-tick-e"></span>
      <span class="rc-tick rc-tick-s"></span>
      <span class="rc-tick rc-tick-w"></span>
      <div class="rc-stick-cross"></div>
      <div class="rc-stick-center"></div>
      <div class="rc-knob" :style="[knobX(current.rcRoll, rcInvert.roll), knobY(current.rcPitch, rcInvert.pitch)]"></div>
    </div>
  </div>

  <div
    v-else
    class="rc-hud"
    :class="{ 'rc-hud-side three-side-panel': view3d.rc.layout === 'side' }"
    v-show="view3d.rc.hud"
  >
    <div class="rc-hud-head">
      <strong>{{ t('scene3d.rc.title') }}</strong>
      <span>Mode 2 · {{ telemetry.meta.rc || t('scene3d.rc.unrecognized') }}</span>
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
          <div class="rc-knob" :style="[knobX(current.rcYaw), knobY(current.rcThrottle)]"></div>
          <div v-if="!rcAvailable()" class="rc-stick-empty">{{ t('scene3d.rc.unrecognized') }}<br/>RCIN</div>
        </div>
        <div class="rc-stick-label">{{ t('scene3d.rc.throttleYaw') }}</div>
      </div>
      <div class="rc-stick">
        <div class="rc-stick-pad" :class="{ 'is-disabled': !rcAvailable() }">
          <span class="rc-tick rc-tick-n"></span>
          <span class="rc-tick rc-tick-e"></span>
          <span class="rc-tick rc-tick-s"></span>
          <span class="rc-tick rc-tick-w"></span>
          <div class="rc-stick-cross"></div>
          <div class="rc-stick-center"></div>
          <div class="rc-knob" :style="[knobX(current.rcRoll, rcInvert.roll), knobY(current.rcPitch, rcInvert.pitch)]"></div>
          <div v-if="!rcAvailable()" class="rc-stick-empty">{{ t('scene3d.rc.unrecognized') }}<br/>RCIN</div>
        </div>
        <div class="rc-stick-label">{{ t('scene3d.rc.pitchRoll') }}</div>
      </div>
    </div>
    <div class="rc-readout" v-show="view3d.rc.readout">
      <div><span>{{ t('scene3d.rc.roll') }}</span><b>{{ formatPwm(current.rcRoll) }}</b></div>
      <div><span>{{ t('scene3d.rc.pitch') }}</span><b>{{ formatPwm(current.rcPitch) }}</b></div>
      <div><span>{{ t('scene3d.rc.throttle') }}</span><b>{{ formatPwm(current.rcThrottle) }}</b></div>
      <div><span>{{ t('scene3d.rc.yaw') }}</span><b>{{ formatPwm(current.rcYaw) }}</b></div>
    </div>
  </div>
</template>
