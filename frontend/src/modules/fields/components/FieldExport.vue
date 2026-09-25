<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useFieldsStore } from '@/modules/fields'
import ModalShell from '@/modules/shared/components/ModalShell.vue'

const { t } = useI18n()
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
  <ModalShell :open="isOpen" variant="field-export-modal" :title="t('fields.exportDialog.title')" :subtitle="t('fields.exportDialog.subtitle')" @close="close">
    <div class="field-export-toolbar">
      <button class="btn btn-xs" type="button" @click="setAllFieldExportSelected(true)">{{ t('fields.exportDialog.selectAll') }}</button>
      <button class="btn btn-xs" type="button" @click="setAllFieldExportSelected(false)">{{ t('fields.exportDialog.clear') }}</button>
      <span>{{ countLabel }}</span>
    </div>
    <div class="field-export-list">
      <label v-for="entry in exportableFieldItems" :key="entry.name" class="field-export-row">
        <input type="checkbox" v-model="fieldList.exportSelected[entry.name]" />
        <span class="field-name">{{ entry.name }}</span>
        <span class="field-count">{{ t('fields.exportDialog.curveCount', { n: entry.curves.length }) }}</span>
      </label>
    </div>
    <template #actions>
      <div class="modal-actions">
        <button class="btn" type="button" @click="close">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" type="button" @click="confirmExportFields">{{ t('fields.exportDialog.exportBtn') }}</button>
      </div>
    </template>
  </ModalShell>
</template>
