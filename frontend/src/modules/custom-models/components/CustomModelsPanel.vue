<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useCustomModelsStore } from '@/modules/custom-models';
import AppIcon from '@/modules/shared/components/AppIcon.vue';
import SingleModelsTab from './SingleModelsTab.vue';
import ModelGroupsTab from './ModelGroupsTab.vue';

const { t } = useI18n();
const cms = useCustomModelsStore();
const tab = ref<'single' | 'group'>('single');
</script>

<template>
  <div class="custom-models-panel">
    <div class="cm-head">
      <strong>{{ t('customModels.panel.title') }}</strong>
      <button class="btn-icon" type="button" @click="cms.closePanel()" :title="t('customModels.panel.closeTitle')">
        <AppIcon name="close" :size="15" />
      </button>
    </div>
    <div class="cm-tabs">
      <button class="btn btn-xs" :class="{ active: tab === 'single' }" @click="tab = 'single'">{{ t('customModels.panel.tabSingle') }}</button>
      <button class="btn btn-xs" :class="{ active: tab === 'group' }" @click="tab = 'group'">{{ t('customModels.panel.tabGroup') }}</button>
    </div>
    <SingleModelsTab v-if="tab === 'single'" />
    <ModelGroupsTab v-else />
  </div>
</template>

<style scoped>
.cm-tabs { display: flex; gap: 6px; margin-bottom: 10px; }
.cm-tabs .btn { flex: 1; }
.cm-tabs .btn.active { background: #2563eb; color: #fff; }
</style>

<!--
  共享外壳样式（非 scoped，全局）：两个 tab（SingleModelsTab / ModelGroupsTab）及其子组件
  （ModelNumberField / ModelPoseField / PickLocationHint）共用这套 .cm-* 视觉语言，集中一处避免双份拷贝。
-->
<style>
/* 外壳：面板内边距 + 头部 flex 布局，CustomModelsPanel 与 TilesetsPanel 共享。 */
.custom-models-panel { padding: 8px 10px; }
.cm-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.cm-import-row { display: flex; gap: 6px; margin-bottom: 8px; }
.cm-import-row .btn { flex: 1; }
.cm-list { border: 1px solid #e5e7eb; border-radius: 6px; max-height: 140px; overflow: auto; }
.cm-empty { padding: 12px; color: #9ca3af; text-align: center; font-size: 13px; }
.cm-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 8px; cursor: pointer; border-bottom: 1px solid #f3f4f6;
}
.cm-row:hover { background: #f9fafb; }
.cm-row.active { background: #eff6ff; }
.cm-row.hidden { opacity: 0.5; }
.cm-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cm-edit { margin-top: 10px; border-top: 1px solid #e5e7eb; padding-top: 10px; }
.cm-field { display: block; margin-bottom: 8px; font-size: 12px; color: #4b5563; }
.cm-field span { display: block; margin-bottom: 2px; }
.cm-field input[type='text'],
.cm-field input[type='number'] {
  width: 100%; padding: 3px 6px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px;
}
.cm-field input[type='range'] { width: 100%; }
.cm-row2 { display: flex; gap: 8px; }
.cm-row2 .cm-field { flex: 1; }
.cm-pick { width: 100%; margin-bottom: 8px; }
.cm-gizmo { width: 100%; margin-bottom: 8px; }
.cm-gizmo.active { background: #2563eb; color: #fff; }
.cm-pick.active { background: #2563eb; color: #fff; }
.cm-save { width: 100%; margin-top: 4px; background: #16a34a; color: #fff; }
</style>
