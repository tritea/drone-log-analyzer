import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { ChatMessage } from '@/services/agent';
import { stripIncidentBlock } from './incidents';

/** 会话 → Markdown 文本：只导出助手回答内容（多轮依次拼接；机读 incident 块剥离，问题时段已在正文中以表格呈现）。 */
export function buildMarkdown(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role === 'assistant' && m.content)
    .map((m) => stripIncidentBlock(m.content))
    .join('\n\n---\n\n');
}

/** 会话 → 打印用 HTML：只含助手回答（WebView2 打印对话框选"另存为 PDF"）。 */
export function buildPrintHtml(messages: ChatMessage[]): string {
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
  @media print { body { margin: 0; } }
</style></head><body>
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

/** 导出文件名：取当前日志名 + 日期。 */
export function exportFileName(logName: string): string {
  const base = (logName || 'log').replace(/\.[^.]+$/, '').replace(/[^\w一-龥-]+/g, '_');
  return `${base}_AI分析_${new Date().toISOString().slice(0, 10)}`;
}
