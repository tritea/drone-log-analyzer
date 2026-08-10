export interface ConfigClient {
  getSettings(): Promise<any>;
  saveSettings(settings: any): Promise<void>;
  setFormat(format: string): Promise<void>;
  getFlightMetrics(): Promise<any>;
  saveFlightMetrics(metrics: any): Promise<void>;
  getCurveState(): Promise<any>;
  saveCurveState(activeCurves: any[]): Promise<void>;
  listFieldEntries(): Promise<any>;
  saveFieldEntry(tmpl: any): Promise<any>;
  deleteFieldEntry(name: string): Promise<any>;
  listCustomModels(): Promise<any>;
  saveCustomModel(model: any): Promise<any>;
  deleteCustomModel(name: string): Promise<any>;
  listModelGroups(): Promise<any>;
  saveModelGroup(group: any): Promise<any>;
  deleteModelGroup(name: string): Promise<any>;
  listTilesets(): Promise<any>;
  saveTileset(t: any): Promise<any>;
  deleteTileset(name: string): Promise<any>;
}
