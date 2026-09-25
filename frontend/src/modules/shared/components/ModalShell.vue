<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppButton from '@/modules/shared/components/AppButton.vue'

const { t } = useI18n()

defineProps<{ open: boolean; variant?: string; title?: string; subtitle?: string }>()
defineEmits<{ (e: 'close'): void }>()
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal" :class="variant">
      <div class="modal-head">
        <slot name="head">
          <div>
            <strong v-if="title">{{ title }}</strong>
            <small v-if="subtitle">{{ subtitle }}</small>
          </div>
        </slot>
        <AppButton ghost icon-only icon="close" :title="t('common.close')" @click="$emit('close')" />
      </div>
      <slot></slot>
      <slot name="actions"></slot>
    </div>
  </div>
</template>
