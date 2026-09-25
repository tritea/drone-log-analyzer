<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useLogStore } from '@/modules/log'

const { t } = useI18n()
const { log, currentLogFileName } = storeToRefs(useLogStore())

// loadStage 存稳定 key（'parsing' | 'loading' | 'curves'），这里按当前语言解析
const stageText = computed<string>(() => (log.value.loadStage ? t('log.stage.' + log.value.loadStage) : ''))
</script>

<template>
  <div v-if="log.loadStage" class="log-loading-overlay">
    <div class="log-loading-card">
      <div class="log-loading-bar"><span></span></div>
      <div class="log-loading-title">{{ t('home.loading.title') }}</div>
      <div class="log-loading-stage">{{ stageText }}</div>
      <div class="log-loading-file" v-if="currentLogFileName">{{ currentLogFileName }}</div>
    </div>
  </div>
</template>
