import type {
  ChatResponse,
  HistoryResponse,
  LlmConfig,
  LlmConfigResponse,
} from './types';

export interface AgentClient {
  chat(message: string): Promise<ChatResponse>;
  stop(): Promise<void>;
  history(): Promise<HistoryResponse>;
  clear(): Promise<void>;
  getLlmConfig(): Promise<LlmConfigResponse>;
  saveLlmConfig(config: LlmConfig): Promise<LlmConfigResponse>;
}
