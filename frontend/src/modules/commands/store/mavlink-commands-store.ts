import { defineStore } from 'pinia';
import { computed, reactive } from 'vue';
import type { MAVLinkCommand, MAVLinkCommandsState } from '@/types';
import { showToast } from '@/modules/shared/ui-store';
import { logClient } from '@/services/log';
import { tr } from '@/locales';

/** 日志客户端返回：成功为 MAVLink 命令数组，失败为 { error }。 */
function isErrorResponse(res: unknown): res is { error: string } {
  return !!res && typeof res === 'object' && !Array.isArray(res) && typeof (res as { error?: unknown }).error === 'string';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useMAVLinkCommandsStore = defineStore('mavlinkCommands', () => {
  const mavlinkCommands = reactive({
    items: [] as MAVLinkCommand[],
    loaded: false,
    filter: '',
    open: false,
    loading: false,
  }) as MAVLinkCommandsState;

  // 跨命令名/帧名/结果/坐标的子串过滤（大小写不敏感）。
  const filteredMAVLinkCommands = computed<MAVLinkCommand[]>(() => {
    const needle = mavlinkCommands.filter.trim().toLowerCase();
    if (!needle) return mavlinkCommands.items;
    return mavlinkCommands.items.filter((cmd) => {
      if (!cmd) return false;
      const haystack = [
        cmd.commandName,
        'cmd' + (cmd.command || 0),
        cmd.frameName,
        cmd.resultName,
        cmd.latitude,
        cmd.longitude,
        cmd.altitude,
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  });

  function openMAVLinkCommands(): void {
    mavlinkCommands.open = true;
    void loadMAVLinkCommands();
  }

  async function loadMAVLinkCommands(): Promise<void> {
    mavlinkCommands.loading = true;
    try {
      const res: unknown = await logClient.mavlinkCommands();
      if (isErrorResponse(res)) {
        showToast(res.error, 'error');
        mavlinkCommands.items = [];
      } else {
        mavlinkCommands.items = Array.isArray(res) ? (res as MAVLinkCommand[]) : [];
      }
    } catch (error) {
      mavlinkCommands.items = [];
      showToast(tr('log.mavlinkLoadFailed', { err: describeError(error) }), 'error');
    } finally {
      mavlinkCommands.loaded = true;
      mavlinkCommands.loading = false;
    }
  }

  return { mavlinkCommands, filteredMAVLinkCommands, openMAVLinkCommands, loadMAVLinkCommands };
});
