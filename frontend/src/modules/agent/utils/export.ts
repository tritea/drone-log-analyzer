import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { ChatMessage } from '@/services/agent';
import { useCurveManagerStore } from '@/modules/curves';
import type { CurveBinary } from '@/modules/analysis/utils/curve-binary';
import { useAnalysisStore } from '@/modules/analysis';
import { formatTime } from '@/modules/analysis/utils/format';
import type { Incident } from './incidents';
import { SEVERITY_META, stripIncidentBlock } from './incidents';

/** 会话 → Markdown 文本：只导出助手回答内容（多轮依次拼接；机读 incident 块剥离，问题时段已在正文中以表格呈现）。 */
export function buildMarkdown(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role === 'assistant' && m.content)
    .map((m) => stripIncidentBlock(m.content))
    .join('\n\n---\n\n');
}

/** 会话 → 打印用 HTML：只含助手回答（WebView2 打印对话框选"另存为 PDF"）；appendix 为问题时段图表附录。 */
export function buildPrintHtml(messages: ChatMessage[], appendix = ''): string {
  const blocks = messages
    .filter((m) => m.role === 'assistant' && m.content)
    .map((m) => DOMPurify.sanitize(marked.parse(stripIncidentBlock(m.content), { async: false }) as string))
    .join('\n<hr>\n');
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>AI 分析结果</title>
<style>
  body { font-family: "Microsoft YaHei", sans-serif; color: #1e293b; margin: 32px; line-height: 1.7; }
  hr { border: none; border-top: 1px solid #cbd5e1; margin: 24px 0; }
  table { border-collapse: collapse; } th, td { border: 1px solid #cbd5e1; padding: 3px 8px; }
  th { background: #eef2f8; }
  pre { background: #eef2f8; padding: 8px; border-radius: 6px; overflow-x: auto; }
  code { font-family: Consolas, monospace; }
  .inc-sec { margin: 18px 0 26px; page-break-inside: avoid; }
  .inc-sec h3 { margin: 0 0 4px; font-size: 15px; }
  .inc-meta { margin: 0 0 8px; font-size: 12px; color: #475569; }
  .inc-badge { display: inline-block; color: #fff; font-size: 11px; border-radius: 4px; padding: 1px 6px; margin-right: 4px; }
  .inc-chart { display: block; margin: 6px 0 10px; }
  .inc-field { font-size: 12px; font-weight: 600; color: #334155; margin: 8px 0 2px; }
  @media print { body { margin: 0; } }
</style></head><body>
${blocks}
${appendix}
</body></html>`;
}

/** 隐藏 iframe 打印（Chromium/WebView2 打印对话框含"另存为 PDF"）。 */
export function printHtml(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.srcdoc = html;
  iframe.onload = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 60_000);
  };
  document.body.appendChild(iframe);
}

/** 导出文件名：取当前日志名 + 日期。 */
export function exportFileName(logName: string): string {
  const base = (logName || 'log').replace(/\.[^.]+$/, '').replace(/[^\w一-龥-]+/g, '_');
  return `${base}_AI分析_${new Date().toISOString().slice(0, 10)}`;
}

// ---- 问题时段字段折线图（PDF 附录） ------------------------------------------

const CHART_MAX_INCIDENTS = 8;
const CHART_MAX_FIELDS = 4;
const CHART_W = 720;
const CHART_H = 132;
const CHART_PAD = { left: 56, right: 12, top: 8, bottom: 20 };
const CHART_MAX_POINTS = 480;
const CHART_COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed'];
const ESCAPE_MAP: Array<[RegExp, string]> = [[/&/g, '&amp;'], [/</g, '&lt;'], [/>/g, '&gt;']];
const escapeHtml = (s: string): string => ESCAPE_MAP.reduce((acc, [re, rep]) => acc.replace(re, rep), s);

const fmtVal = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(4);
};

/**
 * 单字段在时间窗内的 SVG 折线：曲线 + 问题时段警示底带 + X/Y 轴标注。
 * 数据即视图：直接从本地曲线二进制（buffer 为 [相对ms, 值] 交错对）采样，不依赖图表实例。
 */
function fieldChartSvg(
  bin: CurveBinary,
  winStartMs: number,
  winEndMs: number,
  markStartMs: number,
  markEndMs: number,
  color: string,
  severityColor: string,
): string {
  const innerW = CHART_W - CHART_PAD.left - CHART_PAD.right;
  const innerH = CHART_H - CHART_PAD.top - CHART_PAD.bottom;
  const winSpan = Math.max(winEndMs - winStartMs, 1);

  // 窗口内采样（抽稀到 CHART_MAX_POINTS 内，控制 SVG 体积）
  const n = bin.count;
  const step = Math.max(1, Math.floor(n / CHART_MAX_POINTS));
  const pts: Array<{ t: number; v: number }> = [];
  for (let i = 0; i < n; i += step) {
    const t = bin.baseTimeMs + bin.buffer[i * 2];
    if (t < winStartMs || t > winEndMs) continue;
    pts.push({ t, v: bin.buffer[i * 2 + 1] });
  }
  if (pts.length < 2) return '';

  let vMin = Infinity;
  let vMax = -Infinity;
  for (const p of pts) {
    if (p.v < vMin) vMin = p.v;
    if (p.v > vMax) vMax = p.v;
  }
  if (!(vMax > vMin)) {
    vMin -= 1;
    vMax += 1;
  }
  const vSpan = vMax - vMin;
  const x = (t: number): number => CHART_PAD.left + ((t - winStartMs) / winSpan) * innerW;
  const y = (v: number): number => CHART_PAD.top + (1 - (v - vMin) / vSpan) * innerH;
  const points = pts.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');

  // 问题时段警示底带（红色系底 + 起止虚线）
  const mStart = Math.max(markStartMs, winStartMs);
  const mEnd = Math.min(markEndMs, winEndMs);
  const band =
    mEnd > mStart
      ? `<rect x="${x(mStart).toFixed(1)}" y="${CHART_PAD.top}" width="${(x(mEnd) - x(mStart)).toFixed(1)}" height="${innerH}" fill="${severityColor}" fill-opacity="0.12"/>` +
        `<line x1="${x(mStart).toFixed(1)}" y1="${CHART_PAD.top}" x2="${x(mStart).toFixed(1)}" y2="${CHART_PAD.top + innerH}" stroke="${severityColor}" stroke-width="1" stroke-dasharray="3 2"/>` +
        `<line x1="${x(mEnd).toFixed(1)}" y1="${CHART_PAD.top}" x2="${x(mEnd).toFixed(1)}" y2="${CHART_PAD.top + innerH}" stroke="${severityColor}" stroke-width="1" stroke-dasharray="3 2"/>`
      : '';

  // 轴标注：X 五等分时刻，Y 上下限
  let xLabels = '';
  for (let i = 0; i <= 4; i++) {
    const t = winStartMs + (winSpan * i) / 4;
    const anchor = i === 0 ? 'start' : i === 4 ? 'end' : 'middle';
    xLabels += `<text x="${x(t).toFixed(1)}" y="${CHART_H - 5}" font-size="10" fill="#6b7280" text-anchor="${anchor}">${escapeHtml(formatTime(t))}</text>`;
  }
  const yLabels =
    `<text x="${CHART_PAD.left - 6}" y="${(CHART_PAD.top + 4).toFixed(1)}" font-size="10" fill="#6b7280" text-anchor="end">${fmtVal(vMax)}</text>` +
    `<text x="${CHART_PAD.left - 6}" y="${(CHART_PAD.top + innerH).toFixed(1)}" font-size="10" fill="#6b7280" text-anchor="end">${fmtVal(vMin)}</text>`;

  return (
    `<svg class="inc-chart" width="${CHART_W}" height="${CHART_H}" viewBox="0 0 ${CHART_W} ${CHART_H}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="${CHART_PAD.left}" y="${CHART_PAD.top}" width="${innerW}" height="${innerH}" fill="#f8fafc" stroke="#e2e8f0"/>` +
    band +
    `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>` +
    xLabels + yLabels +
    `</svg>`
  );
}

/**
 * 问题时段 → PDF 附录 HTML：每个时段按涉及字段逐个绘制窗口折线（前后留余量），
 * 曲线数据从本地按需拉取（字段未加载过也能取到），失败的字段静默跳过。
 */
export async function buildIncidentChartsHtml(incidents: Incident[]): Promise<string> {
  const list = incidents.slice(0, CHART_MAX_INCIDENTS);
  if (!list.length) return '';

  const cm = useCurveManagerStore();
  const baseMs = useAnalysisStore().chartBaseTimeMs();
  const sections: string[] = [];

  for (const inc of list) {
    const charts: string[] = [];
    const fields = inc.fields.slice(0, CHART_MAX_FIELDS);
    for (let fi = 0; fi < fields.length; fi++) {
      const fieldName = fields[fi];
      const dot = fieldName.indexOf('.');
      if (dot <= 0 || dot >= fieldName.length - 1) continue;
      const type = fieldName.slice(0, dot);
      const field = fieldName.slice(dot + 1);
      let bin: CurveBinary | null = null;
      try {
        bin = await cm.get(type, field);
      } catch {
        continue; // 字段不存在/拉取失败：跳过该字段
      }
      if (!bin || !bin.count) continue;
      const padSec = Math.max((inc.endSec - inc.startSec) * 0.25, 5);
      const svg = fieldChartSvg(
        bin,
        baseMs + (inc.startSec - padSec) * 1000,
        baseMs + (inc.endSec + padSec) * 1000,
        baseMs + inc.startSec * 1000,
        baseMs + inc.endSec * 1000,
        CHART_COLORS[fi % CHART_COLORS.length],
        SEVERITY_META[inc.severity].color,
      );
      if (!svg) continue;
      const unit = cm.logdefs?.units[type + '.' + field];
      charts.push(`<div class="inc-field">${escapeHtml(fieldName)}${unit ? `（${escapeHtml(unit)}）` : ''}</div>` + svg);
    }
    if (!charts.length) continue;
    const meta = SEVERITY_META[inc.severity];
    const t0 = formatTime(baseMs + inc.startSec * 1000);
    const t1 = formatTime(baseMs + inc.endSec * 1000);
    sections.push(
      `<section class="inc-sec"><h3>⚠ ${escapeHtml(inc.title)}</h3>` +
        `<p class="inc-meta"><span class="inc-badge" style="background:${meta.color}">${meta.label}</span>` +
        `${escapeHtml(t0)} ~ ${escapeHtml(t1)}（${(inc.endSec - inc.startSec).toFixed(1)}s）` +
        `${inc.desc ? ' — ' + escapeHtml(inc.desc) : ''}</p>` +
        charts.join('') +
        `</section>`,
    );
  }

  if (!sections.length) return '';
  return `<hr><h2>问题时段曲线</h2>` + sections.join('');
}
