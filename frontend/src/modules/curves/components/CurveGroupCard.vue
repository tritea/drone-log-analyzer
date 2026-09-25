<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFieldsStore } from '@/modules/fields'
import { useAnalysisStore } from '@/modules/analysis'
import AppIcon from '@/modules/shared/components/AppIcon.vue'
import CurveCard from '@/modules/curves/components/CurveCard.vue'
import type { FieldGroupItem } from '@/types'

interface CurveGroupCardProps {
  group: FieldGroupItem
}

const props = defineProps<CurveGroupCardProps>()

const { t } = useI18n()

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
  analysis.applyGroupParams(props.group)
}
function onResetGroupParams(): void {
  analysis.resetGroupParams(props.group)
}
</script>

<template>
  <div class="curve-card field-group-card">
    <div class="curve-card-head">
      <label class="switch-mini" :title="t('curves.groupCard.allVisibleTitle')">
        <input type="checkbox" :checked="allVisible" @change="onToggleAllVisible" />
        <span class="slider-mini"></span>
      </label>
      <button
        class="btn-icon"
        type="button"
        :title="isExpanded ? t('curves.groupCard.collapse') : t('curves.groupCard.expand')"
        @click="onToggleExpanded"
      >
        <AppIcon :name="isExpanded ? 'chevron-down' : 'chevron-right'" :size="14" />
      </button>
      <span class="curve-name" :title="group.name">{{ group.name }}</span>
      <span class="field-count">{{ group.curves.length }} fields</span>
      <button class="btn-icon" type="button" :title="t('curves.groupCard.removeTitle')" @click="onRemoveGroup">
        <AppIcon name="close" :size="14" />
      </button>
    </div>
    <div class="curve-card-params field-group-params">
      <div class="param-row">
        <span class="param-tag">{{ t('curves.groupCard.scale') }}</span>
        <input class="param-input" v-model="group.params.scaleInput" @input="onCommitGroupParams" />
      </div>
      <div class="param-row">
        <span class="param-tag">{{ t('curves.groupCard.offset') }}</span>
        <input class="param-input" v-model="group.params.offsetInput" @input="onCommitGroupParams" />
      </div>
      <button class="btn btn-xs" type="button" @click="onResetGroupParams">{{ t('curves.groupCard.reset') }}</button>
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
