<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useFieldsStore } from '@/modules/fields'
import ModalShell from '@/modules/shared/components/ModalShell.vue'

const fieldsStore = useFieldsStore()
const { fieldList, exportableFieldItems } = storeToRefs(fieldsStore)
const { setAllFieldExportSelected, selectedFieldsForExport, confirmExportFields } = fieldsStore

const isOpen = computed(() => fieldList.value.exportOpen)
const selectedCount = computed(() => selectedFieldsForExport().length)
const totalCount = computed(() => exportableFieldItems.value.length)
const countLabel = computed(() => `${selectedCount.value} / ${totalCount.value}`)

function close(): void {
  fieldList.value.exportOpen = false
}
</script>

<template>
  <ModalShell :open="isOpen" variant="field-export-modal" title="导出字段方案" subtitle="选择要写入 JSON 的字段或字段组" @close="close">
    <div class="field-export-toolbar">
      <button class="btn btn-xs" type="button" @click="setAllFieldExportSelected(true)">全选</button>
      <button class="btn btn-xs" type="button" @click="setAllFieldExportSelected(false)">清空</button>
      <span>{{ countLabel }}</span>
    </div>
    <div class="field-export-list">
      <label v-for="entry in exportableFieldItems" :key="entry.name" class="field-export-row">
        <input type="checkbox" v-model="fieldList.exportSelected[entry.name]" />
        <span class="field-name">{{ entry.name }}</span>
        <span class="field-count">{{ entry.curves.length }} 条曲线</span>
      </label>
    </div>
    <template #actions>
      <div class="modal-actions">
        <button class="btn" type="button" @click="close">取消</button>
        <button class="btn btn-primary" type="button" @click="confirmExportFields">导出</button>
      </div>
    </template>
  </ModalShell>
</template>
