import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { ChatMessage, LlmConfig, ToolCallTrace } from '@/services/agent';

export interface ExportMeta {
  filename: string;
  vehicleType: string;
  firmwareVersion: string;
  format: string;
  model: string;
}

function toolLine(t: ToolCallTrace): string {
  const parts = [t.tool];
  if (t.durationMs != null) parts.push(`${t.durationMs}ms`);
  return `- 🔧 ${parts.join(' ')}：${(t.summary ?? '').slice(0, 160)}`;
}

function statsLine(m: ChatMessage): string {
  const s = m.stats;
  if (!s) return '';
  const dur = s.durationMs != null ? `${(s.durationMs / 1000).toFixed(1)}s` : '';
  const tok =
    s.totalTokens != null
      ? ` · ↑${fmtTok(s.promptTokens)} ↓${fmtTok(s.completionTokens)}（Σ${fmtTok(s.totalTokens)}）`
      : '';
  return dur || tok ? `\n\n<sub>⏱ ${dur}${tok}</sub>` : '';
}

function fmtTok(n?: number): string {
  if (n == null) return '-';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** 会话 → Markdown 报告文本。 */
export function buildMarkdown(meta: ExportMeta, messages: ChatMessage[]): string {
  const head = [
    '# 飞控日志 AI 分析报告',
    '',
    `- 日志文件：${meta.filename || '未知'}`,
    `- 机型：${meta.vehicleType || '未知'}${meta.format ? `（${meta.format}）` : ''}`,
    `- 固件：${meta.firmwareVersion || '未知'}`,
    `- 模型：${meta.model || '未知'}`,
    `- 导出时间：${new Date().toLocaleString()}`,
    '',
    '---',
    '',
  ];
  const body: string[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      body.push(`## ❓ ${m.content}`, '');
    } else {
      body.push(m.content, '');
      if (m.toolTrace?.length) {
        body.push('<details><summary>分析过程</summary>', '', ...m.toolTrace.map(toolLine), '', '</details>', '');
      }
      const st = statsLine(m);
      if (st) body.push(st, '');
    }
  }
  return [...head, ...body].join('\n');
}

/** 会话 → 打印用 HTML（WebView2 打印对话框选"另存为 PDF"即可导出 PDF）。 */
export function buildPrintHtml(meta: ExportMeta, messages: ChatMessage[]): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const blocks = messages
    .map((m) => {
      if (m.role === 'user') {
        return `<section class="q"><div class="tag">问</div><div>${esc(m.content)}</div></section>`;
      }
      const md = DOMPurify.sanitize(marked.parse(m.content ?? '', { async: false }) as string);
      const trace = (m.toolTrace ?? [])
        .map((t) => `<li>${esc(t.tool)}${t.durationMs != null ? ` · ${t.durationMs}ms` : ''}</li>`)
        .join('');
      const st = m.stats;
      const stHtml = st
        ? `<footer>⏱ ${((st.durationMs ?? 0) / 1000).toFixed(1)}s${
            st.totalTokens != null ? ` · ↑${st.promptTokens ?? '-'} ↓${st.completionTokens ?? '-'} tokens` : ''
          }</footer>`
        : '';
      return `<section class="a"><div class="tag">答</div><div class="md">${md}${
        trace ? `<ul class="trace">${trace}</ul>` : ''
      }${stHtml}</div></section>`;
    })
    .join('\n');
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>飞控日志 AI 分析报告</title>
<style>
  body { font-family: "Microsoft YaHei", sans-serif; color: #1e293b; margin: 32px; line-height: 1.7; }
  header { border-bottom: 2px solid #2563eb; padding-bottom: 8px; margin-bottom: 20px; }
  header h1 { font-size: 20px; margin: 0 0 6px; }
  header p { margin: 2px 0; font-size: 12px; color: #64748b; }
  section { margin: 18px 0; display: flex; gap: 10px; }
  .tag { flex: none; width: 26px; height: 26px; border-radius: 50%; background: #eaf1ff; color: #2563eb;
         display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; }
  section.a .md { flex: 1; }
  section.q > div:last-child { flex: 1; font-weight: 600; }
  table { border-collapse: collapse; } th, td { border: 1px solid #cbd5e1; padding: 3px 8px; }
  th { background: #eef2f8; }
  pre { background: #eef2f8; padding: 8px; border-radius: 6px; overflow-x: auto; }
  code { font-family: Consolas, monospace; }
  .trace { margin: 8px 0 0; padding-left: 18px; color: #64748b; font-size: 12px; }
  footer { margin-top: 6px; color: #94a3b8; font-size: 12px; }
  @media print { body { margin: 0; } }
</style></head><body>
<header><h1>飞控日志 AI 分析报告</h1>
<p>日志：${esc(meta.filename || '未知')} · 机型：${esc(meta.vehicleType || '未知')} · 固件：${esc(
    meta.firmwareVersion || '未知',
  )} · 模型：${esc(meta.model || '未知')}</p>
<p>导出时间：${new Date().toLocaleString()}</p></header>
${blocks}
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

export function exportFileName(meta: ExportMeta): string {
  const base = (meta.filename || 'log').replace(/\.[^.]+$/, '').replace(/[^\w一-龥-]+/g, '_');
  return `${base}_AI分析_${new Date().toISOString().slice(0, 10)}`;
}

export type { LlmConfig };
