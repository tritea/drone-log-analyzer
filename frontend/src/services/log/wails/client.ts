import * as hostAPI from '@/wailsjs/go/wails/HostAPI';
import * as logAPI from '@/wailsjs/go/wails/LogAPI';
import type { HostClient, LogClient } from '../client';

function toBuffer(bytes: number[] | Uint8Array | ArrayBuffer | string): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes;
  if (bytes instanceof Uint8Array) return bytes.buffer as ArrayBuffer;
  if (typeof bytes === 'string') {
    const bin = atob(bytes);
    const buf = new ArrayBuffer(bin.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
    return buf;
  }
  return new Uint8Array(bytes).buffer as ArrayBuffer;
}

export const wailsLogClient: LogClient = {
  load: (req) => logAPI.Load(req),
  status: () => logAPI.Status(),
  summary: () => logAPI.Summary(),
  messageTypes: () => logAPI.MessageTypes(),
  fields: (req) => logAPI.Fields(req),
  typeSchema: () => logAPI.TypeSchema(),
  curveData: async (req) => toBuffer(await logAPI.CurveData(req)),
  typeBody: async (req) => toBuffer(await logAPI.TypeBody(req)),
  parameters: () => logAPI.Parameters(),
  commands: () => logAPI.Commands(),
  mavlinkCommands: () => logAPI.MAVLinkCommands(),
  modeChanges: () => logAPI.ModeChanges(),
  messages: () => logAPI.Messages(),
  errors: () => logAPI.Errors(),
  events: () => logAPI.Events(),
  browse: (req) => logAPI.Browse(req),
  logDefs: () => logAPI.LogDefs(),
};

export const wailsHostClient: HostClient = {
  pickLogPath: () => hostAPI.PickLogPath(),
  importModel: (copy: boolean) => hostAPI.ImportModel(copy),
  importModels: (copy: boolean) => hostAPI.ImportModels(copy),
  importTileset: (copy: boolean) => hostAPI.ImportTileset(copy),
};
