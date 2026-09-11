import { EventsOn } from '@/wailsjs/runtime/runtime';
import { wailsAgentClient } from './wails/client';
import type { AgentEvent } from './types';

export const agentClient = wailsAgentClient;
export type { AgentClient } from './client';
export type {
  AgentEvent,
  ChatMessage,
  ChatResponse,
  HistoryResponse,
  LlmConfig,
  LlmConfigResponse,
  RoundStats,
  ToolCallTrace,
} from './types';

/** 订阅后端 agent:event 流式事件，返回取消订阅函数。 */
export function onAgentEvent(callback: (ev: AgentEvent) => void): () => void {
  return EventsOn('agent:event', (ev: AgentEvent) => callback(ev));
}
