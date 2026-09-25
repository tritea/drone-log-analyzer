/** Agent 服务的 DTO 镜像（对齐后端 agentservice/model.go 与 app/model/llm.go）。 */

/** 分析深度五档：极简(1~2轮)/快速(3~5轮)/标准(5~10轮)/增强(10~20轮)/深度(20+轮)。 */
export type AnalysisLevel = 'minimal' | 'fast' | 'standard' | 'pro' | 'deep';

export interface ToolCallTrace {
  tool: string;
  args?: Record<string, unknown>;
  summary?: string;
  durationMs?: number;
}

/** 一轮的耗时与 token 用量（usage 由提供商回传，缺失时仅有时长）。 */
export interface RoundStats {
  durationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolTrace?: ToolCallTrace[];
  /** 展示态：生成期间排队补充的消息，尚未真正发给后端。 */
  queued?: boolean;
  stats?: RoundStats;
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
  /** ReAct 迭代上限按分析档位配置（极简/快速/标准/增强/深度）。 */
  maxStepsMinimal: number;
  maxStepsFast: number;
  maxStepsStandard: number;
  maxStepsPro: number;
  maxStepsDeep: number;
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
