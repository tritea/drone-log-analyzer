<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAnalysisStore } from '@/modules/analysis'
import AppIcon from '@/modules/shared/components/AppIcon.vue'
import type { Curve } from '@/types'

interface CurveCardProps {
  curve: Curve
  extraClass?: string
}

const props = defineProps<CurveCardProps>()

const { t } = useI18n()

const analysis = useAnalysisStore()

const isDrawn = computed<boolean>(() => analysis.isCurveDrawn(props.curve.id))
const pointCount = computed<number>(() => analysis.curvePointCount(props.curve))

function onToggleVisible(): void {
  analysis.toggleCurveVisible(props.curve)
}
function onToggleDrawn(): void {
  analysis.toggleCurveDrawn(props.curve)
}
function onRemove(): void {
  analysis.removeCurveById(props.curve.id)
}
function onCommitColor(): void {
  analysis.applyCurveColor(props.curve)
}
function onCommitParams(): void {
  analysis.applyCurveParams(props.curve)
}
function onResetParams(): void {
  analysis.resetCurveParams(props.curve)
}
</script>

<template>
  <div class="curve-card" :class="extraClass">
    <div class="curve-card-head">
      <label class="switch-mini" :title="t('curves.card.visibleTitle')">
        <input type="checkbox" v-model="curve.visible" @change="onToggleVisible" />
        <span class="slider-mini"></span>
      </label>
      <button
        class="btn-icon"
        type="button"
        :title="isDrawn ? t('curves.card.hideTitle') : t('curves.card.restoreTitle')"
        @click="onToggleDrawn"
      >
        <AppIcon name="eye" :size="14" />
      </button>
      <span class="curve-dot" :style="{ background: curve.color }"></span>
      <span class="curve-name" :title="curve.label">{{ curve.label }}</span>
      <span class="field-count">{{ pointCount }} pts</span>
      <button class="btn-icon" type="button" :title="t('curves.card.removeTitle')" @click="onRemove">
        <AppIcon name="close" :size="14" />
      </button>
    </div>
    <div class="curve-card-params">
      <div class="param-row color-row">
        <span class="param-tag">{{ t('curves.card.color') }}</span>
        <input class="color-input" type="color" v-model="curve.color" @input="onCommitColor" />
      </div>
      <div class="param-row">
        <span class="param-tag">{{ t('curves.card.scale') }}</span>
        <input class="param-input" v-model="curve.scaleInput" @input="onCommitParams" />
      </div>
      <div class="param-row">
        <span class="param-tag">{{ t('curves.card.offset') }}</span>
        <input class="param-input" v-model="curve.offsetInput" @input="onCommitParams" />
      </div>
      <button class="btn btn-xs" type="button" @click="onResetParams">{{ t('curves.card.reset') }}</button>
    </div>
  </div>
</template>
