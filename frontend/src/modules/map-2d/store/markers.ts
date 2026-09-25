import * as L from 'leaflet';

/* 地图标记图标：机头箭头（SVG 随 yaw 旋转，见 track 域）与航点圆点（home/导航双色）。
 * className 是 Map2dView.vue 全局样式的锚点，改名须同步样式。 */

/** 无人机标记：红色机头三角，SVG 内联初始 rotate(0deg)，推进时改 transform。 */
export const aircraftMarkerIcon = L.divIcon({
  className: 'map-drone-icon',
  html: '<svg viewBox="0 0 24 24" width="26" height="26" style="transform:rotate(0deg);transform-origin:12px 12px">'
    + '<path d="M12 2 L20 20 Q12 15.5 4 20 Z" fill="#dc2626" stroke="#ffffff" stroke-width="1.2"/></svg>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

/** 航点圆点：home 墨绿、导航紫，白描边圆点内嵌序号。 */
export function waypointPinIcon(label: string, isHome: boolean): L.DivIcon {
  return L.divIcon({
    className: 'map-waypoint-icon',
    html: '<div class="map-waypoint ' + (isHome ? 'map-waypoint-home' : 'map-waypoint-nav') + '">' + label + '</div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}
