
export interface LogLoadContext {
  logId: string; 
  hasAttitude: boolean;
  hasPosition: boolean;
}

export type LogLoadHook = (ctx: LogLoadContext) => void;

const hooks = new Map<string, LogLoadHook>();

export function registerLogLoadHook(name: string, hook: LogLoadHook): () => void {
  hooks.set(name, hook);
  return () => {
    hooks.delete(name);
  };
}

export function runLogLoadHooks(ctx: LogLoadContext): void {
  for (const hook of hooks.values()) {
    hook(ctx);
  }
}
