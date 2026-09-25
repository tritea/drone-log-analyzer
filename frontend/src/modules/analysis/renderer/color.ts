import * as THREE from 'three';

/** css 颜色串 → THREE.Color + 不透明度（支持 rgba() 形式）。 */
export function parseColor(s: string): { color: THREE.Color; opacity: number } {
  const c = new THREE.Color();
  let opacity = 1;
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(',').map(function (p) { return parseFloat(p.trim()); });
    c.setRGB((parts[0] || 0) / 255, (parts[1] || 0) / 255, (parts[2] || 0) / 255);
    if (parts[3] !== undefined) opacity = parts[3];
  } else {
    try { c.setStyle(s); } catch (e) { void e; c.set('#3b82f6'); }
  }
  return { color: c, opacity: opacity };
}
