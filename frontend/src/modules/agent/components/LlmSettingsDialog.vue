<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import AppButton from '@/modules/shared/components/AppButton.vue'
import ModalShell from '@/modules/shared/components/ModalShell.vue'
import { useAgentStore } from '../store/agent-store'

/** 常用 OpenAI 兼容提供商预设；选自定义则手填 baseUrl。 */
const PRESETS: Record<string, string> = {
  GLM: 'https://open.bigmodel.cn/api/paas/v4',
  DeepSeek: 'https://api.deepseek.com',
  Qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  Ollama: 'http://127.0.0.1:11434/v1',
  自定义: '',
}

const agentStore = useAgentStore()

/** 步数配置行：档位 → 表单字段与说明（title + 多行配置）。 */
const stepFields: { key: keyof typeof form; label: string; hint: string }[] = [
  { key: 'maxStepsMinimal', label: '极简', hint: '1~2 轮 · 快速扫描，找明显异常' },
  { key: 'maxStepsFast', label: '快速', hint: '3~5 轮 · 定位主要问题，简单交叉验证' },
  { key: 'maxStepsStandard', label: '标准', hint: '5~10 轮 · 常规完整分析' },
  { key: 'maxStepsPro', label: '增强', hint: '10~20 轮 · 多数据源关联分析' },
  { key: 'maxStepsDeep', label: '深度', hint: '20+ 轮 · 假设验证、反复推理' },
]

const form = reactive({
  provider: '自定义',
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0,
  maxStepsMinimal: 2,
  maxStepsFast: 5,
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
    form.maxStepsFast = cfg.maxStepsFast || 5
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
    error.value = '模型 ID 必填（如 glm-4.7 / deepseek-chat / qwen-plus）'
    return
  }
  const local = /\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(form.baseUrl)
  if (!form.apiKey.trim() && !local) {
    error.value = 'API Key 必填；使用本机推理（Ollama 等）可留空'
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
    title="AI 分析设置"
    subtitle="OpenAI 兼容端点：GLM / DeepSeek / Qwen / Ollama / 自定义"
    @close="agentStore.agent.settingsOpen = false"
  >
    <div class="llm-form">
      <label class="field">
        <span>提供商</span>
        <select :value="form.provider" @change="applyPreset(($event.target as HTMLSelectElement).value)">
          <option v-for="name in Object.keys(PRESETS)" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>
      <label class="field">
        <span>Base URL</span>
        <input v-model.trim="form.baseUrl" placeholder="https://api.deepseek.com" />
      </label>
      <label class="field">
        <span>API Key</span>
        <input v-model.trim="form.apiKey" type="password" autocomplete="off" placeholder="sk-…（本机推理可留空）" />
      </label>
      <label class="field">
        <span>模型 ID</span>
        <input v-model.trim="form.model" placeholder="glm-4.7 / deepseek-chat / qwen-plus" />
      </label>
      <label class="field">
        <span>Temperature（0=默认）</span>
        <input v-model.number="form.temperature" type="number" min="0" max="2" step="0.1" />
      </label>
      <div class="steps-config">
        <span class="steps-title">最大推理步数（各档独立，超出走强制收尾）</span>
        <label v-for="f in stepFields" :key="f.key" class="steps-item">
          <span class="steps-label">{{ f.label }}<em class="steps-hint">{{ f.hint }}</em></span>
          <input v-model.number="form[f.key]" type="number" min="1" max="50" step="1" :title="f.hint" />
        </label>
      </div>
      <p v-if="error" class="form-error">{{ error }}</p>
      <p class="form-note">
        需要支持 Function Calling 的模型。密钥只保存在本机用户配置目录，不会上传。
      </p>
    </div>
    <template #actions>
      <div class="modal-actions">
        <AppButton size="xs" @click="agentStore.agent.settingsOpen = false">取消</AppButton>
        <AppButton size="xs" variant="primary" @click="save">保存</AppButton>
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
.steps-hint { font-style: normal; font-size: 11px; color: var(--text3); }
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
