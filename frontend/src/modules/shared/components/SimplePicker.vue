<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFieldsStore } from '@/modules/fields'
import { useAnalysisStore } from '@/modules/analysis'
import { useLogStore } from '@/modules/log'
import ModalShell from '@/modules/shared/components/ModalShell.vue'
import AppIcon from '@/modules/shared/components/AppIcon.vue'
import AppButton from '@/modules/shared/components/AppButton.vue'

const { t } = useI18n()
const logStore = useLogStore()
const { log } = storeToRefs(logStore)
const fieldsStore = useFieldsStore()
const { simplePicker, fieldList, filteredSimpleTypes } = storeToRefs(fieldsStore)
const {
  selectedSimplePickerCurves,
  isSimplePickerTypeOpen,
  toggleSimplePickerType,
  countSimplePickerSelectedInType,
  isSimplePickerSelected,
  toggleSimplePickerField,
  onSimplePickerCurveColor,
  onSimplePickerCurveParams,
  confirmSimplePickerSelection,
} = fieldsStore
const { getFieldColor } = useAnalysisStore()
const selectedCurves = computed(() => selectedSimplePickerCurves())
const isGroupMode = computed(() => selectedCurves.value.length > 1)

function close(): void {
  simplePicker.value.open = false
}
</script>

<template>
  <ModalShell
    :open="simplePicker.open"
    variant="field-edit-modal"
    :title="t('fields.picker.title')"
    :subtitle="t('fields.picker.subtitle')"
    @close="close"
  >
    <div class="field-edit-toolbar">
      <label v-if="isGroupMode">{{ t('fields.picker.groupName') }}
        <input class="config-input field-name-input" v-model="simplePicker.groupName" :placeholder="t('fields.picker.groupNamePlaceholder')" />
      </label>
      <span v-else class="field-edit-count">{{ t('fields.picker.singleHint') }}</span>
      <span class="field-edit-count">{{ t('fields.picker.selectedCount', { n: selectedCurves.length }) }}</span>
    </div>
    <div class="field-edit-body">
      <div class="field-edit-picker">
        <div class="field-edit-picker-head">
          <strong>{{ t('fields.picker.availableTitle') }}</strong>
          <input class="input-sm" v-model="simplePicker.filter" :placeholder="t('fields.picker.searchPlaceholder')" />
        </div>
        <div class="field-edit-picker-list">
          <div v-for="typeInfo in filteredSimpleTypes" :key="'pick-' + typeInfo.name" class="tree-group">
            <button
              class="simple-picker-type"
              :class="{ 'is-open': isSimplePickerTypeOpen(typeInfo.name) }"
              type="button"
              @click="toggleSimplePickerType(typeInfo.name)"
            >
              <AppIcon :name="isSimplePickerTypeOpen(typeInfo.name) ? 'chevron-down' : 'chevron-right'" :size="13" />
              <span class="simple-picker-type-name">{{ typeInfo.name }}</span>
              <span class="simple-picker-type-meta">{{ typeInfo.fields.length }}</span>
              <span
                v-if="countSimplePickerSelectedInType(typeInfo.name, typeInfo.fields)"
                class="simple-picker-type-badge"
              >{{ countSimplePickerSelectedInType(typeInfo.name, typeInfo.fields) }}</span>
            </button>
            <div v-show="isSimplePickerTypeOpen(typeInfo.name)" class="simple-picker-fields">
              <label
                v-for="field in typeInfo.fields"
                :key="'pick-' + typeInfo.name + '.' + field"
                class="simple-picker-field"
                :class="{ 'is-active': isSimplePickerSelected(typeInfo.name, field) }"
              >
                <input type="checkbox" :checked="isSimplePickerSelected(typeInfo.name, field)" @change="toggleSimplePickerField(typeInfo.name, field)" />
                <span class="dot" :style="{ background: getFieldColor(typeInfo.name, field) }"></span>
                <span>{{ field }}</span>
              </label>
            </div>
          </div>
          <div v-if="!filteredSimpleTypes.length" class="empty-hint">{{ t('fields.picker.noMatch') }}</div>
        </div>
      </div>
      <div class="field-edit-selected">
        <div class="field-edit-selected-head">
          <strong>{{ t('fields.picker.selectedTitle') }}</strong>
          <span>{{ selectedCurves.length }} fields</span>
        </div>
        <div class="field-edit-row field-edit-row-head">
          <span>{{ t('fields.picker.colType') }}</span>
          <span>{{ t('fields.picker.colField') }}</span>
          <span>{{ t('fields.picker.colColor') }}</span>
          <span>{{ t('fields.picker.colScale') }}</span>
          <span>{{ t('fields.picker.colOffset') }}</span>
          <span></span>
        </div>
        <div v-for="curve in selectedCurves" :key="'selected-' + curve.type + '.' + curve.field" class="field-edit-row">
          <span class="field-edit-code">{{ curve.type }}</span>
          <span class="field-edit-code">{{ curve.field }}</span>
          <input class="color-input" type="color" v-model="simplePicker.curveSettings[curve.type + '.' + curve.field].color" @input="onSimplePickerCurveColor(curve)" />
          <input class="config-input num" v-model="simplePicker.curveSettings[curve.type + '.' + curve.field].scaleInput" @change="onSimplePickerCurveParams(curve)" />
          <input class="config-input num" v-model="simplePicker.curveSettings[curve.type + '.' + curve.field].offsetInput" @change="onSimplePickerCurveParams(curve)" />
          <AppButton ghost variant="danger" icon-only icon="close" :icon-size="14" :title="t('fields.picker.remove')" @click="toggleSimplePickerField(curve.type, curve.field)" />
        </div>
        <div v-if="!selectedCurves.length" class="empty-hint">{{ t('fields.picker.pickHint') }}</div>
      </div>
    </div>
    <template #actions>
      <div class="modal-actions">
        <AppButton @click="close">{{ t('common.cancel') }}</AppButton>
        <AppButton variant="primary" :disabled="fieldList.loading || log.loading" @click="confirmSimplePickerSelection">{{ t('fields.picker.apply') }}</AppButton>
      </div>
    </template>
  </ModalShell>
</template>
