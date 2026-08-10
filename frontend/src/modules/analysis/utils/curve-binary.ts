
const CURVE_BIN_MAGIC = 0x4e554342;
const CURVE_BIN_VERSION = 1;
const HEADER_BYTES = 28;

export interface CurveBinary {
  buffer: Float32Array;
  baseTimeMs: number;
  min: number;
  max: number;
  count: number;
}

export function parseCurveBinary(buf: ArrayBuffer): CurveBinary | null {
  if (buf.byteLength < HEADER_BYTES) return null;
  const dv = new DataView(buf);
  const magic = dv.getUint32(0, true);
  const version = dv.getUint32(4, true);
  if (magic !== CURVE_BIN_MAGIC || version !== CURVE_BIN_VERSION) return null;

  const count = dv.getUint32(8, true);
  if (buf.byteLength < HEADER_BYTES + count * 8) return null;
  const baseTimeMs = dv.getFloat64(12, true);
  const min = dv.getFloat32(20, true);
  const max = dv.getFloat32(24, true);

  const buffer = new Float32Array(buf, HEADER_BYTES, count * 2);
  return { buffer: buffer, baseTimeMs: baseTimeMs, min: min, max: max, count: count };
}


export enum GLType {
  Int8 = 0,
  Uint8 = 1,
  Int16 = 2,
  Uint16 = 3,
  Int32 = 4,
  Uint32 = 5,
  Float32 = 6,
}

export function readGLValue(dv: DataView, offset: number, gl: GLType): number {
  switch (gl) {
    case GLType.Int8: return dv.getInt8(offset);
    case GLType.Uint8: return dv.getUint8(offset);
    case GLType.Int16: return dv.getInt16(offset, true);
    case GLType.Uint16: return dv.getUint16(offset, true);
    case GLType.Int32: return dv.getInt32(offset, true);
    case GLType.Uint32: return dv.getUint32(offset, true);
    case GLType.Float32: return dv.getFloat32(offset, true);
    default: return 0;
  }
}

export interface TypeSchemaField {
  name: string;
  glType: GLType;
  scale: number; 
  offset: number; 
  min: number;
  max: number;
  count: number;
}

export interface TypeSchemaEntry {
  fields: TypeSchemaField[];
  rowCount: number;
  stride: number;
  baseTimeMs: number;
}

export type TypeSchema = Record<string, TypeSchemaEntry>;

const TYPE_BIN_MAGIC = 0x4e555442; 
const TYPE_BIN_VERSION = 1;
const TYPE_BIN_HEADER = 32;

export interface TypeBody {
  buf: ArrayBuffer;
  dataOff: number; 
  rowCount: number;
  fieldCount: number;
  stride: number;
  baseTimeMs: number;
}

export function parseTypeBody(buf: ArrayBuffer): TypeBody | null {
  if (buf.byteLength < TYPE_BIN_HEADER) return null;
  const dv = new DataView(buf);
  const magic = dv.getUint32(0, true);
  const version = dv.getUint32(4, true);
  if (magic !== TYPE_BIN_MAGIC || version !== TYPE_BIN_VERSION) return null;
  const rowCount = dv.getUint32(8, true);
  const fieldCount = dv.getUint32(12, true);
  const stride = dv.getUint32(16, true);
  const baseTimeMs = dv.getFloat64(24, true);
  if (buf.byteLength < TYPE_BIN_HEADER + rowCount * stride) return null;
  return { buf: buf, dataOff: TYPE_BIN_HEADER, rowCount: rowCount, fieldCount: fieldCount, stride: stride, baseTimeMs: baseTimeMs };
}

export function sliceFieldCurve(tb: TypeBody, field: TypeSchemaField): CurveBinary {
  const n = field.count;
  const out = new Float32Array(n * 2);
  const dv = new DataView(tb.buf, tb.dataOff);
  for (let r = 0; r < n; r++) {
    const rowBase = r * tb.stride;
    out[r * 2] = dv.getInt32(rowBase, true); 
    out[r * 2 + 1] = readGLValue(dv, rowBase + field.offset, field.glType) * field.scale;
  }
  return { buffer: out, baseTimeMs: tb.baseTimeMs, min: field.min, max: field.max, count: n };
}
