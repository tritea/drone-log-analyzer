<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useFieldsStore } from '@/modules/fields'
import AppButton from '@/modules/shared/components/AppButton.vue'

const { t } = useI18n()
const fieldsStore = useFieldsStore()
const { fieldList } = storeToRefs(fieldsStore)
const { closeFieldDeleteDialog, fieldDeleteKindLabel, confirmFieldDelete } = fieldsStore

// 注意：模板里用函数式 ref 直接绑定 store 方法（:ref="fieldsStore.registerFieldDeleteDialog"），
// 该方法名与 (el: TemplateRefTarget) => void 签名是对外契约，不可在此处包裹改写。
const target = computed(() => fieldList.value.deleteTarget)
const kindLabel = computed(() => fieldDeleteKindLabel(target.value))
const isBusy = computed(() => fieldList.value.loading)
</script>

<template>
  <dialog :ref="fieldsStore.registerFieldDeleteDialog" class="native-dialog field-delete-dialog" @cancel="closeFieldDeleteDialog">
    <div class="confirm-dialog-head">
      <div>
        <strong>{{ t('fields.deleteDialog.title') }}</strong>
        <small v-if="target">{{ t('fields.deleteDialog.removeNote', { kind: kindLabel }) }}</small>
      </div>
      <AppButton ghost icon-only icon="close" :title="t('common.close')" @click="closeFieldDeleteDialog" />
    </div>
    <div class="dialog-body" v-if="target">
      <div class="dialog-title">{{ t('fields.deleteDialog.deleteTitle', { kind: kindLabel }) }}</div>
      <div class="dialog-target">{{ target.name }}</div>
      <div class="dialog-note">{{ t('fields.deleteDialog.note') }}</div>
    </div>
    <div class="confirm-dialog-actions">
      <AppButton @click="closeFieldDeleteDialog">{{ t('common.cancel') }}</AppButton>
      <AppButton variant="danger" :disabled="isBusy" @click="confirmFieldDelete">{{ t('common.delete') }}</AppButton>
    </div>
  </dialog>
</template>
