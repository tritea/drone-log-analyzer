import { defineStore } from 'pinia';
import { reactive } from 'vue';
import type { UiState } from '@/types';

export const useUiStore = defineStore('ui', () => {
  const ui = reactive({
    mainView: 'chart',
    simpleFieldFilter: '',
    dragOver: false,
    dragDepth: 0,
    shiftZoomActive: true,
    shiftZoomActivatedByKey: false,
    toast: null,
    recordOpen: false,
    recordTab: 'messages',
  }) as UiState;

  return { ui };
});

export function showToast(msg: string, type?: string): void {
  useUiStore().ui.toast = { msg, type: type || 'info' };
  setTimeout(function() { useUiStore().ui.toast = null; }, 2500);
}
