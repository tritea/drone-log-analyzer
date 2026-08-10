<script setup lang="ts">
import { computed } from 'vue'
import { useAnalysisStore } from '@/modules/analysis'
import AppIcon from '@/modules/shared/components/AppIcon.vue'
import type { Curve } from '@/types'

interface CurveCardProps {
  curve: Curve
  extraClass?: string
}

const props = defineProps<CurveCardProps>()

const analysis = useAnalysisStore()

const isDrawn = computed<boolean>(() => analysis.isCurveDrawn(props.curve.id))
const pointCount = computed<number>(() => analysis.curvePointCount(props.curve))

function onToggleVisible(): void {
  analysis.toggleVisible(props.curve)
}
function onToggleDrawn(): void {
  analysis.toggleCurveDrawn(props.curve)
}
function onRemove(): void {
  analysis.removeCurveById(props.curve.id)
}
function onCommitColor(): void {
  analysis.onCurveColor(props.curve)
}
function onCommitParams(): void {
  analysis.onCurveParams(props.curve)
}
function onResetParams(): void {
  analysis.resetCurveParams(props.curve)
}
</script>

<template>
  <div class="curve-card" :class="extraClass">
    <div class="curve-card-head">
      <label class="switch-mini" title="参与量程与保存状态">
        <input type="checkbox" v-model="curve.visible" @change="onToggleVisible" />
        <span class="slider-mini"></span>
      </label>
      <button
        class="btn-icon"
        type="button"
        :title="isDrawn ? '临时隐藏曲线' : '恢复曲线绘制'"
        @click="onToggleDrawn"
      >
        <AppIcon name="eye" :size="14" />
      </button>
      <span class="curve-dot" :style="{ background: curve.color }"></span>
      <span class="curve-name" :title="curve.label">{{ curve.label }}</span>
      <span class="field-count">{{ pointCount }} pts</span>
      <button class="btn-icon" type="button" title="移除曲线" @click="onRemove">
        <AppIcon name="close" :size="14" />
      </button>
    </div>
    <div class="curve-card-params">
      <div class="param-row color-row">
        <span class="param-tag">色彩</span>
        <input class="color-input" type="color" v-model="curve.color" @input="onCommitColor" />
      </div>
      <div class="param-row">
        <span class="param-tag">倍率</span>
        <input class="param-input" v-model="curve.scaleInput" @input="onCommitParams" />
      </div>
      <div class="param-row">
        <span class="param-tag">基线</span>
        <input class="param-input" v-model="curve.offsetInput" @input="onCommitParams" />
      </div>
      <button class="btn btn-xs" type="button" @click="onResetParams">归零</button>
    </div>
  </div>
</template>
