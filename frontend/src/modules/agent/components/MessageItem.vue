<script setup lang="ts">
import type { ChatMessage } from '@/services/agent'
import ToolCallCard from './ToolCallCard.vue'

defineProps<{ message: ChatMessage }>()
</script>

<template>
  <div class="msg" :class="message.role">
    <div v-if="message.toolTrace?.length" class="msg-tools">
      <ToolCallCard v-for="(t, i) in message.toolTrace" :key="i" :trace="t" />
    </div>
    <div class="msg-bubble">{{ message.content }}</div>
  </div>
</template>

<style scoped>
.msg {
  display: flex;
  flex-direction: column;
  max-width: 92%;
}
.msg.user { align-self: flex-end; align-items: flex-end; }
.msg.assistant { align-self: flex-start; align-items: flex-start; }
.msg + .msg { margin-top: 10px; }
.msg-tools {
  width: 100%;
  margin-bottom: 4px;
}
.msg-bubble {
  padding: 8px 12px;
  border-radius: var(--radius-lg);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg.user .msg-bubble {
  background: var(--blue);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.msg.assistant .msg-bubble {
  background: var(--surface);
  border: 1px solid var(--border);
  border-bottom-left-radius: 4px;
  box-shadow: var(--shadow-sm);
}
</style>
