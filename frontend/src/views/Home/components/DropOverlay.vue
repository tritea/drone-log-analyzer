<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useUiStore } from '@/modules/shared/ui-store'

const { ui } = storeToRefs(useUiStore())
</script>

<template>
  <div v-if="ui.dragOver" class="drop-overlay">
    <div class="drop-panel">
      <div class="drop-title">松开即可载入日志</div>
      <div class="drop-text">支持常见飞控日志格式。</div>
    </div>
  </div>
</template>
