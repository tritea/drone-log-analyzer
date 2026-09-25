import type { logservice } from './types';

export interface LogClient {
  load(req: logservice.LoadRequest): Promise<logservice.SummaryResponse>;
  status(): Promise<logservice.StatusResponse>;
  summary(): Promise<logservice.SummaryResponse>;
  messageTypes(): Promise<logservice.TypeInfo[]>;
  fields(req: logservice.FieldsRequest): Promise<logservice.FieldInfo[]>;
  typeSchema(): Promise<Record<string, any>>;
  curveData(req: logservice.CurveDataRequest): Promise<ArrayBuffer>;
  typeBody(req: logservice.TypeBodyRequest): Promise<ArrayBuffer>;
  parameters(): Promise<logservice.Parameter[]>;
  commands(): Promise<logservice.CommandEntry[]>;
  mavlinkCommands(): Promise<logservice.MAVLinkCommandEntry[]>;
  modeChanges(): Promise<logservice.ModeEntry[]>;
  messages(): Promise<logservice.MessageEntry[]>;
  errors(): Promise<logservice.ErrorEntry[]>;
  events(): Promise<logservice.EventEntry[]>;
  browse(req: logservice.BrowseRequest): Promise<logservice.BrowseResponse>;
  logDefs(): Promise<logservice.LogDefsResponse>;
}

export interface HostClient {
  pickLogPath(): Promise<string>;
  importModel(copy: boolean): Promise<string>;
  importModels(copy: boolean): Promise<string[]>;
  importTileset(copy: boolean): Promise<string>;
}
