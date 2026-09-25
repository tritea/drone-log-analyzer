import { wailsHostClient, wailsLogClient } from './wails/client';

export const logClient = wailsLogClient;
export const hostClient = wailsHostClient;
export type { HostClient, LogClient } from './client';
