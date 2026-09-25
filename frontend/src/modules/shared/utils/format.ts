
export function tryFloat(s: unknown, fb: number): number {
  const v = parseFloat(typeof s === 'string' ? s : String(s));
  return isNaN(v) ? fb : v;
}

export function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / Math.pow(1024, unitIndex);
  return scaled.toFixed(scaled >= 100 ? 0 : 1) + ' ' + units[unitIndex];
}

/** 取路径末段文件名并去掉 .glb/.gltf/.obj 扩展名，用于模型/瓦片展示名。 */
export function fileBaseName(path: string): string {
  const fileName = path.split(/[\\/]/).pop() || path;
  return fileName.replace(/\.(glb|gltf|obj)$/i, '');
}

/** 从 input/change 事件取数字，解析失败回退 0。 */
export function numFromEvent(e: Event): number {
  return parseFloat((e.target as HTMLInputElement).value) || 0;
}
