<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppIcon from '@/modules/shared/components/AppIcon.vue'

const { t } = useI18n()

defineProps<{ message: string }>()
const emit = defineEmits<{ (e: 'cancel'): void }>()
</script>

<template>
  <Teleport to="body">
    <div class="cm-pick-hint">
      <AppIcon name="map-pin" :size="14" />
      <span>{{ message }}</span>
      <button class="btn btn-xs" type="button" @click="emit('cancel')">{{ t('common.cancel') }}</button>
    </div>
  </Teleport>
</template>

<style scoped>
.cm-pick-hint {
  position: fixed;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2000;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 6px;
  background: rgba(30, 41, 59, 0.92);
  color: #fff;
  font-size: 13px;
}
</style>
