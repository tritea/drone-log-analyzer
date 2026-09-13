<script setup lang="ts">
import { ref } from 'vue'
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

const store = useAgentStore()

/** 分析深度五档（一行分段选择）：决定后端的取数策略与迭代上限。 */
const levelOptions: { value: AnalysisLevel; label: string; title: string }[] = [
  { value: 'minimal', label: '极简', title: '1~2 轮：快速扫描，找到明显异常' },
  { value: 'fast', label: '快速', title: '3~5 轮：定位主要问题，简单交叉验证' },
  { value: 'standard', label: '标准', title: '5~10 轮：常规完整分析' },
  { value: 'pro', label: '增强', title: '10~20 轮：多数据源关联分析' },
  { value: 'deep', label: '深度', title: '20+ 轮：假设验证、反复推理' },
]

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
      :placeholder="disabled ? disabledHint : streaming ? '可继续补充信息，本轮完成后自动发送' : '输入问题，Enter 发送，Shift+Enter 换行'"
      :disabled="disabled"
      @keydown="onKeydown"
    ></textarea>
    <div class="chat-input-actions">
      <div class="chat-input-levels" title="分析深度：影响每轮的查询范围与 token 消耗">
        <span class="level-label">分析深度</span>
        <select v-model="store.agent.level" class="chat-input-level">
          <option v-for="opt in levelOptions" :key="opt.value" :value="opt.value" :title="opt.title">{{ opt.label }}</option>
        </select>
      </div>
      <span v-if="disabled" class="chat-input-hint">{{ disabledHint }}</span>
      <template v-if="streaming">
        <AppButton size="xs" variant="danger" title="停止生成" @click="emit('stop')">停止</AppButton>
        <AppButton size="xs" variant="primary" :disabled="disabled || !text.trim()" title="排队发送，本轮完成后自动发出" @click="submit">排队发送</AppButton>
      </template>
      <AppButton
        v-else
        size="xs"
        variant="primary"
        :disabled="disabled || !text.trim()"
        title="发送"
        @click="submit"
      >发送</AppButton>
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
