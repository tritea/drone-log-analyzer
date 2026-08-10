import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as L from 'leaflet';
import type { TelemetrySample } from '@/types';
import { runtime } from '@/modules/shared/runtime';
import type { TemplateRefTarget } from '@/modules/shared/utils/dom';
import { wgs84ToGcj02 } from '@/modules/shared/utils/geo/gcj02';
import { useUiStore } from '@/modules/shared/ui-store';
import { useScene3dStore } from '@/modules/scene-3d';
import { useCommandsStore } from '@/modules/commands';
import { useMapStateStore } from '@/modules/shared/map-state';
import { TRAJ_MAX_POINTS, TRAJ_CLOSE_METERS } from '@/constants';

let latLngCache: L.LatLng[] = [];        
let decimCache: L.LatLng[] = [];         
let decimOrigIdx: number[] = [];         
let lastDrawK0 = -1;                     
let lastDrawK1 = -1;                     
let lastFullTraj = false;                
let lastActive = false;
let lastProvider = '';
let lastTeleKey = '';
let lastCmdLen = -1;
let lastMissionKey = '';
let lastShowPath = true;
let lastShowWaypoints = true;
let lastShowRoute = true;
let lastTimeMs = -1;
let cmdRequested = false;

const droneIcon = L.divIcon({
  className: 'map-drone-icon',
  html: '<svg viewBox="0 0 24 24" width="26" height="26" style="transform:rotate(0deg);transform-origin:12px 12px">'
    + '<path d="M12 2 L20 20 Q12 15.5 4 20 Z" fill="#dc2626" stroke="#ffffff" stroke-width="1.2"/></svg>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

function wpIcon(label: string, isHome: boolean): L.DivIcon {
  return L.divIcon({
    className: 'map-waypoint-icon',
    html: '<div class="map-waypoint ' + (isHome ? 'map-waypoint-home' : 'map-waypoint-nav') + '">' + label + '</div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function sampleLatLng(sample: TelemetrySample, o: { lat0: number; lng0: number; cosLat: number }): L.LatLng {
  return L.latLng(o.lat0 + sample.north / 110540, o.lng0 + sample.east / (o.cosLat * 111320));
}

function latLngMeterDist2(a: L.LatLng, b: L.LatLng): number {
  const y = (a.lat - b.lat) * 111320;
  const x = (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  return x * x + y * y;
}

function decimateLatLngsByDistance(points: L.LatLng[], meters: number): { pts: L.LatLng[]; origIdx: number[] } {
  const n = points.length;
  const pts: L.LatLng[] = [];
  const origIdx: number[] = [];
  if (!n) return { pts, origIdx };
  pts.push(points[0]); origIdx.push(0);
  const tol2 = meters * meters;
  let last = points[0];
  for (let i = 1; i < n; i++) {
    if (latLngMeterDist2(last, points[i]) >= tol2) { pts.push(points[i]); origIdx.push(i); last = points[i]; }
  }
  if (origIdx[origIdx.length - 1] !== n - 1) { pts.push(points[n - 1]); origIdx.push(n - 1); }
  return { pts, origIdx };
}

function lowerBoundGe(arr: number[], v: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
  return lo;
}
function upperBoundLe(arr: number[], v: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= v) lo = mid + 1; else hi = mid; }
  return lo;
}

export const useMap2dStore = defineStore('map-2d', () => {
  const mapMainEl = ref<HTMLElement | null>(null);

  function registerMapMain(el: TemplateRefTarget): void {
    mapMainEl.value = el instanceof HTMLElement ? el : null;
  }

  function makeTileLayer(providerId: string): L.TileLayer {
    const ms = useMapStateStore();
    const layer = L.tileLayer('/map/provider/' + providerId + '/{z}/{x}/{y}', {
      maxZoom: 21,
      maxNativeZoom: 18,
      attribution: ms.currentAttribution(),
    });
    layer.on('tileerror', () => { ms.map.tileError = true });
    layer.on('tileload', () => { if (ms.map.tileError) ms.map.tileError = false });
    return layer;
  }

  function ensureMap(): void {
    if (runtime.mapView) return;
    const el = mapMainEl.value;
    if (!el) return;
    const ms = useMapStateStore();
    const m = L.map(el, { center: [30, 120], zoom: 13, zoomControl: true, zoomAnimation: false, preferCanvas: true, attributionControl: true });
    m.attributionControl.setPrefix(false);

    const providerId = ms.map.providerId || 'amap_vector';
    const tileLayer = makeTileLayer(providerId);
    tileLayer.addTo(m);
    const traveledPoly = L.polyline([], { color: '#2563eb', weight: 2, opacity: 0.9, lineJoin: 'round' }).addTo(m);
    const waypointLayer = L.layerGroup();
    if (ms.map.showWaypoints) waypointLayer.addTo(m);
    const wpLine = L.polyline([], { color: '#ea580c', weight: 2, opacity: 0.8, dashArray: '6,4', lineJoin: 'round' });
    if (ms.map.showRoute) wpLine.addTo(m);
    const droneMarker = L.marker([30, 120], { icon: droneIcon, zIndexOffset: 1000 }).addTo(m);
    runtime.mapView = {
      map: m, tileLayer, traveledPoly, droneMarker, waypointLayer, wpLine,
      raf: 0, providerId, samplesKey: '',
    };
  }

  function swapTileLayer(providerId: string): void {
    const tv = runtime.mapView;
    if (!tv || tv.providerId === providerId) return;
    tv.map.removeLayer(tv.tileLayer);
    tv.tileLayer = makeTileLayer(providerId);
    tv.tileLayer.addTo(tv.map);
    tv.providerId = providerId;
  }

  function rebuildPath(): void {
    const tv = runtime.mapView;
    if (!tv) return;
    const ms = useMapStateStore();
    const three = useScene3dStore();
    const samples = three.three.telemetry.samples;
    const origin = three.three.telemetry.meta.geoOrigin;
    if (!samples.length || !origin) {
      latLngCache = [];
      decimCache = []; decimOrigIdx = [];
      lastDrawK0 = -1; lastDrawK1 = -1;
      tv.traveledPoly.setLatLngs([]);
      return;
    }
    const gcj = ms.mapCoordNeedsGcj02();
    latLngCache = samples.map((s) => {
      const ll = sampleLatLng(s, origin);
      if (!gcj) return ll;
      const c = wgs84ToGcj02(ll.lat, ll.lng);
      return L.latLng(c[0], c[1]);
    });
    if (latLngCache.length > 1) tv.map.fitBounds(L.latLngBounds(latLngCache).pad(0.15));
    const r = decimateLatLngsByDistance(latLngCache, TRAJ_CLOSE_METERS);
    decimCache = r.pts;
    decimOrigIdx = r.origIdx;
    lastDrawK0 = -1; lastDrawK1 = -1;
    lastTimeMs = -1;
  }

  function rebuildWaypoints(): void {
    const tv = runtime.mapView;
    if (!tv) return;
    const ms = useMapStateStore();
    tv.waypointLayer.clearLayers();
    const pts = useScene3dStore().missionLatLngPoints();
    if (!pts || !pts.length) {
      tv.wpLine.setLatLngs([]);
      return;
    }
    const gcj = ms.mapCoordNeedsGcj02();
    const lineLatLngs: L.LatLng[] = [];
    for (const p of pts) {
      const c = gcj ? wgs84ToGcj02(p.lat, p.lng) : [p.lat, p.lng];
      lineLatLngs.push(L.latLng(c[0], c[1]));
      if (!p.label) continue;
      L.marker([c[0], c[1]], { icon: wpIcon(p.label, p.isHome) }).addTo(tv.waypointLayer);
    }
    tv.wpLine.setLatLngs(lineLatLngs);
  }

  function updateLive(): void {
    const tv = runtime.mapView;
    if (!tv) return;
    const three = useScene3dStore();
    const samples = three.three.telemetry.samples;
    const origin = three.three.telemetry.meta.geoOrigin;
    const timeMs = three.three.playback.timeMs;
    const fullTraj = three.three.view.fullTrajectory;
    if (!samples.length || !origin || !latLngCache.length) return;
    if (timeMs === lastTimeMs && fullTraj === lastFullTraj) return;
    lastTimeMs = timeMs;
    lastFullTraj = fullTraj;
    const idx = three.currentThreeSampleIndex(timeMs);
    if (fullTraj) {
      tv.traveledPoly.setLatLngs(latLngCache.slice(0, Math.max(1, idx + 1)));
      lastDrawK0 = -1; lastDrawK1 = -1;
    } else {
      const lo = Math.max(0, idx + 1 - TRAJ_MAX_POINTS);
      const k1 = upperBoundLe(decimOrigIdx, idx);
      const k0 = lowerBoundGe(decimOrigIdx, lo);
      if (k0 !== lastDrawK0 || k1 !== lastDrawK1) {
        lastDrawK0 = k0; lastDrawK1 = k1;
        tv.traveledPoly.setLatLngs(k1 > k0 ? decimCache.slice(k0, k1) : []);
      }
    }
    const sample = three.sampleAtTime(timeMs) || samples[idx];
    tv.droneMarker.setLatLng(latLngCache[idx])

    const el = tv.droneMarker.getElement();
    const svg = el && (el.firstChild as HTMLElement | null);
    if (svg) svg.style.transform = 'rotate(' + (sample.yaw || 0) + 'deg)';
  }

  function focusDrone(): void {
    const tv = runtime.mapView;
    if (!tv) return;
    const three = useScene3dStore();
    const samples = three.three.telemetry.samples;
    const origin = three.three.telemetry.meta.geoOrigin;
    if (!samples.length || !origin || !latLngCache.length) return;
    const idx = three.currentThreeSampleIndex(three.three.playback.timeMs);
    const ll = latLngCache[idx];
    if (!ll) return;
    tv.map.setView(ll, Math.max(tv.map.getZoom(), 16));
  }

  function renderMap2d(): void {
    const uiStore = useUiStore();
    const ms = useMapStateStore();
    const three = useScene3dStore();
    const cmdStore = useCommandsStore();
    const active = uiStore.ui.mainView === 'three' && ms.map.active;
    if (!active) { lastActive = false; return; }
    if (!lastActive) {
      lastActive = true;
      ensureMap();
      if (runtime.mapView) runtime.mapView.map.invalidateSize();
      lastTeleKey = '';
      lastCmdLen = -1;
      lastMissionKey = '';
    }
    const tv = runtime.mapView;
    if (!tv) return;
    if (ms.map.providerId && ms.map.providerId !== tv.providerId) {
      const prevGcj = tv.providerId ? tv.providerId.indexOf('amap') === 0 : false;
      const newGcj = ms.map.providerId.indexOf('amap') === 0;
      swapTileLayer(ms.map.providerId);
      if (prevGcj !== newGcj) {
        rebuildPath();
        rebuildWaypoints();
      }
    }
    const o = three.three.telemetry.meta.geoOrigin;
    const teleKey = three.three.telemetry.samples.length + '|' + (o ? o.lat0 + ',' + o.lng0 : 'none');
    if (teleKey !== lastTeleKey) {
      lastTeleKey = teleKey;
      rebuildPath();
      rebuildWaypoints();
      lastTimeMs = -1;
    }
    if (cmdStore.commands.loaded) {
      cmdRequested = false;
    } else if (!cmdRequested) {
      cmdRequested = true;
      cmdStore.loadCommands().catch(() => {  });
    }
    const cmdLen = cmdStore.commands.items.length;
    if (cmdLen !== lastCmdLen) {
      lastCmdLen = cmdLen;
      rebuildWaypoints();
    }
    const missionLoaded = cmdStore.commands.loaded;
    const activeMission = missionLoaded ? three.activeMissionVersionAt(three.three.playback.timeMs || 0) : null;
    const missionKey = (missionLoaded ? '1' : '0') + '|' + (activeMission ? activeMission.startTime : -1);
    if (missionKey !== lastMissionKey) {
      lastMissionKey = missionKey;
      rebuildWaypoints();
    }
    if (ms.map.showPath !== lastShowPath) {
      lastShowPath = ms.map.showPath;
      if (lastShowPath) { tv.traveledPoly.addTo(tv.map) }
      else { tv.map.removeLayer(tv.traveledPoly) }
    }
    if (ms.map.showWaypoints !== lastShowWaypoints) {
      lastShowWaypoints = ms.map.showWaypoints;
      if (lastShowWaypoints) tv.waypointLayer.addTo(tv.map);
      else { tv.map.removeLayer(tv.waypointLayer) }
    }
    if (ms.map.showRoute !== lastShowRoute) {
      lastShowRoute = ms.map.showRoute;
      if (lastShowRoute) tv.wpLine.addTo(tv.map);
      else { tv.map.removeLayer(tv.wpLine) }
    }
    updateLive();
  }

  return {
    mapMainEl,
    registerMapMain, makeTileLayer, ensureMap, swapTileLayer,
    rebuildPath, rebuildWaypoints, updateLive, renderMap2d, focusDrone,
  };
});
