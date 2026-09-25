import { useUiStore } from './modules/shared/ui-store';
import { useAnalysisStore } from './modules/analysis';
import { useFieldsStore } from './modules/fields';
import { useView3dStore } from './modules/view3d';
import { usePlaybackStore, stopFrameLoop } from './modules/playback';
import { useEarthStore } from './modules/earth';
import { useMap2dStore } from './modules/map-2d';
import { useSettingsStore } from './modules/settings';
import { useFlightMetricsStore } from './modules/flight-metrics';
import { isEditableTarget } from './modules/shared/utils/dom';

type CaptureListener = { type: string; handler: EventListener; capture: boolean };
let listeners: CaptureListener[] = [];

function add<K extends keyof WindowEventMap>(type: K, handler: (e: WindowEventMap[K]) => void): void {
  const listener = handler as EventListener;
  window.addEventListener(type, listener, true);
  listeners.push({ type, handler: listener, capture: true });
}

export function appMounted(): void {
  const uiStore = useUiStore();
  const chartStore = useAnalysisStore();
  const view3dStore = useView3dStore();


  useFieldsStore().loadFields();
  useSettingsStore().loadToolbarConfig();
  useFlightMetricsStore().loadFlightMetricsConfig();

  add('keydown', function (e: KeyboardEvent) {
    if (isEditableTarget(e.target)) return;
    if (view3dStore.handleWalkerKey(e, true)) return;
    if (e.key === 'Shift' && !uiStore.ui.shiftZoomActivatedByKey) {
      uiStore.ui.shiftZoomActivatedByKey = true;
      chartStore.setRectZoomActive(true);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      chartStore.undoZoom();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === '0' || e.code === 'Numpad0')) {
      e.preventDefault();
      chartStore.resetZoom();
    }
  });
  add('keyup', function (e: KeyboardEvent) {
    if (view3dStore.handleWalkerKey(e, false)) return;
    if (e.key === 'Shift' && uiStore.ui.shiftZoomActivatedByKey) {
      uiStore.ui.shiftZoomActivatedByKey = false;
      chartStore.setRectZoomActive(false);
    }
  });

  add('dragover', function (e: DragEvent) {
    e.preventDefault();
  });
  add('drop', function (e: DragEvent) {
    e.preventDefault();
  });
}

export function appBeforeUnmount(): void {
  for (let i = 0; i < listeners.length; i++) {
    const l = listeners[i];
    window.removeEventListener(l.type, l.handler, l.capture);
  }
  listeners = [];
  const chartStore = useAnalysisStore();
  if (chartStore.curveSave.saveTimer) clearTimeout(chartStore.curveSave.saveTimer);
  const fieldsStore = useFieldsStore();
  if (fieldsStore.fieldList.settingsSaveTimer) clearTimeout(fieldsStore.fieldList.settingsSaveTimer);
  useSettingsStore().flushSave();
  useFlightMetricsStore().flushSave();
  stopFrameLoop();
  useView3dStore().teardownView3d();
  useView3dStore().teardownDial();
  useEarthStore().disposeEarth();
  useMap2dStore().teardownMap2d();
  usePlaybackStore().releaseTelemetry();
}
