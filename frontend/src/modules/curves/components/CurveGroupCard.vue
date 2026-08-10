<script setup lang="ts">
import { computed } from 'vue'
import { useFieldsStore } from '@/modules/fields'
import { useAnalysisStore } from '@/modules/analysis'
import AppIcon from '@/modules/shared/components/AppIcon.vue'
import CurveCard from '@/modules/curves/components/CurveCard.vue'
import type { FieldGroupItem } from '@/types'

interface CurveGroupCardProps {
  group: FieldGroupItem
}

const props = defineProps<CurveGroupCardProps>()

const fields = useFieldsStore()
const analysis = useAnalysisStore()

const isExpanded = computed<boolean>(() => fields.isFieldExpanded(props.group.name))
const allVisible = computed<boolean>(() => fields.activeFieldAllVisible(props.group.name))

function onToggleAllVisible(event: Event): void {
  fields.setActiveFieldVisible(props.group.name, event)
}
function onToggleExpanded(): void {
  fields.toggleFieldExpanded(props.group.name)
}
function onRemoveGroup(): void {
  fields.removeFieldCurves(props.group.name)
}
function onCommitGroupParams(): void {
  analysis.onFieldGroupParams(props.group)
}
function onResetGroupParams(): void {
  analysis.resetFieldGroupParams(props.group)
}
</script>

<template>
  <div class="curve-card field-group-card">
    <div class="curve-card-head">
      <label class="switch-mini" title="显示或隐藏整组曲线">
        <input type="checkbox" :checked="allVisible" @change="onToggleAllVisible" />
        <span class="slider-mini"></span>
      </label>
      <button
        class="btn-icon"
        type="button"
        :title="isExpanded ? '收起字段组' : '展开字段组'"
        @click="onToggleExpanded"
      >
        <AppIcon :name="isExpanded ? 'chevron-down' : 'chevron-right'" :size="14" />
      </button>
      <span class="curve-name" :title="group.name">{{ group.name }}</span>
      <span class="field-count">{{ group.curves.length }} fields</span>
      <button class="btn-icon" type="button" title="移除整组" @click="onRemoveGroup">
        <AppIcon name="close" :size="14" />
      </button>
    </div>
    <div class="curve-card-params field-group-params">
      <div class="param-row">
        <span class="param-tag">组倍率</span>
        <input class="param-input" v-model="group.params.scaleInput" @input="onCommitGroupParams" />
      </div>
      <div class="param-row">
        <span class="param-tag">组基线</span>
        <input class="param-input" v-model="group.params.offsetInput" @input="onCommitGroupParams" />
      </div>
      <button class="btn btn-xs" type="button" @click="onResetGroupParams">归零</button>
    </div>
    <template v-if="isExpanded">
      <CurveCard
        v-for="childCurve in group.curves"
        :key="childCurve.id"
        :curve="childCurve"
        extra-class="field-child-card"
      />
    </template>
  </div>
</template>
