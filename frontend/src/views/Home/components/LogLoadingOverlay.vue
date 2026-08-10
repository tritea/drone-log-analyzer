<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useLogStore } from '@/modules/log'

const { log, currentLogFileName } = storeToRefs(useLogStore())
</script>

<template>
  <div v-if="log.loadStage" class="log-loading-overlay">
    <div class="log-loading-card">
      <div class="log-loading-bar"><span></span></div>
      <div class="log-loading-title">正在解析日志</div>
      <div class="log-loading-stage">{{ log.loadStage }}</div>
      <div class="log-loading-file" v-if="currentLogFileName">{{ currentLogFileName }}</div>
    </div>
  </div>
</template>
