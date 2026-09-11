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
  /** 经保存对话框把文本写盘（导出报告）；取消时返回空串。 */
  exportText(defaultName: string, content: string): Promise<string>;
}
