<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { usePlaybackStore } from '@/modules/playback'

const playbackStore = usePlaybackStore()
const { playback } = storeToRefs(playbackStore)
const canvasEl = ref<HTMLCanvasElement | null>(null)

const sample = computed(() => playbackStore.sampleAtTime(playback.value.timeMs))

const draw = (): void => {
  const cv = canvasEl.value
  if (!cv) return
  const s = sample.value
  drawHorizon(cv, s ? (s.roll || 0) : 0, s ? (s.pitch || 0) : 0)
}

let ro: ResizeObserver | null = null
const resize = (): void => {
  const cv = canvasEl.value
  if (!cv) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = cv.clientWidth || 100
  const h = cv.clientHeight || 100
  cv.width = Math.max(1, Math.round(w * dpr))
  cv.height = Math.max(1, Math.round(h * dpr))
  draw()
}

onMounted(() => {
  resize()
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => resize())
    const cv = canvasEl.value
    if (cv) ro.observe(cv)
  }
})
onBeforeUnmount(() => { if (ro) ro.disconnect() })
watch(sample, draw)

function drawHorizon(cv: HTMLCanvasElement, rollDeg: number, pitchDeg: number): void {
  const ctx = cv.getContext('2d')
  if (!ctx) return
  const W = cv.width, H = cv.height
  const dpr = W / (cv.clientWidth || W)
  ctx.clearRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2
  const r = Math.min(W, H) / 2 - 4 * dpr
  if (r <= 4) return

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  ctx.translate(cx, cy)
  ctx.rotate(-rollDeg * Math.PI / 180)
  const pxPerDeg = r / 24
  const horizonY = pitchDeg * pxPerDeg 

  const sky = ctx.createLinearGradient(0, -r * 2, 0, horizonY)
  sky.addColorStop(0, '#1c6dd9')
  sky.addColorStop(1, '#62a8ef')
  ctx.fillStyle = sky
  ctx.fillRect(-r * 2, -r * 2, r * 4, horizonY + r * 2)
  const gnd = ctx.createLinearGradient(0, horizonY, 0, r * 2)
  gnd.addColorStop(0, '#8a5a2b')
  gnd.addColorStop(1, '#523019')
  ctx.fillStyle = gnd
  ctx.fillRect(-r * 2, horizonY, r * 4, r * 4)

  ctx.lineWidth = 1.1 * dpr
  ctx.font = Math.round(9 * dpr) + 'px Consolas, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let p = -60; p <= 60; p += 5) {
    if (p === 0) continue
    const y = horizonY - p * pxPerDeg
    if (y < -r - 2 || y > r + 2) continue
    const major = p % 10 === 0
    const len = major ? r * 0.30 : r * 0.12
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'
    ctx.beginPath()
    ctx.moveTo(-len, y)
    ctx.lineTo(len, y)
    ctx.stroke()
    if (major) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.fillText(String(Math.abs(p)), -len - 7 * dpr, y)
      ctx.fillText(String(Math.abs(p)), len + 7 * dpr, y)
    }
  }
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.6 * dpr
  ctx.beginPath()
  ctx.moveTo(-r, horizonY)
  ctx.lineTo(r, horizonY)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 1.1 * dpr
  const rolls = [10, 20, 30, 45, 60]
  for (let ri = 0; ri < rolls.length; ri++) {
    const rd = rolls[ri]
    const signs = [1, -1]
    for (let si = 0; si < signs.length; si++) {
      const a = -Math.PI / 2 + signs[si] * rd * Math.PI / 180
      const inner = r - 2 * dpr
      const outer = r - (rd >= 30 ? 9 * dpr : 6 * dpr)
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner)
      ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer)
      ctx.stroke()
    }
  }
  ctx.restore()

  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.lineWidth = 1.5 * dpr
  ctx.strokeStyle = 'rgba(15,23,42,0.4)'
  ctx.stroke()

  ctx.save()
  ctx.translate(cx, cy)
  ctx.fillStyle = '#f59e0b'
  ctx.beginPath()
  ctx.moveTo(0, -r + 2 * dpr)
  ctx.lineTo(-4 * dpr, -r + 9 * dpr)
  ctx.lineTo(4 * dpr, -r + 9 * dpr)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.translate(cx, cy)
  ctx.strokeStyle = '#f59e0b'
  ctx.fillStyle = '#f59e0b'
  ctx.lineWidth = 2 * dpr
  const aw = r * 0.40
  ctx.beginPath()
  ctx.moveTo(-aw, 0)
  ctx.lineTo(-r * 0.13, 0)
  ctx.moveTo(r * 0.13, 0)
  ctx.lineTo(aw, 0)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, 0, 2.5 * dpr, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
</script>

<template>
  <div class="three-side-panel attitude-dial">
    <div class="attitude-dial-body">
      <canvas ref="canvasEl" class="attitude-dial-canvas"></canvas>
    </div>
  </div>
</template>
