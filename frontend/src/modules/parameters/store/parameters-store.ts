import { defineStore } from 'pinia';
import { computed, reactive } from 'vue';
import type { Parameter, ParametersState } from '@/types';
import { showToast } from '@/modules/shared/ui-store';
import { logClient } from '@/services/log';
import { tr } from '@/locales';

/** 日志客户端返回：成功为参数数组，失败为 { error }。 */
function isErrorResponse(res: unknown): res is { error: string } {
  return !!res && typeof res === 'object' && !Array.isArray(res) && typeof (res as { error?: unknown }).error === 'string';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useParametersStore = defineStore('parameters', () => {
  const parameters = reactive({
    items: [] as Parameter[],
    filter: '',
    open: false,
    loading: false,
  }) as ParametersState;

  // 名称子串过滤（大小写不敏感）。
  const filteredParameters = computed<Parameter[]>(() => {
    const needle = parameters.filter.trim().toLowerCase();
    if (!needle) return parameters.items;
    return parameters.items.filter((p) => String(p.name || '').toLowerCase().includes(needle));
  });

  function openParameters(): void {
    parameters.open = true;
    void loadParameters();
  }

  async function loadParameters(): Promise<void> {
    parameters.loading = true;
    try {
      const res: unknown = await logClient.parameters();
      if (isErrorResponse(res)) {
        showToast(res.error, 'error');
        parameters.items = [];
      } else {
        parameters.items = Array.isArray(res) ? (res as Parameter[]) : [];
      }
    } catch (error) {
      parameters.items = [];
      showToast(tr('log.parametersLoadFailed', { err: describeError(error) }), 'error');
    } finally {
      parameters.loading = false;
    }
  }

  return { parameters, filteredParameters, openParameters, loadParameters };
});
