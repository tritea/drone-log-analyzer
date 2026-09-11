<script setup lang="ts">
import { ref } from 'vue'
import AppButton from '@/modules/shared/components/AppButton.vue'

const props = defineProps<{
  streaming: boolean
  disabled: boolean
  disabledHint: string
}>()

const emit = defineEmits<{
  (e: 'send', text: string): void
  (e: 'stop'): void
}>()

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
</style>
