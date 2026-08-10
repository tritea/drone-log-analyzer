import { useUiStore } from './modules/shared/ui-store';
import { useAnalysisStore } from './modules/analysis';
import { useFieldsStore } from './modules/fields';
import { useScene3dStore } from './modules/scene-3d';
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
  const threeStore = useScene3dStore();


  useFieldsStore().loadFields();
  useSettingsStore().loadToolbarConfig();
  useFlightMetricsStore().loadFlightMetricsConfig();

  add('keydown', function (e: KeyboardEvent) {
    if (isEditableTarget(e.target)) return;
    if (threeStore.applyThreeFpsKey(e, true)) return;
    if (e.key === 'Shift' && !uiStore.ui.shiftZoomActivatedByKey) {
      uiStore.ui.shiftZoomActivatedByKey = true;
      chartStore.setBoxZoomActive(true);
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
    if (threeStore.applyThreeFpsKey(e, false)) return;
    if (e.key === 'Shift' && uiStore.ui.shiftZoomActivatedByKey) {
      uiStore.ui.shiftZoomActivatedByKey = false;
      chartStore.setBoxZoomActive(false);
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
  if (chartStore.curveState.saveTimer) clearTimeout(chartStore.curveState.saveTimer);
  const fieldsStore = useFieldsStore();
  if (fieldsStore.fieldList.settingsSaveTimer) clearTimeout(fieldsStore.fieldList.settingsSaveTimer);
  useSettingsStore().flushSave();
  useFlightMetricsStore().flushSave();
  useScene3dStore().destroyThreeView();
}
