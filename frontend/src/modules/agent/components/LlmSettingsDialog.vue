<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/modules/shared/components/AppButton.vue'
import ModalShell from '@/modules/shared/components/ModalShell.vue'
import { useAgentStore } from '../store/agent-store'

const { t } = useI18n()

/** 常用 OpenAI 兼容提供商预设；选自定义则手填 baseUrl。'自定义' 是持久化的
 * provider 值（兼容已存配置），界面展示时翻译为当前语言。 */
const PRESETS: Record<string, string> = {
  GLM: 'https://open.bigmodel.cn/api/paas/v4',
  DeepSeek: 'https://api.deepseek.com',
  Qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  Ollama: 'http://127.0.0.1:11434/v1',
  自定义: '',
}

const presetLabel = (name: string): string => (name === '自定义' ? t('agent.settings.custom') : name)

const agentStore = useAgentStore()

/** 步数配置行：档位 → 表单字段（定位说明仅作悬停提示，不占行内显示）。 */
const stepFields = computed<{ key: keyof typeof form; label: string; hint: string }[]>(() => [
  { key: 'maxStepsMinimal', label: t('agent.depth.minimal.label'), hint: t('agent.depth.minimal.hint') },
  { key: 'maxStepsFast', label: t('agent.depth.fast.label'), hint: t('agent.depth.fast.hint') },
  { key: 'maxStepsStandard', label: t('agent.depth.standard.label'), hint: t('agent.depth.standard.hint') },
  { key: 'maxStepsPro', label: t('agent.depth.pro.label'), hint: t('agent.depth.pro.hint') },
  { key: 'maxStepsDeep', label: t('agent.depth.deep.label'), hint: t('agent.depth.deep.hint') },
])

const form = reactive({
  provider: '自定义',
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0,
  maxStepsMinimal: 2,
  maxStepsFast: 4,
  maxStepsStandard: 10,
  maxStepsPro: 13,
  maxStepsDeep: 25,
})

const error = ref('')

watch(
  () => agentStore.agent.settingsOpen,
  (open) => {
    if (!open) return
    const cfg = agentStore.agent.llm
    form.provider = cfg.provider || '自定义'
    form.baseUrl = cfg.baseUrl
    form.apiKey = cfg.apiKey
    form.model = cfg.model
    form.temperature = cfg.temperature
    form.maxStepsMinimal = cfg.maxStepsMinimal || 2
    form.maxStepsFast = cfg.maxStepsFast || 4
    form.maxStepsStandard = cfg.maxStepsStandard || 10
    form.maxStepsPro = cfg.maxStepsPro || 13
    form.maxStepsDeep = cfg.maxStepsDeep || 25
    error.value = ''
  },
)

function applyPreset(name: string): void {
  form.provider = name
  if (PRESETS[name] !== undefined) form.baseUrl = PRESETS[name]
}

function save(): void {
  if (!form.model.trim()) {
    error.value = t('agent.settings.errorModelRequired')
    return
  }
  const local = /\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(form.baseUrl)
  if (!form.apiKey.trim() && !local) {
    error.value = t('agent.settings.errorApiKeyRequired')
    return
  }
  agentStore
    .saveLlmConfig({ ...form })
    .catch((err: unknown) => {
      error.value = err instanceof Error ? err.message : String(err)
    })
}
</script>

<template>
  <ModalShell
    :open="agentStore.agent.settingsOpen"
    variant="agent-settings-modal"
    :title="t('agent.settings.title')"
    :subtitle="t('agent.settings.subtitle')"
    @close="agentStore.agent.settingsOpen = false"
  >
    <div class="llm-form">
      <label class="field">
        <span>{{ t('agent.settings.provider') }}</span>
        <select :value="form.provider" @change="applyPreset(($event.target as HTMLSelectElement).value)">
          <option v-for="name in Object.keys(PRESETS)" :key="name" :value="name">{{ presetLabel(name) }}</option>
        </select>
      </label>
      <label class="field">
        <span>Base URL</span>
        <input v-model.trim="form.baseUrl" placeholder="https://api.deepseek.com" />
      </label>
      <label class="field">
        <span>API Key</span>
        <input v-model.trim="form.apiKey" type="password" autocomplete="off" :placeholder="t('agent.settings.apiKeyPlaceholder')" />
      </label>
      <label class="field">
        <span>{{ t('agent.settings.modelId') }}</span>
        <input v-model.trim="form.model" placeholder="glm-4.7 / deepseek-chat / qwen-plus" />
      </label>
      <label class="field">
        <span>{{ t('agent.settings.temperature') }}</span>
        <input v-model.number="form.temperature" type="number" min="0" max="2" step="0.1" />
      </label>
      <div class="steps-config">
        <span class="steps-title">{{ t('agent.settings.stepsTitle') }}</span>
        <label v-for="f in stepFields" :key="f.key" class="steps-item">
          <span class="steps-label">{{ f.label }}</span>
          <input v-model.number="form[f.key]" type="number" min="1" max="50" step="1" :title="f.hint" />
        </label>
      </div>
      <p v-if="error" class="form-error">{{ error }}</p>
      <p class="form-note">
        {{ t('agent.settings.note') }}
      </p>
    </div>
    <template #actions>
      <div class="modal-actions">
        <AppButton size="xs" @click="agentStore.agent.settingsOpen = false">{{ t('common.cancel') }}</AppButton>
        <AppButton size="xs" variant="primary" @click="save">{{ t('common.save') }}</AppButton>
      </div>
    </template>
  </ModalShell>
</template>

<style scoped>
.llm-form { display: flex; flex-direction: column; gap: 12px; padding: 16px 20px; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text2); }
.field input, .field select {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 6px 8px;
  font-size: 13px;
  color: var(--text);
  background: var(--surface-soft);
}
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.steps-config { display: flex; flex-direction: column; gap: 6px; }
.steps-title { font-size: 12px; color: var(--text2); }
.steps-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: var(--text2);
}
.steps-label { display: flex; align-items: baseline; gap: 8px; }
.steps-item input {
  width: 72px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 4px 6px;
  font-size: 13px;
  color: var(--text);
  background: var(--surface-soft);
}
.form-error { color: var(--red); font-size: 12px; margin: 0; }
.form-note { color: var(--text3); font-size: 12px; margin: 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
