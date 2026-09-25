import { defineStore } from 'pinia';
import { computed, reactive } from 'vue';
import type { CommandsState, MissionCommand } from '@/types';
import { showToast } from '@/modules/shared/ui-store';
import { logClient } from '@/services/log';
import { useView3dStore } from '@/modules/view3d';
import { tr } from '@/locales';

/** 日志客户端返回：成功为航点命令数组，失败为 { error }。 */
function isErrorResponse(res: unknown): res is { error: string } {
  return !!res && typeof res === 'object' && !Array.isArray(res) && typeof (res as { error?: unknown }).error === 'string';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useCommandsStore = defineStore('commands', () => {
  const commands = reactive({
    items: [] as MissionCommand[],
    loaded: false,
    filter: '',
    open: false,
    loading: false,
  }) as CommandsState;

  // 跨命令名/序号/帧名/坐标的子串过滤（大小写不敏感）。
  const filteredCommands = computed<MissionCommand[]>(() => {
    const needle = commands.filter.trim().toLowerCase();
    if (!needle) return commands.items;
    return commands.items.filter((cmd) => {
      if (!cmd) return false;
      const haystack = [
        cmd.commandName,
        'cmd' + (cmd.command || 0),
        'seq' + (cmd.sequence || 0),
        cmd.frameName,
        cmd.latitude,
        cmd.longitude,
        cmd.altitude,
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  });

  function openCommands(): void {
    commands.open = true;
    void loadCommands();
  }

  async function loadCommands(): Promise<void> {
    commands.loading = true;
    try {
      const res: unknown = await logClient.commands();
      if (isErrorResponse(res)) {
        showToast(res.error, 'error');
        commands.items = [];
      } else {
        commands.items = Array.isArray(res) ? (res as MissionCommand[]) : [];
        useView3dStore().rebuildMissionVersions();
      }
    } catch (error) {
      commands.items = [];
      showToast(tr('log.commandsLoadFailed', { err: describeError(error) }), 'error');
    } finally {
      commands.loaded = true;
      commands.loading = false;
    }
  }

  return { commands, filteredCommands, openCommands, loadCommands };
});
