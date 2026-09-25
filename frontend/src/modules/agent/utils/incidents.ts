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
  /** 相对日志起点的秒（与后端工具输出的 tSec 列同基准）。 */
  startSec: number;
  endSec: number;
  severity: IncidentSeverity;
  title: string;
  desc: string;
  /** 涉及字段（"分组.字段" 形式，如 CTUN.Alt）。 */
  fields: string[];
}

/** 严重度 → 展示元数据：标记色 / 图表底色带（带透明度，可叠在模式色带上）。
 * 展示名走词条 `agent.severity.<key>`，语言切换即时生效。 */
export const SEVERITY_META: Record<IncidentSeverity, { color: string; band: string }> = {
  low: { color: '#2563eb', band: 'rgba(37,99,235,0.10)' },
  medium: { color: '#d97706', band: 'rgba(217,119,6,0.12)' },
  high: { color: '#ea580c', band: 'rgba(234,88,12,0.14)' },
  critical: { color: '#dc2626', band: 'rgba(220,38,38,0.16)' },
};

const MAX_INCIDENTS = 12;
const MAX_FIELDS = 4;
const MAX_TITLE_LEN = 40;
const MAX_DESC_LEN = 200;
const FENCE_RE = /```incident[^\n]*\n([\s\S]*?)```/g;
const ANY_FENCE_RE = /```[^\n]*\n([\s\S]*?)```/g;
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

/** 单个围栏内容 → 规范化 incident 列表（JSON 非法或形状不符返回空）。 */
function parseBlock(body: string): Incident[] {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    // 块内混有说明文字（模型把机读块写成排版小节）：提取首个 [ 到末个 ] 的内嵌 JSON 再试
    const lo = body.indexOf('[');
    const hi = body.lastIndexOf(']');
    if (lo < 0 || hi <= lo) return [];
    try {
      raw = JSON.parse(body.slice(lo, hi + 1));
    } catch {
      return [];
    }
  }
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { incidents?: unknown }).incidents)
      ? (raw as { incidents: unknown[] }).incidents
      : null;
  if (!arr) return [];
  return arr.map(normalizeItem).filter((x): x is Incident => !!x).slice(0, MAX_INCIDENTS);
}

interface AdoptedBlock {
  start: number;
  end: number;
  list: Incident[];
}

/**
 * 定位被采纳的 incident 块：显式 ```incident 标记优先（多条时取最后一个＝最终版）；
 * 没有显式标记时兜底扫描所有围栏代码块，找形状匹配的 JSON（模型偶尔把语言
 * 标记写成 json 或留空）。形状校验由 normalizeItem 保证——普通 JSON（如参数
 * 表）没有 startSec+title 结构，不会误判。
 */
function adoptBlock(content: string): AdoptedBlock | null {
  let hit: AdoptedBlock | null = null;
  for (const m of content.matchAll(FENCE_RE)) {
    const list = parseBlock(m[1]);
    if (list.length) hit = { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, list };
  }
  if (hit) return hit;
  for (const m of content.matchAll(ANY_FENCE_RE)) {
    const list = parseBlock(m[1]);
    if (list.length) return { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, list };
  }
  return null;
}

/** 从一条助手消息解析问题时段（被采纳块内的机读列表）。 */
export function parseIncidents(content: string): Incident[] {
  if (!content) return [];
  return adoptBlock(content)?.list ?? [];
}

/** 展示用内容：剥离被采纳的机读块（UI 中以可点击标记卡片呈现，避免原始 JSON 干扰阅读）。 */
export function stripIncidentBlock(content: string): string {
  const hit = adoptBlock(content);
  if (!hit) return content;
  return (content.slice(0, hit.start) + content.slice(hit.end)).replace(/\n{3,}/g, '\n\n').trim();
}
