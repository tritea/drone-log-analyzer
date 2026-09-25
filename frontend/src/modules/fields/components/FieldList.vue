<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useFieldsStore } from '@/modules/fields'
import AppIcon from '@/modules/shared/components/AppIcon.vue'
import FieldItem from '@/modules/fields/components/FieldItem.vue'

const { t } = useI18n()
const fieldsStore = useFieldsStore()
const { fieldList, filteredFields, exportableFieldItems } = storeToRefs(fieldsStore)
const { openSimplePicker, importFields, exportFields } = fieldsStore

// 所有条目统一按组表示，按名字原序展示。
const orderedEntries = computed(() => filteredFields.value)
const hasEntries = computed(() => orderedEntries.value.length > 0)
const canExport = computed(() => !fieldList.value.loading && exportableFieldItems.value.length > 0)
const canMutate = computed(() => !fieldList.value.loading)
</script>

<template>
  <div class="field-panel">
    <div class="field-panel-head">
      <span>{{ t('fields.panel.title') }}</span>
      <div class="field-toolbar-actions">
        <button class="btn btn-icon-only" type="button" :title="t('fields.panel.addTitle')" :disabled="!canMutate" @click="openSimplePicker()">
          <AppIcon name="plus" />
        </button>
        <label class="btn btn-icon-only" :class="{ 'is-disabled': !canMutate }" :title="t('fields.panel.importTitle')">
          <AppIcon name="upload" />
          <input class="hidden-file-input" type="file" accept=".json,application/json" :disabled="!canMutate" @change="importFields" />
        </label>
        <button class="btn btn-icon-only" type="button" :title="t('fields.panel.exportTitle')" :disabled="!canExport" @click="exportFields">
          <AppIcon name="download" />
        </button>
      </div>
    </div>
    <div class="field-list">
      <FieldItem v-for="entry in orderedEntries" :key="entry.name" :item="entry" />
      <div v-if="!hasEntries" class="empty-hint">{{ t('fields.panel.emptyHint') }}</div>
    </div>
  </div>
</template>
