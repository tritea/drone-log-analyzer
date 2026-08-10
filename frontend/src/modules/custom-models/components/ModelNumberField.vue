<script setup lang="ts">
import { numFromEvent } from '@/modules/shared/utils/format'

const props = withDefaults(defineProps<{
  label: string
  modelValue: number
  step?: number
  min?: number
  max?: number
  wheelStep?: number
  /** true = 仅在 change（失焦/回车）时 emit；false = 每次 input 都 emit。结构类字段（行列）用 true 避免每键持久化。 */
  commitOnly?: boolean
}>(), { step: 0.000001, wheelStep: 0, commitOnly: false })

const emit = defineEmits<{ (e: 'update:modelValue', value: number): void }>()

function emitValue(e: Event): void {
  emit('update:modelValue', numFromEvent(e))
}

function onWheel(e: WheelEvent): void {
  if (!props.wheelStep) return
  e.preventDefault()
  const next = (props.modelValue || 0) + (e.deltaY < 0 ? props.wheelStep : -props.wheelStep)
  emit('update:modelValue', +next.toFixed(6))
}
</script>

<template>
  <label class="cm-field">
    <span>{{ label }}</span>
    <input
      type="number"
      :value="modelValue"
      :step="step"
      :min="min"
      :max="max"
      @input="!commitOnly && emitValue($event)"
      @change="commitOnly && emitValue($event)"
      @wheel="onWheel"
    />
  </label>
</template>

<style scoped>
.cm-field {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: #4b5563;
}

.cm-field span {
  display: block;
  margin-bottom: 2px;
}

.cm-field input[type='number'] {
  width: 100%;
  padding: 3px 6px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 13px;
}
</style>
