import * as configAPI from '@/wailsjs/go/wails/ConfigAPI';
import type { ConfigClient } from '../client';

const CURVE_KEY_MAP: Record<string, string> = {
  templateName: 'fieldName',
  templateGroupScale: 'fieldGroupScale',
  templateGroupOffset: 'fieldGroupOffset',
  templateGroupScaleInput: 'fieldGroupScaleInput',
  templateGroupOffsetInput: 'fieldGroupOffsetInput',
};
const CURVE_KEY_MAP_REV: Record<string, string> = Object.fromEntries(
  Object.entries(CURVE_KEY_MAP).map(([k, v]) => [v, k])
);

function remapCurveKeys(curves: any, toFrontend: boolean): any[] {
  if (!Array.isArray(curves)) return [];
  const m = toFrontend ? CURVE_KEY_MAP : CURVE_KEY_MAP_REV;
  return curves.map((c: any) => {
    const out: any = {};
    for (const k in c) out[m[k] || k] = c[k];
    return out;
  });
}

function mapEntriesResponse(r: any): any {
  return {
    entries: Array.isArray(r?.templates) ? r.templates : [],
    path: r?.path ?? '',
    error: r?.error,
    savedEntry: r?.savedTemplate,
  };
}

export const wailsConfigClient: ConfigClient = {
  getSettings: () => configAPI.GetSettings(),
  saveSettings: (settings) => configAPI.SaveSettings(settings),
  setFormat: (format: string) => (configAPI as any).SetCurrentFormat(format),
  getFlightMetrics: () => configAPI.GetFlightMetrics(),
  saveFlightMetrics: (metrics) => configAPI.SaveFlightMetrics(metrics),
  getCurveState: async () => {
    const r: any = await configAPI.GetCurveState();
    return { ...r, activeCurves: remapCurveKeys(r?.activeCurves, true) };
  },
  saveCurveState: (activeCurves) =>
    configAPI.SaveCurveState({ activeCurves: remapCurveKeys(activeCurves, false) } as any),
  listFieldEntries: async () => mapEntriesResponse(await configAPI.ListFieldEntries()),
  saveFieldEntry: async (tmpl) => mapEntriesResponse(await configAPI.SaveFieldEntry(tmpl)),
  deleteFieldEntry: async (name) => mapEntriesResponse(await configAPI.DeleteFieldEntry({ name })),
  listCustomModels: () => configAPI.ListCustomModels(),
  saveCustomModel: (model) => configAPI.SaveCustomModel(model),
  deleteCustomModel: (name) => configAPI.DeleteCustomModel({ name }),
  listModelGroups: () => configAPI.ListModelGroups(),
  saveModelGroup: (group) => configAPI.SaveModelGroup(group),
  deleteModelGroup: (name) => configAPI.DeleteModelGroup({ name }),
  listTilesets: () => configAPI.ListTilesets(),
  saveTileset: (t) => configAPI.SaveTileset(t),
  deleteTileset: (name) => configAPI.DeleteTileset({ name }),
};
