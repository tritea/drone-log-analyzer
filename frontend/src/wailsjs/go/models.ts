export namespace agentservice {
	
	export class RoundStats {
	    durationMs: number;
	    promptTokens?: number;
	    completionTokens?: number;
	    totalTokens?: number;
	
	    static createFrom(source: any = {}) {
	        return new RoundStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.durationMs = source["durationMs"];
	        this.promptTokens = source["promptTokens"];
	        this.completionTokens = source["completionTokens"];
	        this.totalTokens = source["totalTokens"];
	    }
	}
	export class ToolCallTrace {
	    tool: string;
	    args?: Record<string, any>;
	    summary?: string;
	    durationMs: number;
	
	    static createFrom(source: any = {}) {
	        return new ToolCallTrace(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tool = source["tool"];
	        this.args = source["args"];
	        this.summary = source["summary"];
	        this.durationMs = source["durationMs"];
	    }
	}
	export class ChatMessage {
	    role: string;
	    content: string;
	    toolTrace?: ToolCallTrace[];
	    stats?: RoundStats;
	
	    static createFrom(source: any = {}) {
	        return new ChatMessage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.role = source["role"];
	        this.content = source["content"];
	        this.toolTrace = this.convertValues(source["toolTrace"], ToolCallTrace);
	        this.stats = this.convertValues(source["stats"], RoundStats);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AgentEvent {
	    type: string;
	    text?: string;
	    tool?: string;
	    args?: Record<string, any>;
	    summary?: string;
	    durationMs?: number;
	    message?: ChatMessage;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new AgentEvent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.text = source["text"];
	        this.tool = source["tool"];
	        this.args = source["args"];
	        this.summary = source["summary"];
	        this.durationMs = source["durationMs"];
	        this.message = this.convertValues(source["message"], ChatMessage);
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ChatRequest {
	    message: string;
	    level?: string;
	
	    static createFrom(source: any = {}) {
	        return new ChatRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.message = source["message"];
	        this.level = source["level"];
	    }
	}
	export class ChatResponse {
	    message: ChatMessage;
	
	    static createFrom(source: any = {}) {
	        return new ChatResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.message = this.convertValues(source["message"], ChatMessage);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HistoryResponse {
	    messages: ChatMessage[];
	
	    static createFrom(source: any = {}) {
	        return new HistoryResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.messages = this.convertValues(source["messages"], ChatMessage);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	

}

export namespace configservice {
	
	export class CurveStateCurve {
	    type: string;
	    field: string;
	    visible: boolean;
	    color?: string;
	    scale: number;
	    offset: number;
	    scaleInput?: string;
	    offsetInput?: string;
	    templateName?: string;
	    templateGroupScale: number;
	    templateGroupOffset: number;
	    templateGroupScaleInput?: string;
	    templateGroupOffsetInput?: string;
	
	    static createFrom(source: any = {}) {
	        return new CurveStateCurve(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.field = source["field"];
	        this.visible = source["visible"];
	        this.color = source["color"];
	        this.scale = source["scale"];
	        this.offset = source["offset"];
	        this.scaleInput = source["scaleInput"];
	        this.offsetInput = source["offsetInput"];
	        this.templateName = source["templateName"];
	        this.templateGroupScale = source["templateGroupScale"];
	        this.templateGroupOffset = source["templateGroupOffset"];
	        this.templateGroupScaleInput = source["templateGroupScaleInput"];
	        this.templateGroupOffsetInput = source["templateGroupOffsetInput"];
	    }
	}
	export class CurveStateRequest {
	    activeCurves: CurveStateCurve[];
	
	    static createFrom(source: any = {}) {
	        return new CurveStateRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.activeCurves = this.convertValues(source["activeCurves"], CurveStateCurve);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CurveStateResponse {
	    activeCurves: CurveStateCurve[];
	    updatedAt: string;
	    path: string;
	
	    static createFrom(source: any = {}) {
	        return new CurveStateResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.activeCurves = this.convertValues(source["activeCurves"], CurveStateCurve);
	        this.updatedAt = source["updatedAt"];
	        this.path = source["path"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CustomModel {
	    name: string;
	    file: string;
	    lon: number;
	    lat: number;
	    alt: number;
	    yaw: number;
	    pitch: number;
	    roll: number;
	    scale: number;
	    hidden: boolean;
	    createdAt?: string;
	    updatedAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new CustomModel(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.file = source["file"];
	        this.lon = source["lon"];
	        this.lat = source["lat"];
	        this.alt = source["alt"];
	        this.yaw = source["yaw"];
	        this.pitch = source["pitch"];
	        this.roll = source["roll"];
	        this.scale = source["scale"];
	        this.hidden = source["hidden"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class CustomModelsResponse {
	    models: CustomModel[];
	    path: string;
	    savedModel?: string;
	
	    static createFrom(source: any = {}) {
	        return new CustomModelsResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.models = this.convertValues(source["models"], CustomModel);
	        this.path = source["path"];
	        this.savedModel = source["savedModel"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DeleteCustomModelRequest {
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new DeleteCustomModelRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	    }
	}
	export class DeleteFieldEntryRequest {
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new DeleteFieldEntryRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	    }
	}
	export class DeleteModelGroupRequest {
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new DeleteModelGroupRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	    }
	}
	export class DeleteTilesetRequest {
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new DeleteTilesetRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	    }
	}
	export class FieldCurve {
	    type: string;
	    field: string;
	    visible: boolean;
	    color?: string;
	    scale: number;
	    offset: number;
	    scaleInput?: string;
	    offsetInput?: string;
	
	    static createFrom(source: any = {}) {
	        return new FieldCurve(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.field = source["field"];
	        this.visible = source["visible"];
	        this.color = source["color"];
	        this.scale = source["scale"];
	        this.offset = source["offset"];
	        this.scaleInput = source["scaleInput"];
	        this.offsetInput = source["offsetInput"];
	    }
	}
	export class FieldEntry {
	    name: string;
	    curves: FieldCurve[];
	    scale: number;
	    offset: number;
	    scaleInput?: string;
	    offsetInput?: string;
	    createdAt?: string;
	    updatedAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new FieldEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.curves = this.convertValues(source["curves"], FieldCurve);
	        this.scale = source["scale"];
	        this.offset = source["offset"];
	        this.scaleInput = source["scaleInput"];
	        this.offsetInput = source["offsetInput"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FieldEntriesResponse {
	    templates: FieldEntry[];
	    path: string;
	    savedTemplate?: string;
	
	    static createFrom(source: any = {}) {
	        return new FieldEntriesResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.templates = this.convertValues(source["templates"], FieldEntry);
	        this.path = source["path"];
	        this.savedTemplate = source["savedTemplate"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class FlightMetricsResponse {
	    metrics: Record<string, any>;
	    path: string;
	
	    static createFrom(source: any = {}) {
	        return new FlightMetricsResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.metrics = source["metrics"];
	        this.path = source["path"];
	    }
	}
	export class LlmConfigResponse {
	    config?: model.LlmConfig;
	    path: string;
	
	    static createFrom(source: any = {}) {
	        return new LlmConfigResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.config = this.convertValues(source["config"], model.LlmConfig);
	        this.path = source["path"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ModelGroupTile {
	    row: number;
	    col: number;
	    file: string;
	    yaw: number;
	
	    static createFrom(source: any = {}) {
	        return new ModelGroupTile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.row = source["row"];
	        this.col = source["col"];
	        this.file = source["file"];
	        this.yaw = source["yaw"];
	    }
	}
	export class ModelGroup {
	    name: string;
	    lon: number;
	    lat: number;
	    alt: number;
	    spacing: number;
	    rows: number;
	    cols: number;
	    yaw: number;
	    scale: number;
	    hidden: boolean;
	    tiles: ModelGroupTile[];
	    createdAt?: string;
	    updatedAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new ModelGroup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.lon = source["lon"];
	        this.lat = source["lat"];
	        this.alt = source["alt"];
	        this.spacing = source["spacing"];
	        this.rows = source["rows"];
	        this.cols = source["cols"];
	        this.yaw = source["yaw"];
	        this.scale = source["scale"];
	        this.hidden = source["hidden"];
	        this.tiles = this.convertValues(source["tiles"], ModelGroupTile);
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ModelGroupsResponse {
	    groups: ModelGroup[];
	    path: string;
	    savedGroup?: string;
	
	    static createFrom(source: any = {}) {
	        return new ModelGroupsResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.groups = this.convertValues(source["groups"], ModelGroup);
	        this.path = source["path"];
	        this.savedGroup = source["savedGroup"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SettingsResponse {
	    settings: Record<string, any>;
	    path: string;
	
	    static createFrom(source: any = {}) {
	        return new SettingsResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.settings = source["settings"];
	        this.path = source["path"];
	    }
	}
	export class Tileset {
	    name: string;
	    dir: string;
	    url?: string;
	    heightOffset: number;
	    scale: number;
	    lon: number;
	    lat: number;
	    yaw: number;
	    pitch: number;
	    roll: number;
	    hidden: boolean;
	    createdAt?: string;
	    updatedAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new Tileset(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.dir = source["dir"];
	        this.url = source["url"];
	        this.heightOffset = source["heightOffset"];
	        this.scale = source["scale"];
	        this.lon = source["lon"];
	        this.lat = source["lat"];
	        this.yaw = source["yaw"];
	        this.pitch = source["pitch"];
	        this.roll = source["roll"];
	        this.hidden = source["hidden"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class TilesetsResponse {
	    tilesets: Tileset[];
	    path: string;
	    savedTileset?: string;
	
	    static createFrom(source: any = {}) {
	        return new TilesetsResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tilesets = this.convertValues(source["tilesets"], Tileset);
	        this.path = source["path"];
	        this.savedTileset = source["savedTileset"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace logservice {
	
	export class BrowseRequest {
	    type: string;
	
	    static createFrom(source: any = {}) {
	        return new BrowseRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	    }
	}
	export class BrowseResponse {
	    type: string;
	    fields: string[];
	    data: Record<string, Array<number>>;
	
	    static createFrom(source: any = {}) {
	        return new BrowseResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.fields = source["fields"];
	        this.data = source["data"];
	    }
	}
	export class CommandEntry {
	    timeMs: number;
	    commandTotal: number;
	    sequence: number;
	    command: number;
	    commandName: string;
	    param1: number;
	    param2: number;
	    param3: number;
	    param4: number;
	    latitude: number;
	    longitude: number;
	    altitude: number;
	    frame: number;
	    frameName: string;
	
	    static createFrom(source: any = {}) {
	        return new CommandEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.timeMs = source["timeMs"];
	        this.commandTotal = source["commandTotal"];
	        this.sequence = source["sequence"];
	        this.command = source["command"];
	        this.commandName = source["commandName"];
	        this.param1 = source["param1"];
	        this.param2 = source["param2"];
	        this.param3 = source["param3"];
	        this.param4 = source["param4"];
	        this.latitude = source["latitude"];
	        this.longitude = source["longitude"];
	        this.altitude = source["altitude"];
	        this.frame = source["frame"];
	        this.frameName = source["frameName"];
	    }
	}
	export class CurveDataRequest {
	    type: string;
	    field: string;
	
	    static createFrom(source: any = {}) {
	        return new CurveDataRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.field = source["field"];
	    }
	}
	export class ErrorEntry {
	    lineno: number;
	    timeMs: number;
	    subsys: number;
	    eCode: number;
	    subsysName: string;
	    errorCode: string;
	    description: string;
	
	    static createFrom(source: any = {}) {
	        return new ErrorEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.lineno = source["lineno"];
	        this.timeMs = source["timeMs"];
	        this.subsys = source["subsys"];
	        this.eCode = source["eCode"];
	        this.subsysName = source["subsysName"];
	        this.errorCode = source["errorCode"];
	        this.description = source["description"];
	    }
	}
	export class EventEntry {
	    lineno: number;
	    timeMs: number;
	    id: number;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new EventEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.lineno = source["lineno"];
	        this.timeMs = source["timeMs"];
	        this.id = source["id"];
	        this.name = source["name"];
	    }
	}
	export class FieldInfo {
	    name: string;
	    type: string;
	    min: number;
	    max: number;
	    count: number;
	    isNumeric: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FieldInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.type = source["type"];
	        this.min = source["min"];
	        this.max = source["max"];
	        this.count = source["count"];
	        this.isNumeric = source["isNumeric"];
	    }
	}
	export class FieldsRequest {
	    type: string;
	
	    static createFrom(source: any = {}) {
	        return new FieldsRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	    }
	}
	export class LoadRequest {
	    path: string;
	
	    static createFrom(source: any = {}) {
	        return new LoadRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	    }
	}
	export class LogDefsResponse {
	    format: string;
	    eventNames?: Record<number, string>;
	    errorSubsystems?: Record<number, string>;
	    errorCodes?: Record<number, any>;
	    generalErrorCodes?: Record<number, string>;
	    navStateNames?: Record<number, string>;
	    units: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new LogDefsResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.format = source["format"];
	        this.eventNames = source["eventNames"];
	        this.errorSubsystems = source["errorSubsystems"];
	        this.errorCodes = source["errorCodes"];
	        this.generalErrorCodes = source["generalErrorCodes"];
	        this.navStateNames = source["navStateNames"];
	        this.units = source["units"];
	    }
	}
	export class MAVLinkCommandEntry {
	    timeMs: number;
	    targetSystem: number;
	    targetComponent: number;
	    sourceSystem: number;
	    sourceComponent: number;
	    frame: number;
	    frameName: string;
	    command: number;
	    commandName: string;
	    param1: number;
	    param2: number;
	    param3: number;
	    param4: number;
	    latitude: number;
	    longitude: number;
	    altitude: number;
	    result: number;
	    resultName: string;
	    wasCommandLong: boolean;
	
	    static createFrom(source: any = {}) {
	        return new MAVLinkCommandEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.timeMs = source["timeMs"];
	        this.targetSystem = source["targetSystem"];
	        this.targetComponent = source["targetComponent"];
	        this.sourceSystem = source["sourceSystem"];
	        this.sourceComponent = source["sourceComponent"];
	        this.frame = source["frame"];
	        this.frameName = source["frameName"];
	        this.command = source["command"];
	        this.commandName = source["commandName"];
	        this.param1 = source["param1"];
	        this.param2 = source["param2"];
	        this.param3 = source["param3"];
	        this.param4 = source["param4"];
	        this.latitude = source["latitude"];
	        this.longitude = source["longitude"];
	        this.altitude = source["altitude"];
	        this.result = source["result"];
	        this.resultName = source["resultName"];
	        this.wasCommandLong = source["wasCommandLong"];
	    }
	}
	export class MessageEntry {
	    lineno: number;
	    timeMs: number;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new MessageEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.lineno = source["lineno"];
	        this.timeMs = source["timeMs"];
	        this.message = source["message"];
	    }
	}
	export class ModeEntry {
	    lineno: number;
	    timeMs: number;
	    mode: string;
	    modeNum: number;
	
	    static createFrom(source: any = {}) {
	        return new ModeEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.lineno = source["lineno"];
	        this.timeMs = source["timeMs"];
	        this.mode = source["mode"];
	        this.modeNum = source["modeNum"];
	    }
	}
	export class Parameter {
	    name: string;
	    value: number;
	
	    static createFrom(source: any = {}) {
	        return new Parameter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.value = source["value"];
	    }
	}
	export class StatusResponse {
	    loaded: boolean;
	    fileName: string;
	
	    static createFrom(source: any = {}) {
	        return new StatusResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.loaded = source["loaded"];
	        this.fileName = source["fileName"];
	    }
	}
	export class SummaryResponse {
	    filename: string;
	    fileSizeKB: number;
	    vehicleType: string;
	    firmwareVersion: string;
	    firmwareHash: string;
	    hardwareType: string;
	    freeRAM: number;
	    durationSecs: number;
	    totalLines: number;
	    frame: string;
	    airframe: string;
	    typeCount: number;
	    startUnixSecs: number;
	    hasUTC: boolean;
	    startTimeMs: number;
	    format: string;
	
	    static createFrom(source: any = {}) {
	        return new SummaryResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filename = source["filename"];
	        this.fileSizeKB = source["fileSizeKB"];
	        this.vehicleType = source["vehicleType"];
	        this.firmwareVersion = source["firmwareVersion"];
	        this.firmwareHash = source["firmwareHash"];
	        this.hardwareType = source["hardwareType"];
	        this.freeRAM = source["freeRAM"];
	        this.durationSecs = source["durationSecs"];
	        this.totalLines = source["totalLines"];
	        this.frame = source["frame"];
	        this.airframe = source["airframe"];
	        this.typeCount = source["typeCount"];
	        this.startUnixSecs = source["startUnixSecs"];
	        this.hasUTC = source["hasUTC"];
	        this.startTimeMs = source["startTimeMs"];
	        this.format = source["format"];
	    }
	}
	export class TypeBodyRequest {
	    type: string;
	
	    static createFrom(source: any = {}) {
	        return new TypeBodyRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	    }
	}
	export class TypeInfo {
	    name: string;
	    fields: string[];
	    count: number;
	    hasData: boolean;
	
	    static createFrom(source: any = {}) {
	        return new TypeInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.fields = source["fields"];
	        this.count = source["count"];
	        this.hasData = source["hasData"];
	    }
	}

}

export namespace mapservice {
	
	export class CacheStatsResponse {
	    dir: string;
	    capBytes: number;
	    providers: maptiles.ProviderCacheStat[];
	    totalBytes: number;
	
	    static createFrom(source: any = {}) {
	        return new CacheStatsResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dir = source["dir"];
	        this.capBytes = source["capBytes"];
	        this.providers = this.convertValues(source["providers"], maptiles.ProviderCacheStat);
	        this.totalBytes = source["totalBytes"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ClearCacheProviderRequest {
	    id: string;
	
	    static createFrom(source: any = {}) {
	        return new ClearCacheProviderRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	    }
	}
	export class ProvidersResponse {
	    providers: maptiles.ProviderInfo[];
	    path: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new ProvidersResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.providers = this.convertValues(source["providers"], maptiles.ProviderInfo);
	        this.path = source["path"];
	        this.updatedAt = source["updatedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace maptiles {
	
	export class ProviderCacheStat {
	    id: string;
	    name: string;
	    sizeBytes: number;
	    tileCount: number;
	
	    static createFrom(source: any = {}) {
	        return new ProviderCacheStat(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.sizeBytes = source["sizeBytes"];
	        this.tileCount = source["tileCount"];
	    }
	}
	export class ProviderInfo {
	    id: string;
	    name: string;
	    attribution?: string;
	    hidden?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ProviderInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.attribution = source["attribution"];
	        this.hidden = source["hidden"];
	    }
	}

}

export namespace model {
	
	export class LlmConfig {
	    provider: string;
	    baseUrl: string;
	    apiKey: string;
	    model: string;
	    temperature: number;
	    maxStepsMinimal: number;
	    maxStepsFast: number;
	    maxStepsStandard: number;
	    maxStepsPro: number;
	    maxStepsDeep: number;
	
	    static createFrom(source: any = {}) {
	        return new LlmConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.baseUrl = source["baseUrl"];
	        this.apiKey = source["apiKey"];
	        this.model = source["model"];
	        this.temperature = source["temperature"];
	        this.maxStepsMinimal = source["maxStepsMinimal"];
	        this.maxStepsFast = source["maxStepsFast"];
	        this.maxStepsStandard = source["maxStepsStandard"];
	        this.maxStepsPro = source["maxStepsPro"];
	        this.maxStepsDeep = source["maxStepsDeep"];
	    }
	}

}

