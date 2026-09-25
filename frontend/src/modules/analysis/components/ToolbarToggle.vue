<script setup lang="ts">
import type { ToggleDef } from './toggles'
defineProps<{ item: ToggleDef }>()
</script>

<template>
  <label class="chart-toggle" :title="item.title">
    <span :class="item.labelClass">{{ item.label }}</span>
    <span class="switch-mini">
      <input type="checkbox" :checked="item.checked()" @change="item.change()" />
      <span class="slider-mini"></span>
    </span>
  </label>
</template>
