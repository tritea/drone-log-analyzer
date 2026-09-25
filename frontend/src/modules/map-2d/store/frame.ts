import { runtime } from '@/modules/shared/runtime';
import { useUiStore } from '@/modules/shared/ui-store';
import { useMapStateStore } from '@/modules/shared/map-state';
import { useView3dStore } from '@/modules/view3d';
import { usePlaybackStore } from '@/modules/playback';
import { useCommandsStore } from '@/modules/commands';
import { isGcj02Provider } from './basemap';
import type { FrameSyncApi, Map2dStoreCtx } from './types';

/* 帧同步域：可视化帧循环（modules/playback，mapFps 节流）的 reconcile 入口 + 渲染器互斥销毁。
 * 全部「上帧已见」状态收敛进单个 ledger（旧版是十几个模块级 let），失忆/销毁一处置零。 */

/** 变更检测账本：reconcile 每帧与当前状态比对，不同才触发对应重建/挂摘。 */
interface SyncLedger {
  /** 上帧是否处于激活渲染（false→true 边沿 = 刚切入，需 mount + 数据键失忆）。 */
  live: boolean;
  telemetryKey: string;
  commandCount: number;
  missionKey: string;
  /** 任务命令懒加载是否已发起（失败后可重试：loaded 仍 false 时不重复要）。 */
  commandFetchAsked: boolean;
  showTravel: boolean;
  showPins: boolean;
  showPlan: boolean;
}

function blankLedger(): SyncLedger {
  return {
    live: false,
    telemetryKey: '',
    commandCount: -1,
    missionKey: '',
    commandFetchAsked: false,
    showTravel: true,
    showPins: true,
    showPlan: true,
  };
}

export function createFrameSync(ctx: Map2dStoreCtx): FrameSyncApi {
  const ledger = blankLedger();

  // 每帧 reconcile：底图换源 / 遥测换源 / 任务变化 / 覆盖层开关 → 对应域动作，
  // 末尾推进轨迹与机标。未激活时只记账返回（切回时由边沿重新 mount）。
  function reconcileMap2d(): void {
    const mapState = useMapStateStore();
    const opts = mapState.map;
    if (useUiStore().ui.mainView !== 'three' || !opts.active) {
      ledger.live = false;
      return;
    }
    if (!ledger.live) {
      ledger.live = true;
      ctx.basemap.mount();
      const fresh = runtime.mapView;
      if (fresh) fresh.map.invalidateSize();
      ledger.telemetryKey = '';
      ledger.commandCount = -1;
      ledger.missionKey = '';
    }
    const view = runtime.mapView;
    if (!view) return;

    // 底图换源：坐标系制度翻转（WGS-84 ↔ GCJ-02 高德）时，轨迹/航点须按新制度重算。
    if (opts.providerId && opts.providerId !== view.providerId) {
      const regimeFlipped = isGcj02Provider(view.providerId) !== isGcj02Provider(opts.providerId);
      ctx.basemap.swapProvider(opts.providerId);
      if (regimeFlipped) {
        ctx.track.rebuildTrack();
        ctx.mission.rebuildMissionOverlays();
      }
    }

    // 遥测换源（换日志/换位置源）：重建轨迹缓存与任务覆盖层。
    const playback = usePlaybackStore();
    const origin = playback.telemetry.meta.geoOrigin;
    const telemetryKey = playback.telemetry.samples.length + '|' + (origin ? origin.lat0 + ',' + origin.lng0 : 'none');
    if (telemetryKey !== ledger.telemetryKey) {
      ledger.telemetryKey = telemetryKey;
      ctx.track.rebuildTrack();
      ctx.mission.rebuildMissionOverlays();
    }

    // 任务命令懒加载：2D 激活才拉取；条目数或生效版本变化 → 重建航点与航线。
    const commandStore = useCommandsStore();
    if (commandStore.commands.loaded) ledger.commandFetchAsked = false;
    else if (!ledger.commandFetchAsked) {
      ledger.commandFetchAsked = true;
      commandStore.loadCommands().catch(() => { /* 拉取失败静默：loaded 保持 false，之后可重试 */ });
    }
    if (commandStore.commands.items.length !== ledger.commandCount) {
      ledger.commandCount = commandStore.commands.items.length;
      ctx.mission.rebuildMissionOverlays();
    }
    const activeVersion = commandStore.commands.loaded
      ? useView3dStore().missionVersionAt(playback.playback.timeMs || 0)
      : null;
    const missionKey = (commandStore.commands.loaded ? '1' : '0') + '|' + (activeVersion ? activeVersion.startTime : -1);
    if (missionKey !== ledger.missionKey) {
      ledger.missionKey = missionKey;
      ctx.mission.rebuildMissionOverlays();
    }

    // 覆盖层显隐开关：账本与当前值不同才挂/摘对应图层。
    if (opts.showPath !== ledger.showTravel) {
      ledger.showTravel = opts.showPath;
      if (opts.showPath) view.travelLine.addTo(view.map);
      else view.map.removeLayer(view.travelLine);
    }
    if (opts.showWaypoints !== ledger.showPins) {
      ledger.showPins = opts.showWaypoints;
      if (opts.showWaypoints) view.pinGroup.addTo(view.map);
      else view.map.removeLayer(view.pinGroup);
    }
    if (opts.showRoute !== ledger.showPlan) {
      ledger.showPlan = opts.showRoute;
      if (opts.showRoute) view.planLine.addTo(view.map);
      else view.map.removeLayer(view.planLine);
    }

    ctx.track.advanceTrack();
  }

  // 销毁 2D 地图（渲染器互斥：切走即销毁，切回 mount 从头重建；复 activate 边沿失忆数据键）。
  function teardownMap2d(): void {
    const view = runtime.mapView;
    if (!view) return;
    view.map.remove();
    runtime.mapView = null;
    ledger.live = false;
    ctx.track.resetTrack();
  }

  return { reconcileMap2d, teardownMap2d };
}
