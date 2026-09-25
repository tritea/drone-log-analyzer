<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@/modules/shared/ui-store'

const { t } = useI18n()
const { ui } = storeToRefs(useUiStore())
</script>

<template>
  <div v-if="ui.dragOver" class="drop-overlay">
    <div class="drop-panel">
      <div class="drop-title">{{ t('home.drop.title') }}</div>
      <div class="drop-text">{{ t('home.drop.text') }}</div>
    </div>
  </div>
</template>
