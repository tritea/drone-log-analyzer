import type { Ref } from 'vue';
import type { ChartState, LogError, LogEvent, LogMessage } from '@/types';
import { tr } from '@/locales';
import { useLogStore } from '@/modules/log';
import { useAgentStore } from '@/modules/agent';
import { SEVERITY_META } from '@/modules/agent/utils/incidents';
import { NAMED_MODE_TINT, MODE_TINT_PALETTE } from '../../utils/flight-modes';
import { formatTime } from '../../utils/format';
import type { BandSpec, TagSpec, TagTipItem, ValueRange } from '../../types';
import type { ModesApi } from './modes';
import type { RangesApi } from './ranges';

const TOOLTIP_MSG_CAP = 200;
const TAG_CAP = 150;
/** AI 警示带 z 深度：略靠前于模式色带（-2），避免共面 z-fighting。 */
const AI_BAND_Z = -1.9;
const ESCAPE_MAP: Array<[RegExp, string]> = [[/&/g, '&amp;'], [/</g, '&lt;'], [/>/g, '&gt;']];
const escapeHtml = (s: unknown): string => ESCAPE_MAP.reduce((acc, [re, rep]) => acc.replace(re, rep), String(s));

/** 标注：飞行模式/AI 警示色带（BandSpec）+ 事件/AI 标签（TagSpec）及其 tooltip。 */
export interface MarksApi {
  buildBands(xRange: ValueRange): BandSpec[];
  buildEventTags(xRange: ValueRange): TagSpec[];
  buildTagTooltip(items: TagTipItem[], kind: string): string;
}

export function createMarks(
  chart: Ref<ChartState>,
  ranges: RangesApi,
  modes: ModesApi,
): MarksApi {
  function buildBands(xRange: ValueRange): BandSpec[] {
    const out: BandSpec[] = [];
    if (!xRange) return out;
    const modesList = useLogStore().log.flightModes || [];
    if (modesList.length) {
      const assigned: Record<string, string> = { ...NAMED_MODE_TINT };
      let paletteIdx = 0;
      const colorFor = (name: string): string => {
        const key = name.toUpperCase();
        if (!assigned[key]) {
          assigned[key] = MODE_TINT_PALETTE[paletteIdx % MODE_TINT_PALETTE.length];
          paletteIdx++;
        }
        return assigned[key];
      };

      let i = 0;
      while (i < modesList.length) {
        const name = modesList[i].mode;
        const rawStart = modesList[i].timeMs;
        let j = i;
        while (j + 1 < modesList.length && modesList[j + 1].mode === name) j++;
        const rawEnd = j + 1 < modesList.length ? modesList[j + 1].timeMs : xRange.max;
        if (typeof rawStart === 'number' && typeof rawEnd === 'number' && rawEnd > xRange.min && rawStart < xRange.max) {
          const start = Math.max(rawStart, xRange.min);
          const end = Math.min(rawEnd, xRange.max);
          if (end > start) out.push({ startT: start, endT: end, color: colorFor(name), label: modes.modeLabel(name) });
        }
        i = j + 1;
      }
    }

    // AI 问题时段：按严重度铺半透明警示带 + 第二行标题文字（第一行是飞行模式名，错开 22px）；
    // z 略靠前于模式色带，避免共面 z-fighting 闪烁
    const incidents = useAgentStore().incidents;
    if (incidents.length) {
      const base = ranges.incidentAnchorMs();
      for (const inc of incidents) {
        const s = base + inc.startSec * 1000;
        const e = base + inc.endSec * 1000;
        if (e > xRange.min && s < xRange.max && e > s) {
          out.push({
            startT: Math.max(s, xRange.min),
            endT: Math.min(e, xRange.max),
            color: SEVERITY_META[inc.severity].band,
            label: '⚠ ' + inc.title,
            labelTop: 22,
            z: AI_BAND_Z,
          });
        }
      }
    }
    return out;
  }

  function buildEventTags(xRange: ValueRange): TagSpec[] {
    const out: TagSpec[] = [];
    if (!xRange || !(xRange.max > xRange.min)) return out;
    const xmin = xRange.min;
    const xmax = xRange.max;

    const pushItems = <T extends { timeMs?: number }>(
      items: T[] | undefined,
      color: string,
      row: number,
      kind: string,
      makeLabel: (it: T) => string,
    ): void => {
      if (!items || !items.length) return;
      let count = 0;
      for (let i = 0; i < items.length && count < TAG_CAP; i++) {
        const it = items[i];
        const t = it && it.timeMs;
        if (typeof t !== 'number' || !isFinite(t)) continue;
        if (t < xmin || t > xmax) continue;
        out.push({ t, row, color, text: makeLabel(it), kind });
        count++;
      }
    };

    const logStore = useLogStore();
    if (chart.value.showErrors) {
      pushItems(logStore.log.errors as LogError[], '#dc2626', 0, 'err', (e) => {
        const sub = e.subsysName || '#' + e.subsys;
        return tr('analysis.marks.errPrefix') + sub + ': ' + (e.description || '#' + e.eCode);
      });
    }
    if (chart.value.showEvents) {
      pushItems(logStore.log.events as LogEvent[], '#059669', 1, 'ev', (ev) => tr('analysis.marks.evPrefix') + (ev.name || 'EV #' + ev.id));
    }
    if (chart.value.showMessages) {
      pushItems(logStore.log.messages as LogMessage[], '#2563eb', 2, 'msg', (m) => {
        let msg = (m && m.message) || '';
        if (msg.length > 64) msg = msg.slice(0, 64) + '…';
        return tr('analysis.marks.msgPrefix') + msg;
      });
    }

    // AI 问题时段：起点竖线标签（第 3 行，颜色按严重度），点击可定位
    const incidents = useAgentStore().incidents;
    let aiCount = 0;
    for (const inc of incidents) {
      if (aiCount >= TAG_CAP) break;
      const t = ranges.incidentAnchorMs() + inc.startSec * 1000;
      if (t < xmin || t > xmax) continue;
      const meta = SEVERITY_META[inc.severity];
      out.push({
        t,
        row: 3,
        color: meta.color,
        text: tr('analysis.marks.aiPrefix') + inc.title,
        kind: 'ai',
        id: inc.id,
        detail:
          tr('agent.incident.tipHeader', { severity: tr('agent.severity.' + inc.severity) }) +
          (inc.desc || inc.title) +
          (inc.fields.length ? '\n' + tr('agent.incident.tipFields', { fields: inc.fields.join(', ') }) : ''),
      });
      aiCount++;
    }
    return out;
  }

  function buildTagTooltip(items: TagTipItem[], kind: string): string {
    const meta = kind === 'err'
      ? { title: tr('analysis.marks.title.err'), accent: '#dc2626' }
      : kind === 'ev'
        ? { title: tr('analysis.marks.title.ev'), accent: '#059669' }
        : kind === 'ai'
          ? { title: tr('analysis.marks.title.ai'), accent: '#d97706' }
          : { title: tr('analysis.marks.title.msg'), accent: '#2563eb' };

    // 前缀剥离按 kind 走已知前缀表（当前语言 + 中文），语言切换后残留旧前缀也能剥掉
    const KNOWN_PREFIXES: Record<string, string[]> = {
      err: [tr('analysis.marks.errPrefix'), '错误: '],
      ev: [tr('analysis.marks.evPrefix'), '事件: '],
      ai: [tr('analysis.marks.aiPrefix')],
      msg: [tr('analysis.marks.msgPrefix'), '消息: '],
    };
    const stripPrefix = (text: string): string => {
      for (const p of KNOWN_PREFIXES[kind] || []) {
        if (text.startsWith(p)) return text.slice(p.length);
      }
      return text;
    };

    const more = items.length > TOOLTIP_MSG_CAP ? items.length - TOOLTIP_MSG_CAP : 0;
    const shown = more ? items.slice(0, TOOLTIP_MSG_CAP) : items;
    const rows = shown
      .map((it) => {
        const txt = stripPrefix(it.text);
        const detail = it.detail
          ? '<div style="color:#64748b;font-size:11px;margin:1px 0 3px;white-space:pre-line">' + escapeHtml(it.detail) + '</div>'
          : '';
        return (
          '<div style="display:grid;grid-template-columns:62px minmax(0,1fr);gap:8px;align-items:baseline;padding:2px 0">' +
          '<span style="color:#94a3b8;font:10px/1.4 Consolas,"SF Mono",monospace;white-space:nowrap">' + formatTime(it.t, false) + '</span>' +
          '<span style="min-width:0;overflow-wrap:anywhere">' + escapeHtml(txt) + detail + '</span></div>'
        );
      })
      .join('');

    return (
      '<div style="min-width:200px;max-width:440px">' +
      '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:5px;padding-bottom:5px;border-bottom:1px solid #f1f5f9">' +
      '<b style="color:' + meta.accent + ';font-size:12px">' + meta.title + '</b>' +
      '<span style="color:#94a3b8;font-size:10px">' + (items.length > 1 ? tr('analysis.marks.countOverlap', { n: items.length }) : tr('analysis.marks.countSingle', { n: items.length })) + '</span></div>' +
      '<div style="max-height:300px;overflow-y:auto;padding-right:6px">' + rows + '</div>' +
      (more ? '<div style="color:#94a3b8;font-size:10px;margin-top:4px">' + tr('analysis.marks.more', { n: more }) + '</div>' : '') +
      '</div>'
    );
  }

  return { buildBands, buildEventTags, buildTagTooltip };
}
