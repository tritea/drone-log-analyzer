/**
 * AI 分析结论中的问题时段标记：解析助手回答末尾的 ```incident JSON 代码块。
 *
 * 模型按系统提示词约定，在指出问题时段时输出机读块（相对秒 + 字段名），
 * 前端解析后驱动：主图警示带/标记、3D 时间轴警示条、消息内可点击卡片、PDF 图表。
 */

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Incident {
  /** 稳定 id（起始秒-结束秒-标题），跨消息去重与点击回查用。 */
  id: string;
  /** 相对日志起点的秒（与后端工具 timeSec 同基准）。 */
  startSec: number;
  endSec: number;
  severity: IncidentSeverity;
  title: string;
  desc: string;
  /** 涉及字段（"分组.字段" 形式，如 CTUN.Alt）。 */
  fields: string[];
}

/** 严重度 → 展示元数据：中文标签 / 标记色 / 图表底色带（带透明度，可叠在模式色带上）。 */
export const SEVERITY_META: Record<IncidentSeverity, { label: string; color: string; band: string }> = {
  low: { label: '提示', color: '#2563eb', band: 'rgba(37,99,235,0.10)' },
  medium: { label: '关注', color: '#d97706', band: 'rgba(217,119,6,0.12)' },
  high: { label: '严重', color: '#ea580c', band: 'rgba(234,88,12,0.14)' },
  critical: { label: '致命', color: '#dc2626', band: 'rgba(220,38,38,0.16)' },
};

const MAX_INCIDENTS = 12;
const MAX_FIELDS = 4;
const MAX_TITLE_LEN = 40;
const MAX_DESC_LEN = 200;
const FENCE_RE = /```incident[^\n]*\n([\s\S]*?)```/g;
const SEVERITIES = ['low', 'medium', 'high', 'critical'];

function normalizeSeverity(v: unknown): IncidentSeverity {
  const s = String(v ?? '').toLowerCase();
  return SEVERITIES.includes(s) ? (s as IncidentSeverity) : 'medium';
}

/** 单个原始对象 → 规范化 Incident；不合法（缺时间/缺标题）返回 null。 */
function normalizeItem(raw: unknown): Incident | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const startSec = Number(o.startSec ?? o.start ?? o.t);
  let endSec = Number(o.endSec ?? o.end);
  if (!Number.isFinite(startSec) || startSec < 0) return null;
  if (!Number.isFinite(endSec) || endSec <= startSec) endSec = startSec + 1;
  const title = String(o.title ?? o.name ?? '').trim().slice(0, MAX_TITLE_LEN);
  if (!title) return null;
  const fields = Array.isArray(o.fields)
    ? o.fields.map((f) => String(f).trim()).filter(Boolean).slice(0, MAX_FIELDS)
    : [];
  const start = Math.round(startSec * 10) / 10;
  const end = Math.round(endSec * 10) / 10;
  return {
    id: `${start}-${end}-${title}`,
    startSec: start,
    endSec: end,
    severity: normalizeSeverity(o.severity),
    title,
    desc: String(o.desc ?? o.description ?? '').trim().slice(0, MAX_DESC_LEN),
    fields,
  };
}

/** 从一条助手消息解析问题时段：取最后一个合法 incident 块（模型多轮修订时以最终版为准）。 */
export function parseIncidents(content: string): Incident[] {
  if (!content) return [];
  const blocks = [...content.matchAll(FENCE_RE)];
  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      const raw: unknown = JSON.parse(blocks[i][1]);
      const arr = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as { incidents?: unknown }).incidents)
          ? (raw as { incidents: unknown[] }).incidents
          : null;
      if (!arr) continue;
      const out = arr.map(normalizeItem).filter((x): x is Incident => !!x).slice(0, MAX_INCIDENTS);
      if (out.length) return out;
    } catch {
      // 非法 JSON：忽略该块，继续找更早的
    }
  }
  return [];
}

/** 展示用内容：剥离机读 incident 块（UI 中以可点击标记卡片呈现，避免原始 JSON 干扰阅读）。 */
export function stripIncidentBlock(content: string): string {
  return content
    .replace(FENCE_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
