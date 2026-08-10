<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useFieldsStore } from '@/modules/fields'
import AppButton from '@/modules/shared/components/AppButton.vue'

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
        <strong>确认删除</strong>
        <small v-if="target">这个{{ kindLabel }}会从字段面板移除。</small>
      </div>
      <AppButton ghost icon-only icon="close" title="关闭" @click="closeFieldDeleteDialog" />
    </div>
    <div class="dialog-body" v-if="target">
      <div class="dialog-title">删除这个{{ kindLabel }}？</div>
      <div class="dialog-target">{{ target.name }}</div>
      <div class="dialog-note">只会清理本地字段方案，不会修改已经打开的原始日志。</div>
    </div>
    <div class="confirm-dialog-actions">
      <AppButton @click="closeFieldDeleteDialog">取消</AppButton>
      <AppButton variant="danger" :disabled="isBusy" @click="confirmFieldDelete">删除</AppButton>
    </div>
  </dialog>
</template>
