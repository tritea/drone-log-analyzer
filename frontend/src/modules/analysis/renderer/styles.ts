/**
 * 图表 overlay / DOM 节点的静态样式与图标，集中管理。
 * 动态样式（带位置/颜色插值）仍就近写在各绘制方法里，用模板字符串拼装。
 */

export const OVERLAY_STYLE = `position:absolute;inset:0;pointer-events:none;overflow:hidden;`;

export const TOOLTIP_STYLE = `position:absolute;pointer-events:none;display:none;z-index:10;max-width:380px;background:#ffffff;border:1px solid #e5e7eb;border-radius:6px;box-shadow:0 4px 14px rgba(15,23,42,0.12);padding:8px 10px;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2937;line-height:1.5;`;

export const MARK_TOOLTIP_STYLE = `position:absolute;pointer-events:auto;display:none;z-index:11;max-width:440px;background:#ffffff;border:1px solid #e5e7eb;border-radius:6px;box-shadow:0 4px 14px rgba(15,23,42,0.12);padding:8px 10px;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2937;line-height:1.5;`;

export const BOX_SELECT_STYLE = `position:absolute;border:1px solid #3b82f6;background:rgba(59,130,246,0.12);pointer-events:none;display:none;z-index:9;`;

export const X_AXIS_STYLE = `position:absolute;overflow:visible;pointer-events:none;border-top:1px solid #d1d5db;`;
export const Y_AXIS_STYLE = `position:absolute;overflow:visible;pointer-events:none;border-right:1px solid #d1d5db;`;

export const TOOLBAR_STYLE = `position:absolute;right:10px;top:10px;display:flex;gap:2px;z-index:8;pointer-events:auto;background:rgba(255,255,255,0.88);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(229,231,235,0.8);border-radius:6px;padding:3px;box-shadow:0 2px 8px rgba(15,23,42,0.1);`;

export const TOOLBAR_BUTTON_STYLE = `width:28px;height:28px;border:none;background:transparent;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;color:#4b5563;outline:none;transition:background .12s,color .12s;`;

export const ICON_BOX_SELECT = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/></svg>`;

export const ICON_RESET = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>`;
