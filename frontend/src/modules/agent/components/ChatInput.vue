<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/modules/shared/components/AppButton.vue'
import { useAgentStore } from '../store/agent-store'
import type { AnalysisLevel } from '@/services/agent'

const props = defineProps<{
  streaming: boolean
  disabled: boolean
  disabledHint: string
}>()

const emit = defineEmits<{
  (e: 'send', text: string): void
  (e: 'stop'): void
}>()

const { t } = useI18n()
const store = useAgentStore()

/** 分析深度五档（一行分段选择）：决定后端的取数策略与迭代上限。 */
const levelOptions = computed<{ value: AnalysisLevel; label: string; title: string }[]>(() => [
  { value: 'minimal', label: t('agent.depth.minimal.label'), title: t('agent.depth.minimal.title') },
  { value: 'fast', label: t('agent.depth.fast.label'), title: t('agent.depth.fast.title') },
  { value: 'standard', label: t('agent.depth.standard.label'), title: t('agent.depth.standard.title') },
  { value: 'pro', label: t('agent.depth.pro.label'), title: t('agent.depth.pro.title') },
  { value: 'deep', label: t('agent.depth.deep.label'), title: t('agent.depth.deep.title') },
])

const text = ref('')

function submit(): void {
  if (props.disabled) return
  const value = text.value.trim()
  if (!value) return
  // 生成期间不拦：父级 store 会把消息排队，本轮结束后自动续发。
  emit('send', value)
  text.value = ''
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault()
    submit()
  }
}
</script>

<template>
  <div class="chat-input">
    <textarea
      v-model="text"
      rows="2"
      :placeholder="disabled ? disabledHint : streaming ? t('agent.input.placeholderQueued') : t('agent.input.placeholderIdle')"
      :disabled="disabled"
      @keydown="onKeydown"
    ></textarea>
    <div class="chat-input-actions">
      <div class="chat-input-levels" :title="t('agent.input.levelTitle')">
        <span class="level-label">{{ t('agent.input.levelLabel') }}</span>
        <select v-model="store.agent.level" class="chat-input-level">
          <option v-for="opt in levelOptions" :key="opt.value" :value="opt.value" :title="opt.title">{{ opt.label }}</option>
        </select>
      </div>
      <span v-if="disabled" class="chat-input-hint">{{ disabledHint }}</span>
      <template v-if="streaming">
        <AppButton size="xs" variant="danger" :title="t('agent.input.stopTitle')" @click="emit('stop')">{{ t('agent.input.stop') }}</AppButton>
        <AppButton size="xs" variant="primary" :disabled="disabled || !text.trim()" :title="t('agent.input.queueSendTitle')" @click="submit">{{ t('agent.input.queueSend') }}</AppButton>
      </template>
      <AppButton
        v-else
        size="xs"
        variant="primary"
        :disabled="disabled || !text.trim()"
        :title="t('agent.input.send')"
        @click="submit"
      >{{ t('agent.input.send') }}</AppButton>
    </div>
  </div>
</template>

<style scoped>
.chat-input {
  border-top: 1px solid var(--border);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--surface);
}
.chat-input textarea {
  resize: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 6px 8px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
  background: var(--surface-soft);
  outline: none;
}
.chat-input textarea:focus { border-color: var(--blue); box-shadow: var(--ring); }
.chat-input textarea:disabled { color: var(--text3); cursor: not-allowed; }
.chat-input-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}
.chat-input-hint { margin-right: auto; font-size: 12px; color: var(--text3); }
.chat-input-levels {
  margin-right: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.level-label { font-size: 12px; color: var(--text3); }
.chat-input-level {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-soft);
  color: var(--text);
  font-size: 12px;
  padding: 2px 6px;
  outline: none;
  cursor: pointer;
}
.chat-input-level:focus { border-color: var(--blue); box-shadow: var(--ring); }
</style>
