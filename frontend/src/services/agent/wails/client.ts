import * as agentAPI from '@/wailsjs/go/wails/AgentAPI';
import * as configAPI from '@/wailsjs/go/wails/ConfigAPI';
import type { AgentClient } from '../client';
import type {
  AnalysisLevel,
  ChatResponse,
  HistoryResponse,
  LlmConfig,
  LlmConfigResponse,
} from '../types';

/** 把 wailsjs 生成的类实例摊平为普通对象，字段已按 json tag 转小驼峰。 */
function toPlain<T>(source: unknown): T {
  if (source == null || typeof source !== 'object') {
    return source as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
    if (typeof v === 'function') continue;
    out[k] = v;
  }
  return out as T;
}

export const wailsAgentClient: AgentClient = {
  chat: async (message: string, level?: AnalysisLevel): Promise<ChatResponse> =>
    toPlain(await agentAPI.Chat({ message, level })),
  stop: () => agentAPI.Stop(),
  history: async (): Promise<HistoryResponse> => toPlain(await agentAPI.History()),
  clear: () => agentAPI.Clear(),
  getLlmConfig: async (): Promise<LlmConfigResponse> =>
    toPlain(await configAPI.GetLlmConfig()),
  saveLlmConfig: async (config: LlmConfig): Promise<LlmConfigResponse> =>
    toPlain(await configAPI.SaveLlmConfig(config)),
  exportText: (defaultName: string, content: string): Promise<string> =>
    agentAPI.ExportText(defaultName, content),
};
