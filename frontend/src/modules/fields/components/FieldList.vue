<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useFieldsStore } from '@/modules/fields'
import AppIcon from '@/modules/shared/components/AppIcon.vue'
import FieldItem from '@/modules/fields/components/FieldItem.vue'

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
      <span>字段面板</span>
      <div class="field-toolbar-actions">
        <button class="btn btn-icon-only" type="button" title="添加字段" :disabled="!canMutate" @click="openSimplePicker()">
          <AppIcon name="plus" />
        </button>
        <label class="btn btn-icon-only" :class="{ 'is-disabled': !canMutate }" title="导入字段方案">
          <AppIcon name="upload" />
          <input class="hidden-file-input" type="file" accept=".json,application/json" :disabled="!canMutate" @change="importFields" />
        </label>
        <button class="btn btn-icon-only" type="button" title="导出字段方案" :disabled="!canExport" @click="exportFields">
          <AppIcon name="download" />
        </button>
      </div>
    </div>
    <div class="field-list">
      <FieldItem v-for="entry in orderedEntries" :key="entry.name" :item="entry" />
      <div v-if="!hasEntries" class="empty-hint">点击加号挑选字段，保存为字段组加入图表。</div>
    </div>
  </div>
</template>
