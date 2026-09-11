/** Agent 服务的 DTO 镜像（对齐后端 agentservice/model.go 与 app/model/llm.go）。 */

export interface ToolCallTrace {
  tool: string;
  args?: Record<string, unknown>;
  summary?: string;
  durationMs?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolTrace?: ToolCallTrace[];
  /** 展示态：生成期间排队补充的消息，尚未真正发给后端。 */
  queued?: boolean;
}

export interface AgentEvent {
  type: 'delta' | 'reasoning' | 'tool_start' | 'tool_end' | 'final' | 'error';
  text?: string;
  tool?: string;
  args?: Record<string, unknown>;
  summary?: string;
  durationMs?: number;
  message?: ChatMessage;
  error?: string;
}

export interface LlmConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxSteps: number;
}

export interface LlmConfigResponse {
  config: LlmConfig | null;
  path: string;
}

export interface HistoryResponse {
  messages: ChatMessage[];
}

export interface ChatResponse {
  message: ChatMessage;
}
