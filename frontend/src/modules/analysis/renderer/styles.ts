/**
 * 图表 skin（DOM 覆盖层）节点的静态样式常量，集中管理。
 * 位置一律 left/top 归零、transform 移动（拖拽/悬停高频路径不触发布局）。
 * 带位置/颜色插值的动态样式就近写在绘制方法里，模板字符串拼装。
 */

/** 四向白描边：让文字压在曲线/网格上仍可读（内嵌轴标签的关键）。 */
const TEXT_HALO = 'text-shadow:-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff,0 1px 2px rgba(0,0,0,0.25);';

const FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif';

export const SKIN_STYLE = `position:absolute;inset:0;pointer-events:none;overflow:hidden;`;

export const TOOLTIP_STYLE = `position:absolute;left:0;top:0;pointer-events:none;display:none;z-index:10;max-width:380px;background:#ffffff;border:1px solid #e5e7eb;border-radius:6px;box-shadow:0 4px 14px rgba(15,23,42,0.12);padding:8px 10px;font:12px ${FONT};color:#1f2937;line-height:1.5;`;

export const TAG_TIP_STYLE = `position:absolute;left:0;top:0;pointer-events:auto;display:none;z-index:11;max-width:440px;background:#ffffff;border:1px solid #e5e7eb;border-radius:6px;box-shadow:0 4px 14px rgba(15,23,42,0.12);padding:8px 10px;font:12px ${FONT};color:#1f2937;line-height:1.5;`;

export const RECT_STYLE = `position:absolute;border:1px solid #3b82f6;background:rgba(59,130,246,0.12);pointer-events:none;display:none;z-index:9;`;

/** X 轴刻度文字：绘图区下方 gutter 内，居中于网格线。 */
export const X_LABEL_STYLE = `position:absolute;left:0;font:11px ${FONT};color:#6b7280;white-space:nowrap;letter-spacing:0.2px;`;

/** Y 轴刻度文字：绘图区左侧 gutter 内，右对齐至绘图区左缘。 */
export const Y_LABEL_STYLE = `position:absolute;left:0;font:11px ${FONT};color:#6b7280;white-space:nowrap;`;

/** 模式色带标签（压曲线，白描边保可读；动态 top 就地拼）。 */
export const BAND_LABEL_STYLE = `position:absolute;left:0;color:#374151;font:700 12px ${FONT};pointer-events:none;white-space:nowrap;letter-spacing:0.3px;${TEXT_HALO}`;

/** 事件标签 pill（动态颜色就地拼）。 */
export const TAG_PILL_STYLE = `position:absolute;left:0;pointer-events:auto;white-space:nowrap;font:600 10px ${FONT};border-radius:999px;padding:1px 7px;color:#ffffff;box-shadow:0 1px 2px rgba(15,23,42,0.18);display:none;`;
