<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useLogStore } from '@/modules/log'
import AppIcon from '@/modules/shared/components/AppIcon.vue'

const { t } = useI18n()
const logStore = useLogStore()
const { log } = storeToRefs(logStore)
const { openLogFile } = logStore
</script>

<template>
  <div v-if="!log.loaded" class="welcome">
    <div class="welcome-panel">
      <div class="welcome-icon">
        <svg class="welcome-drone" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="32" y1="32" x2="15" y2="15" />
          <line x1="32" y1="32" x2="49" y2="15" />
          <line x1="32" y1="32" x2="15" y2="49" />
          <line x1="32" y1="32" x2="49" y2="49" />
          <rect x="26" y="26" width="12" height="12" rx="3" />
          <circle cx="15" cy="15" r="8" />
          <circle cx="49" cy="15" r="8" />
          <circle cx="15" cy="49" r="8" />
          <circle cx="49" cy="49" r="8" />
        </svg>
      </div>
      <div class="welcome-title">{{ t('home.welcome.title') }}</div>
      <div class="welcome-text">{{ t('home.welcome.text') }}</div>
      <button class="btn btn-primary file-btn welcome-action" type="button" @click="openLogFile">
        <AppIcon name="folder" :size="16" />
        <span>{{ t('home.welcome.openButton') }}</span>
      </button>
    </div>
  </div>
</template>
