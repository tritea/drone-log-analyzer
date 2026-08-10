<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useFieldsStore } from '@/modules/fields'
import { useAnalysisStore } from '@/modules/analysis'
import { useLogStore } from '@/modules/log'
import ModalShell from '@/modules/shared/components/ModalShell.vue'
import AppIcon from '@/modules/shared/components/AppIcon.vue'
import AppButton from '@/modules/shared/components/AppButton.vue'

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
    title="添加字段"
    subtitle="所选字段保存为一个字段组；单选默认按 TYPE.FIELD 命名。"
    @close="close"
  >
    <div class="field-edit-toolbar">
      <label v-if="isGroupMode">组名
        <input class="config-input field-name-input" v-model="simplePicker.groupName" placeholder="例如 att_basic" />
      </label>
      <span v-else class="field-edit-count">单字段会按 TYPE.FIELD 命名</span>
      <span class="field-edit-count">已选 {{ selectedCurves.length }}</span>
    </div>
    <div class="field-edit-body">
      <div class="field-edit-picker">
        <div class="field-edit-picker-head">
          <strong>可用字段</strong>
          <input class="input-sm" v-model="simplePicker.filter" placeholder="搜索字段..." />
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
          <div v-if="!filteredSimpleTypes.length" class="empty-hint">没有匹配的字段</div>
        </div>
      </div>
      <div class="field-edit-selected">
        <div class="field-edit-selected-head">
          <strong>已选字段</strong>
          <span>{{ selectedCurves.length }} fields</span>
        </div>
        <div class="field-edit-row field-edit-row-head">
          <span>消息</span>
          <span>字段</span>
          <span>色彩</span>
          <span>倍率</span>
          <span>基线</span>
          <span></span>
        </div>
        <div v-for="curve in selectedCurves" :key="'selected-' + curve.type + '.' + curve.field" class="field-edit-row">
          <span class="field-edit-code">{{ curve.type }}</span>
          <span class="field-edit-code">{{ curve.field }}</span>
          <input class="color-input" type="color" v-model="simplePicker.curveSettings[curve.type + '.' + curve.field].color" @input="onSimplePickerCurveColor(curve)" />
          <input class="config-input num" v-model="simplePicker.curveSettings[curve.type + '.' + curve.field].scaleInput" @change="onSimplePickerCurveParams(curve)" />
          <input class="config-input num" v-model="simplePicker.curveSettings[curve.type + '.' + curve.field].offsetInput" @change="onSimplePickerCurveParams(curve)" />
          <AppButton ghost variant="danger" icon-only icon="close" :icon-size="14" title="移除" @click="toggleSimplePickerField(curve.type, curve.field)" />
        </div>
        <div v-if="!selectedCurves.length" class="empty-hint">从左侧选择一个或多个字段。</div>
      </div>
    </div>
    <template #actions>
      <div class="modal-actions">
        <AppButton @click="close">取消</AppButton>
        <AppButton variant="primary" :disabled="fieldList.loading || log.loading" @click="confirmSimplePickerSelection">应用</AppButton>
      </div>
    </template>
  </ModalShell>
</template>
