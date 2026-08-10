<script setup lang="ts">
import { numFromEvent } from '@/modules/shared/utils/format'

const props = withDefaults(defineProps<{
  label: string
  modelValue: number
  min: number
  max: number
  step: number
  wheelStep?: number
}>(), { wheelStep: 0 })

const emit = defineEmits<{ (e: 'update:modelValue', value: number): void }>()

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
    <div class="cm-ctrl" @wheel="onWheel">
      <input
        type="range"
        class="cm-range"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        @input="emit('update:modelValue', numFromEvent($event))"
      />
      <input
        type="number"
        class="cm-num"
        :value="modelValue"
        @change="emit('update:modelValue', numFromEvent($event))"
      />
    </div>
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

.cm-ctrl {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cm-range {
  flex: 1;
  min-width: 0;
}

.cm-num {
  flex: 0 0 56px;
  width: 56px;
  padding: 2px 4px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 12px;
}
</style>
