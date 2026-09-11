import { defineStore } from 'pinia';
import { computed, reactive, watch } from 'vue';
import { agentClient, onAgentEvent } from '@/services/agent';
import type { AgentEvent, ChatMessage, LlmConfig } from '@/services/agent';
import { useLogStore } from '@/modules/log';
import { useAnalysisStore } from '@/modules/analysis';
import { useScene3dStore } from '@/modules/scene-3d';
import type { Incident } from '../utils/incidents';
import { parseIncidents } from '../utils/incidents';
import { buildMarkdown, buildPrintHtml, exportFileName, printHtml } from '../utils/export';

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
    /** 生成期间排队补充的消息（多条合并换行），本轮结束后自动发送。 */
    queued: '',
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

  /** AI 分析结论中的问题时段（跨消息去重合并、按时间升序）：供主图/时间轴标记与 PDF 图表。 */
  const incidents = computed<Incident[]>(() => {
    const seen = new Set<string>();
    const out: Incident[] = [];
    for (const m of agent.messages) {
      if (m.role !== 'assistant' || !m.content) continue;
      for (const inc of parseIncidents(m.content)) {
        if (seen.has(inc.id)) continue;
        seen.add(inc.id);
        out.push(inc);
      }
    }
    return out.sort((a, b) => a.startSec - b.startSec);
  });

  // 问题时段变化（新分析完成/清空会话/切换日志）→ 刷新主图警示带与标记
  watch(incidents, () => {
    useAnalysisStore().rebuildChart();
  });

  /** 问题时段相对秒 → 绝对 ms（锚定曲线日志起点，与主图/回放同一时间轴）。 */
  function incidentAbsMs(sec: number): number {
    return useAnalysisStore().chartBaseTimeMs() + sec * 1000;
  }

  /** 定位问题时段：3D 播放跳到时段起点，主图缩放到该窗口（供消息卡片/图表标记点击）。 */
  function focusIncident(inc: Incident): void {
    if (!inc) return;
    useScene3dStore().seekThreeToTime(incidentAbsMs(inc.startSec));
    useAnalysisStore().focusChartWindow(incidentAbsMs(inc.startSec), incidentAbsMs(inc.endSec));
  }

  let unsubEvents: (() => void) | null = null;
  let initialized = false;

  /** 面板挂载时调用：订阅流式事件并拉取历史/配置（幂等）。 */
  async function initialize(): Promise<void> {
    if (initialized) return;
    initialized = true;
    unsubEvents = onAgentEvent(handleEvent);
    await Promise.all([loadHistory(), loadLlmConfig()]);
  }

  /**
   * 重新拉取会话历史。面板常驻挂载，initialize 只在应用启动时跑一次——
   * 那时日志多半还没加载（后端按无日志返回空会话）；面板每次真正打开、
   * 以及切换日志文件时都要刷新，否则一直显示启动时的空缓存。
   */
  async function refreshHistory(): Promise<void> {
    if (agent.streaming.active) return;
    await loadHistory();
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

  /** 发送；生成期间调用则排队（气泡立即显示、灰显标"排队中"），本轮结束后自动续发。 */
  async function send(text: string): Promise<void> {
    const message = text.trim();
    if (!message) return;
    if (agent.streaming.active) {
      agent.queued = agent.queued ? `${agent.queued}\n${message}` : message;
      agent.messages.push({ role: 'user', content: message, queued: true });
      return;
    }
    await startRound(message, false);
  }

  async function startRound(message: string, alreadyDisplayed: boolean): Promise<void> {
    if (!alreadyDisplayed) {
      agent.messages.push({ role: 'user', content: message });
    }
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
      if (agent.queued) {
        const next = agent.queued;
        agent.queued = '';
        for (const m of agent.messages) {
          if (m.queued) m.queued = false;
        }
        void startRound(next, true);
      }
    }
  }

  function stop(): void {
    void agentClient.stop().catch((err: unknown): void => {
      // 停止失败不阻塞 UI（前端已按 streaming 状态收尾）。
      agent.error = err instanceof Error ? err.message : String(err);
    });
  }

  /** 导出当前日志名（用于导出文件名）。 */
  function currentLogName(): string {
    const logStore = useLogStore();
    return logStore.log.summary?.filename ?? logStore.log.fileName ?? '';
  }

  /** 导出 Markdown 文件（保存对话框）：只含助手回答内容。 */
  async function exportMarkdown(): Promise<void> {
    const name = exportFileName(currentLogName());
    const content = buildMarkdown(agent.messages);
    const saved = await agentClient.exportText(`${name}.md`, content);
    if (saved) agent.error = '';
  }

  /** 导出 PDF：打印对话框里选"另存为 PDF"；只含助手回答内容。 */
  function exportPdf(): void {
    printHtml(buildPrintHtml(agent.messages));
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
    incidents,
    focusIncident,
    initialize,
    dispose,
    refreshHistory,
    send,
    stop,
    clearSession,
    loadLlmConfig,
    saveLlmConfig,
    exportMarkdown,
    exportPdf,
  };
});
