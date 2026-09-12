import { Marked } from 'marked';
import type { Tokens } from 'marked';

/** agent 模块共用的 markdown 渲染器（面板 MarkdownView + PDF 导出 export.ts）。
 * GFM + breaks；del（删除线）还原为普通文本：模型常用 ~ 表示"约/区间"
 * （如 ±12~39 m/s、~12 m），marked 18 起单波浪线即成 <del>，成对出现会把
 * 大段正文误划掉，而分析报告从不真的需要删除线。定界符原样还原（区分
 * ~/~~），避免 ±12~39 被吞成 ±1239 这类数值错误。 */
export const agentMd = new Marked({ gfm: true, breaks: true });

agentMd.use({
  renderer: {
    del(token: Tokens.Del): string {
      const fence = token.raw.startsWith('~~') ? '~~' : '~';
      return fence + this.parser.parseInline(token.tokens) + fence;
    },
  },
});
