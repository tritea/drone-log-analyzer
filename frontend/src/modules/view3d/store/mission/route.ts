import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import { runtime } from '@/modules/shared/runtime';
import { showToast, useUiStore } from '@/modules/shared/ui-store';
import { useMapStateStore } from '@/modules/shared/map-state';
import { useCommandsStore } from '@/modules/commands';
import { usePlaybackStore } from '@/modules/playback';
import { THREE_UNITS_PER_METER } from '@/constants';
import { disposeObjectTree } from '../../utils/dispose';
import type { MissionApi, View3dStoreCtx } from '../types';

/** 参与航线/航点绘制的导航类指令（MAVLink 命令号）。 */
const NAV_COMMANDS: Record<number, number> = { 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 1, 23: 1, 24: 1, 25: 1, 80: 1, 81: 1, 94: 1, 194: 1 };

/** 相对高度 frame（MAV_FRAME：3=Relative,6=GlobalRelative,10/11=Terrain 系）。 */
function isRelativeFrame(frame: number): boolean {
  return frame === 3 || frame === 6 || frame === 10 || frame === 11;
}

export function createMissionRoute(ctx: View3dStoreCtx): MissionApi {
  const st = ctx.state;

  async function toggleMissionRoute(): Promise<void> {
    const m = useMapStateStore().map;
    m.showRoute = !m.showRoute;
    await ensureMissionOverlay();
  }

  async function toggleWaypoints(): Promise<void> {
    const m = useMapStateStore().map;
    m.showWaypoints = !m.showWaypoints;
    await ensureMissionOverlay();
  }

  async function ensureMissionOverlay(): Promise<void> {
    if (useUiStore().ui.mainView === 'three') {
      ctx.mainView.ensureView3d();
      if (!useCommandsStore().commands.loaded) {
        try { await useCommandsStore().loadCommands(); } catch { /* 缺命令表不阻断 */ }
      }
    }
    void refreshMissionOverlay();
  }

  // 指令序列 → 任务版本切分：序号回退(重上传)即新版本。供 3D/2D/earth 三端共用的 active 版本判定。
  function rebuildMissionVersions(): void {
    const cmdStore = useCommandsStore();
    const versions: { startTime: number; points: any[] }[] = [];
    const sorted = cmdStore.commands.items.slice().sort(function (a, b) {
      if ((a.timeMs || 0) !== (b.timeMs || 0)) return (a.timeMs || 0) - (b.timeMs || 0);
      return (a.sequence || 0) - (b.sequence || 0);
    });
    let cur: { startTime: number; points: any[] } | null = null;
    let prevSeq = -1;
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      if (!c) continue;
      const seq = c.sequence || 0;
      if (!cur || seq <= prevSeq) {
        cur = { startTime: c.timeMs || 0, points: [] };
        versions.push(cur);
      }
      cur.points.push(c);
      prevSeq = seq;
    }
    st.value.mission.versions = versions;
  }

  // 当前播放时刻生效的任务版本（startTime ≤ t 的最后一个；无版本返回 null）。
  function missionVersionAt(timeMs: number): { startTime: number; points: any[] } | null {
    const versions = st.value.mission.versions;
    if (!versions || !versions.length) return null;
    let active = versions[0];
    for (let i = 0; i < versions.length; i++) {
      if ((versions[i].startTime || 0) <= (timeMs || 0)) active = versions[i];
      else break;
    }
    return active;
  }

  // home 坐标有效性：tlog 开局 GPS 未定位时下发的 seq=0 home 常为 (0,0,0)（且解析侧按 seq
  // 去重首见优先，之后重发的有效 home 不会覆盖）。这种 home 若直接采用，航点局部坐标会算出
  // 数百万米外，航线虚线横穿场景并与地面共面 z-fighting 闪烁（撕裂感的根源）。
  function hasValidHomeCoords(p: any): boolean {
    return isFinite(p.latitude) && isFinite(p.longitude) && (p.latitude !== 0 || p.longitude !== 0);
  }

  // 活动版本的 home 指令（seq=0，坐标须有效）；无有效 home 则回退 geoOrigin。
  function findHomePoint(active: { points: any[] }): any | null {
    for (let h = 0; h < active.points.length; h++) {
      const p = active.points[h];
      if (p && p.sequence === 0 && hasValidHomeCoords(p)) return p;
    }
    return null;
  }

  // 任务点 → 3D 场景坐标（东北上局部系，米×场景比例）。RTL(20) 返航不是正常航点：
  // 坐标恒取 home（航线直接连回 home），不编号不画标记；RTL 高度同样回 home
  // （altitude 未填(0)时 aboveHome=0，绝对 frame 按原换算会得 -home 海拔，场景 y 入地）。
  function missionScenePoints(origin: { lat0: number; lng0: number; alt0: number; cosLat: number }): any[] | null {
    if (!origin) return null;
    const cmdStore = useCommandsStore();
    if (cmdStore.commands.items && cmdStore.commands.items.length && !st.value.mission.versions) {
      rebuildMissionVersions();
    }
    const active = missionVersionAt(usePlaybackStore().playback.timeMs || 0);
    if (!active || !active.points) return null;

    const home = findHomePoint(active);
    const homeLat = home ? home.latitude : origin.lat0;
    const homeLng = home ? home.longitude : origin.lng0;
    const homeAltRef = home
      ? (isRelativeFrame(home.frame) ? origin.alt0 : (home.altitude || 0))
      : origin.alt0;

    const pts: any[] = [];
    for (let i = 0; i < active.points.length; i++) {
      const c = active.points[i];
      if (!c || !NAV_COMMANDS[c.command]) continue;
      const hasCoords = isFinite(c.latitude) && isFinite(c.longitude) &&
        (c.latitude !== 0 || c.longitude !== 0);
      const isRTL = c.command === 20;
      const lat = isRTL ? homeLat : (hasCoords ? c.latitude : homeLat);
      const lng = isRTL ? homeLng : (hasCoords ? c.longitude : homeLng);
      const north = (lat - origin.lat0) * 110540;
      const east = (lng - origin.lng0) * origin.cosLat * 111320;
      const x = east * THREE_UNITS_PER_METER;
      const z = -north * THREE_UNITS_PER_METER;
      const aboveHome = isRTL && !c.altitude
        ? 0
        : isRelativeFrame(c.frame)
          ? (c.altitude || 0)
          : ((c.altitude || 0) - homeAltRef);
      const y = aboveHome * THREE_UNITS_PER_METER;
      pts.push({
        x: x, y: y, z: z,
        seq: c.sequence,
        isTakeoff: c.command === 22,
        isHome: c.sequence === 0,
        isRTL: isRTL,
        name: c.commandName
      });
    }
    labelMissionPoints(pts);
    return pts.length ? pts : null;
  }

  // 任务点 → 经纬度（供 2D 地图/earth 航点叠加）。RTL/高度语义与 missionScenePoints 一致。
  function missionGeoPoints(): { lat: number; lng: number; label: string; isHome: boolean; isTakeoff: boolean; isRTL: boolean; alt: number }[] | null {
    const cmdStore = useCommandsStore();
    if (cmdStore.commands.items && cmdStore.commands.items.length && !st.value.mission.versions) {
      rebuildMissionVersions();
    }
    const active = missionVersionAt(usePlaybackStore().playback.timeMs || 0);
    if (!active || !active.points) return null;

    const home: any = findHomePoint(active);
    // home 缺失时回退 geoOrigin（与 missionScenePoints 一致），不再落到 (0,0)。
    const origin = usePlaybackStore().telemetry.meta.geoOrigin;
    const homeLat = home ? home.latitude : (origin?.lat0 ?? 0);
    const homeLng = home ? home.longitude : (origin?.lng0 ?? 0);
    const originAlt0 = origin?.alt0 ?? 0;
    const homeAltRef = home
      ? (isRelativeFrame(home.frame) ? originAlt0 : (home.altitude || 0))
      : originAlt0;

    const pts: any[] = [];
    for (let i = 0; i < active.points.length; i++) {
      const c = active.points[i];
      if (!c || !NAV_COMMANDS[c.command]) continue;
      const hasCoords = isFinite(c.latitude) && isFinite(c.longitude) && (c.latitude !== 0 || c.longitude !== 0);
      const isRTL = c.command === 20;
      const aboveHome = isRTL && !c.altitude
        ? 0
        : isRelativeFrame(c.frame)
          ? (c.altitude || 0)
          : ((c.altitude || 0) - homeAltRef);
      pts.push({
        lat: isRTL ? homeLat : (hasCoords ? c.latitude : homeLat),
        lng: isRTL ? homeLng : (hasCoords ? c.longitude : homeLng),
        isTakeoff: c.command === 22,
        isHome: c.sequence === 0,
        isRTL: isRTL,
        alt: aboveHome,
      });
    }
    labelMissionPoints(pts);
    return pts;
  }

  // 编号约定：home=H、起飞=T、RTL 只连线不占编号，其余按序编号。
  // 消费方按 !label 跳过标记（2D 地图既有约定）。
  function labelMissionPoints(pts: any[]): void {
    let wpNo = 0;
    for (let k = 0; k < pts.length; k++) {
      if (pts[k].isHome) {
        pts[k].label = 'H';
      } else if (pts[k].isTakeoff) {
        pts[k].label = 'T';
      } else if (pts[k].isRTL) {
        pts[k].label = '';
      } else {
        wpNo++;
        pts[k].label = String(wpNo);
      }
    }
  }

  // 刷新 3D 场景内的航线/航点组：版本变化才重建（activeKey 去重），开关只切 visible。
  async function refreshMissionOverlay(): Promise<void> {
    const tv = runtime.view3dMain;
    if (!tv) return;
    const map = useMapStateStore().map;
    const wantAny = map.showRoute || map.showWaypoints;
    const timeMs = usePlaybackStore().playback.timeMs || 0;
    const cmdStore = useCommandsStore();

    if (cmdStore.commands.items && cmdStore.commands.items.length && !st.value.mission.versions) {
      rebuildMissionVersions();
    }
    const active = missionVersionAt(timeMs);
    const activeKey = active ? active.startTime : -1;

    if (!tv.mission) tv.mission = {};
    if (wantAny && tv.mission.lineGroup && tv.mission.activeKey === activeKey) {
      return;
    }
    tv.mission.activeKey = activeKey;

    if (tv.mission.lineGroup) {
      tv.scene.remove(tv.mission.lineGroup);
      disposeObjectTree(tv.mission.lineGroup, true);
      tv.mission.lineGroup = null;
    }
    if (tv.mission.markerGroup) {
      tv.scene.remove(tv.mission.markerGroup);
      disposeObjectTree(tv.mission.markerGroup, true);
      tv.mission.markerGroup = null;
    }
    if (!wantAny) return;
    if (!cmdStore.commands.loaded) {
      try { await cmdStore.loadCommands(); } catch { /* 缺命令表不阻断 */ }
      void refreshMissionOverlay();
      return;
    }

    const origin = usePlaybackStore().telemetry.meta && usePlaybackStore().telemetry.meta.geoOrigin;
    if (!origin) {
      showToast('当前轨迹非 GPS 经纬度，无法叠加航线与航点', 'info');
      map.showRoute = false;
      map.showWaypoints = false;
      return;
    }
    if (!active || !active.points) return;

    const pts = missionScenePoints(origin);
    if (!pts || !pts.length) return;

    const lineGroup = new THREE.Group();
    if (pts.length >= 2) {
      const posArr: number[] = [];
      for (let p = 0; p < pts.length; p++) posArr.push(pts[p].x, pts[p].y, pts[p].z);
      const lineGeom = new THREE.BufferGeometry();
      lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
      const lineMat = new THREE.LineDashedMaterial({
        color: 0xea580c, dashSize: 1.6, gapSize: 1.0, linewidth: 2,
        transparent: true, opacity: 0.7, depthWrite: false
      });
      const line = new THREE.Line(lineGeom, lineMat);
      line.computeLineDistances();
      lineGroup.add(line);
    }
    lineGroup.visible = map.showRoute;
    tv.mission.lineGroup = lineGroup;
    tv.scene.add(lineGroup);

    const markerGroup = new THREE.Group();
    const WP_R = 0.5, HOME_R = 0.8;
    const coreGeom = new THREE.SphereGeometry(WP_R, 16, 16);
    const homeCoreGeom = new THREE.SphereGeometry(HOME_R, 18, 18);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xea580c, transparent: true, opacity: 0.92, depthWrite: false });
    const homeCoreMat = new THREE.MeshBasicMaterial({ color: 0x16a34a, transparent: true, opacity: 0.92, depthWrite: false });
    const outGeom = new THREE.SphereGeometry(WP_R * 1.32, 16, 16);
    const homeOutGeom = new THREE.SphereGeometry(HOME_R * 1.26, 18, 18);
    const outMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.BackSide, depthWrite: false });
    const haloGeom = new THREE.RingGeometry(WP_R * 1.15, WP_R * 1.95, 28);
    const homeHaloGeom = new THREE.RingGeometry(HOME_R * 1.1, HOME_R * 1.8, 32);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xea580c, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
    const homeHaloMat = new THREE.MeshBasicMaterial({ color: 0x16a34a, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
    const GROUND_Y = 0;
    for (let n = 0; n < pts.length; n++) {
      const pt = pts[n];
      if (!pt.label) continue; // RTL 等无 label 点只参与连线，不画标记/编号
      const isHome = pt.seq === 0;
      const r = isHome ? HOME_R : WP_R;
      const core = new THREE.Mesh(isHome ? homeCoreGeom : coreGeom, isHome ? homeCoreMat : coreMat);
      core.position.set(pt.x, pt.y, pt.z);
      markerGroup.add(core);
      const outline = new THREE.Mesh(isHome ? homeOutGeom : outGeom, outMat);
      outline.position.set(pt.x, pt.y, pt.z);
      markerGroup.add(outline);
      const halo = new THREE.Mesh(isHome ? homeHaloGeom : haloGeom, isHome ? homeHaloMat : haloMat);
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(pt.x, GROUND_Y, pt.z);
      markerGroup.add(halo);
      const labelSprite = new SpriteText(pt.label, isHome ? 0.62 : 0.52);
      labelSprite.position.set(pt.x, pt.y + r + 0.35, pt.z);
      markerGroup.add(labelSprite);
    }
    markerGroup.visible = map.showWaypoints;
    tv.mission.markerGroup = markerGroup;
    tv.scene.add(markerGroup);
  }

  return {
    rebuildMissionVersions, missionVersionAt, missionGeoPoints,
    refreshMissionOverlay, toggleMissionRoute, toggleWaypoints, ensureMissionOverlay,
  };
}
