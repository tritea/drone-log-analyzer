<script setup lang="ts">
import { computed } from 'vue'
import { useFieldsStore } from '@/modules/fields'
import { useAnalysisStore } from '@/modules/analysis'
import AppIcon from '@/modules/shared/components/AppIcon.vue'
import type { FieldEntry } from '@/types'

const props = defineProps<{ item: FieldEntry }>()

const fieldsStore = useFieldsStore()
const analysis = useAnalysisStore()

const {
  isCurveItemActive,
  isSimpleFieldSelected,
  setSimpleFieldEnabled,
  selectSimpleField,
  deleteFieldEntry,
  simpleFieldGroupParams,
  updateFieldEntry,
} = fieldsStore
const { onSimpleFieldGroupParams, resetSimpleFieldGroupParams } = analysis

const isActive = computed(() => isCurveItemActive(props.item))
const isInlineEditorOpen = computed(() => isSimpleFieldSelected(props.item))
const fieldCountLabel = computed(() => props.item.curves.length + ' fields')
const titleText = computed(() => props.item.name)
const deleteTitle = computed(() => '删除字段组')
</script>

<template>
  <div
    class="field-item group"
    :class="{ 'is-active': isActive, 'is-selected': isInlineEditorOpen }"
  >
    <label class="switch-mini field-switch" title="加入或移出图表" @click.stop>
      <input type="checkbox" :checked="isActive" @change="setSimpleFieldEnabled(item, $event)" />
      <span class="slider-mini"></span>
    </label>

    <button class="field-main" type="button" :title="titleText" @click="selectSimpleField(item)">
      <span class="field-name">{{ item.name }}</span>
      <span class="field-count">{{ fieldCountLabel }}</span>
    </button>

    <div class="field-actions">
      <button class="btn-icon" type="button" title="编辑字段组" @click="updateFieldEntry(item)">
        <AppIcon name="edit" :size="14" />
      </button>
      <button class="btn-icon" type="button" :title="deleteTitle" @click="deleteFieldEntry(item)">
        <AppIcon name="trash" :size="14" />
      </button>
    </div>

    <div v-if="isInlineEditorOpen" class="simple-inline-editor">
      <div class="curve-card-params field-group-params simple-group-params">
        <div class="param-row">
          <span class="param-tag">组倍率</span>
          <input class="param-input" v-model="simpleFieldGroupParams(item).scaleInput" @input="onSimpleFieldGroupParams(item)" />
        </div>
        <div class="param-row">
          <span class="param-tag">组基线</span>
          <input class="param-input" v-model="simpleFieldGroupParams(item).offsetInput" @input="onSimpleFieldGroupParams(item)" />
        </div>
        <button class="btn btn-xs" type="button" @click="resetSimpleFieldGroupParams(item)">归零</button>
      </div>
    </div>
  </div>
</template>
