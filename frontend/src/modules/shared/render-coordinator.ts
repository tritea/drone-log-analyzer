
export interface RenderSubscriber {
  name: string;
  tick: (nowMs: number) => void;
  fps: number; 
  priority?: number; 
}

interface SubscriberState extends RenderSubscriber {
  lastTickMs: number;
}

let rafId = 0;
let running = false;
const subscribers = new Map<string, SubscriberState>();

function frame(nowMs: number): void {
  if (!running) return;
  const due = [...subscribers.values()]
    .filter((s) => s.fps <= 0 || nowMs - s.lastTickMs >= 1000 / s.fps)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  for (const s of due) {
    s.tick(nowMs);
    s.lastTickMs = nowMs;
  }
  rafId = requestAnimationFrame(frame);
}

export function registerRenderSubscriber(sub: RenderSubscriber): () => void {
  subscribers.set(sub.name, { ...sub, lastTickMs: 0 });
  if (!running) {
    running = true;
    rafId = requestAnimationFrame(frame);
  }
  return () => {
    subscribers.delete(sub.name);
    if (subscribers.size === 0 && running) {
      running = false;
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };
}

export function hasRenderSubscriber(name: string): boolean {
  return subscribers.has(name);
}
