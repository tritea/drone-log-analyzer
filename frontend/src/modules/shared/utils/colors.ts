const COLORS: string[] = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#ec4899','#84cc16','#f97316','#6366f1',
  '#14b8a6','#e11d48','#0ea5e9','#d946ef','#22c55e'
];
let colorIdx = 0;

export function nextColor(): string {
  return COLORS[colorIdx++ % COLORS.length];
}
