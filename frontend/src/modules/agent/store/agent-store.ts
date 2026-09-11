import { defineStore } from 'pinia';
import { computed, reactive } from 'vue';
import { agentClient, onAgentEvent } from '@/services/agent';
import type { AgentEvent, ChatMessage, LlmConfig } from '@/services/agent';

/** 一条工具调用的展示态（进行中/已完成）。 */
export interface ToolCallView {
  tool: string;
  args?: Record<string, unknown>;
  summary?: string;
  durationMs?: number;
  pending: boolean;
}

interface StreamingState {
  active: boolean;
  text: string;
  /** 推理模型的思考过程（灰显折叠展示，不落历史）。 */
  reasoning: string;
  tools: ToolCallView[];
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

const defaultLlmConfig = (): LlmConfig => ({
  provider: '',
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0,
  maxSteps: 15,
});

export const useAgentStore = defineStore('agent', () => {
  const agent = reactive({
    messages: [] as ChatMessage[],
    streaming: { active: false, text: '', reasoning: '', tools: [] as ToolCallView[] } as StreamingState,
    error: '',
    llm: defaultLlmConfig(),
    llmPath: '',
    settingsOpen: false,
  });

  /** 本地 baseUrl（Ollama 等）无需 API Key。 */
  const llmConfigured = computed(() => {
    const cfg = agent.llm;
    if (!cfg.model) return false;
    if (cfg.apiKey) return true;
    return /\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(cfg.baseUrl);
  });

  let unsubEvents: (() => void) | null = null;
  let initialized = false;

  /** 面板挂载时调用：订阅流式事件并拉取历史/配置（幂等）。 */
  async function initialize(): Promise<void> {
    if (initialized) return;
    initialized = true;
    unsubEvents = onAgentEvent(handleEvent);
    await Promise.all([loadHistory(), loadLlmConfig()]);
  }

  function dispose(): void {
    unsubEvents?.();
    unsubEvents = null;
    initialized = false;
  }

  async function loadHistory(): Promise<void> {
    try {
      const resp = await agentClient.history();
      agent.messages = resp?.messages ?? [];
    } catch (err) {
      agent.error = `加载会话历史失败：${errText(err)}`;
    }
  }

  async function loadLlmConfig(): Promise<void> {
    try {
      const resp = await agentClient.getLlmConfig();
      agent.llm = { ...defaultLlmConfig(), ...(resp?.config ?? {}) };
      agent.llmPath = resp?.path ?? '';
    } catch (err) {
      agent.error = `读取 LLM 配置失败：${errText(err)}`;
    }
  }

  async function saveLlmConfig(config: LlmConfig): Promise<void> {
    const resp = await agentClient.saveLlmConfig(config);
    agent.llm = { ...defaultLlmConfig(), ...(resp?.config ?? config) };
    agent.settingsOpen = false;
  }

  async function send(text: string): Promise<void> {
    const message = text.trim();
    if (!message || agent.streaming.active) return;
    agent.messages.push({ role: 'user', content: message });
    agent.error = '';
    agent.streaming = { active: true, text: '', reasoning: '', tools: [] };
    try {
      const resp = await agentClient.chat(message);
      if (resp?.message) agent.messages.push(resp.message);
    } catch (err) {
      agent.error = errText(err);
    } finally {
      agent.streaming.active = false;
      agent.streaming.text = '';
      agent.streaming.reasoning = '';
      agent.streaming.tools = [];
    }
  }

  function stop(): void {
    void agentClient.stop().catch((err: unknown): void => {
      // 停止失败不阻塞 UI（前端已按 streaming 状态收尾）。
      agent.error = err instanceof Error ? err.message : String(err);
    });
  }

  async function clearSession(): Promise<void> {
    try {
      await agentClient.clear();
      agent.messages = [];
      agent.error = '';
    } catch (err) {
      agent.error = errText(err);
    }
  }

  /** 流式事件：final 只负责收尾 UI（消息本体以 Chat 调用结果为准，避免重复）。 */
  function handleEvent(ev: AgentEvent): void {
    switch (ev.type) {
      case 'delta':
        agent.streaming.active = true;
        agent.streaming.text += ev.text ?? '';
        break;
      case 'reasoning':
        agent.streaming.active = true;
        agent.streaming.reasoning += ev.text ?? '';
        break;
      case 'tool_start':
        agent.streaming.tools.push({ tool: ev.tool ?? '', args: ev.args, pending: true });
        break;
      case 'tool_end': {
        for (let i = agent.streaming.tools.length - 1; i >= 0; i--) {
          const t = agent.streaming.tools[i];
          if (t.pending && t.tool === ev.tool) {
            t.summary = ev.summary;
            t.durationMs = ev.durationMs;
            t.pending = false;
            break;
          }
        }
        break;
      }
      case 'final':
      case 'error':
        break;
    }
  }

  return {
    agent,
    llmConfigured,
    initialize,
    dispose,
    send,
    stop,
    clearSession,
    loadLlmConfig,
    saveLlmConfig,
  };
});
