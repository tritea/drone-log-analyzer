import { defineStore } from 'pinia'
import { ref, type Ref } from 'vue'
import { logClient } from '@/services/log'
import {
  parseTypeBody,
  sliceFieldCurve,
  type CurveBinary,
  GLType,
  type TypeSchema,
  type TypeSchemaField,
  type TypeBody,
} from '@/modules/analysis/utils/curve-binary'
import { interpBuffer } from './interp'

/**
 * Static lookup tables shipped by the backend (error subsystem/code names,
 * event names, units, ...). Mirrors `logservice.LogDefsResponse` but kept as a
 * local structural type so consumers don't have to import the wails bindings.
 */
export interface LogDefs {
  eventNames: Record<string, string>
  errorSubsystems: Record<string, string>
  errorCodes: Record<string, Record<string, string>>
  generalErrorCodes: Record<string, string>
  units: Record<string, string>
}

// --- module-private helpers (pure, no store state) ---------------------------

function curveKey(typeName: string, fieldName: string): string {
  return typeName + '.' + fieldName
}

/**
 * Build a memoized async loader backed by a "done" flag plus a single
 * in-flight promise. Subsequent calls reuse the cached result or the pending
 * promise, and the pending slot is always cleared in `finally`.
 */
function createMemoLoader<Payload>(
  doneFlag: Ref<boolean>,
  pendingSlot: Ref<Promise<void> | null>,
  fetch: () => Promise<Payload | null>,
  store: (payload: Payload) => void,
): () => Promise<void> {
  return function run(): Promise<void> {
    if (doneFlag.value) return Promise.resolve()
    if (pendingSlot.value) return pendingSlot.value
    pendingSlot.value = (async (): Promise<void> => {
      try {
        const payload = await fetch()
        if (payload !== null) {
          store(payload)
          doneFlag.value = true
        }
      } finally {
        pendingSlot.value = null
      }
    })()
    return pendingSlot.value
  }
}

// --- store -------------------------------------------------------------------

export const useCurveManagerStore = defineStore('curveManager', () => {
  // state
  const schema = ref<TypeSchema | null>(null)
  const schemaLoaded = ref(false)
  const schemaLoading = ref<Promise<void> | null>(null)

  const typeBodies = ref<Record<string, TypeBody>>({})
  const typeBodyLoading = ref<Record<string, Promise<unknown>>>({})

  const fieldCache = ref<Record<string, CurveBinary>>({})

  const logdefs = ref<LogDefs | null>(null)
  const logdefsLoaded = ref(false)
  const logdefsLoading = ref<Promise<void> | null>(null)

  // schema / logdefs loaders (share the same memo pattern, different sources)
  const ensureSchema = createMemoLoader<TypeSchema>(
    schemaLoaded,
    schemaLoading,
    async () => {
      const payload = await logClient.typeSchema()
      if (!payload || (payload as { error?: string }).error) return null
      return payload as TypeSchema
    },
    (value) => {
      schema.value = value
    },
  )

  const ensureLogDefs = createMemoLoader<LogDefs>(
    logdefsLoaded,
    logdefsLoading,
    async () => {
      const payload = await logClient.logDefs()
      return payload ? (payload as LogDefs) : null
    },
    (value) => {
      logdefs.value = value
    },
  )

  // type-body fetch + cache, with per-type de-duplication of in-flight requests
  async function fetchTypeBody(typeName: string): Promise<TypeBody | null> {
    const bytes = await logClient.typeBody({ type: typeName })
    const body = parseTypeBody(bytes)
    if (body) typeBodies.value = { ...typeBodies.value, [typeName]: body }
    return body
  }

  async function getTypeBody(typeName: string): Promise<TypeBody | null> {
    const cached = typeBodies.value[typeName]
    if (cached) return cached
    const pending = typeBodyLoading.value[typeName]
    if (pending) {
      await pending
      return typeBodies.value[typeName] || null
    }
    const load = fetchTypeBody(typeName)
    typeBodyLoading.value = { ...typeBodyLoading.value, [typeName]: load }
    try {
      await load
    } finally {
      const next = { ...typeBodyLoading.value }
      delete next[typeName]
      typeBodyLoading.value = next
    }
    return typeBodies.value[typeName] || null
  }

  function findField(typeName: string, fieldName: string): TypeSchemaField | null {
    const schemaMap = schema.value
    if (!schemaMap) return null
    const entry = schemaMap[typeName]
    if (!entry) return null
    return entry.fields.find((field) => field.name === fieldName) ?? null
  }

  async function get(typeName: string, fieldName: string): Promise<CurveBinary> {
    const key = curveKey(typeName, fieldName)
    const cached = fieldCache.value[key]
    if (cached) return cached
    await ensureSchema()
    const descriptor = findField(typeName, fieldName)
    if (!descriptor) throw new Error('字段不在 type-schema: ' + key)
    const body = await getTypeBody(typeName)
    if (!body) throw new Error('曲线 body 拉取失败: ' + typeName)
    const curve = sliceFieldCurve(body, descriptor)
    fieldCache.value = { ...fieldCache.value, [key]: curve }
    return curve
  }

  function peek(typeName: string, fieldName: string): CurveBinary | null {
    return fieldCache.value[curveKey(typeName, fieldName)] || null
  }

  function rawInt32Column(
    typeName: string,
    fieldName: string,
  ): { values: Int32Array; scale: number; count: number } | null {
    const descriptor = findField(typeName, fieldName)
    if (!descriptor || descriptor.glType !== GLType.Int32) return null
    const body = typeBodies.value[typeName]
    if (!body) return null
    const rowCount = descriptor.count
    const values = new Int32Array(rowCount)
    const view = new DataView(body.buf, body.dataOff)
    for (let row = 0; row < rowCount; row++) {
      values[row] = view.getInt32(row * body.stride + descriptor.offset, true)
    }
    return { values, scale: descriptor.scale, count: rowCount }
  }

  // value sampling — linear or angle-wrapping, sharing one interpolation path
  function sampleAt(
    typeName: string,
    fieldName: string,
    timeMs: number,
    fallback: number | null,
    angleMode: boolean,
  ): number | null {
    const curve = fieldCache.value[curveKey(typeName, fieldName)]
    if (!curve) return fallback
    return interpBuffer(curve, timeMs, fallback, angleMode)
  }

  function getValueAt(
    typeName: string,
    fieldName: string,
    timeMs: number,
    fallback: number | null = null,
  ): number | null {
    return sampleAt(typeName, fieldName, timeMs, fallback, false)
  }

  function getAngleAt(
    typeName: string,
    fieldName: string,
    timeMs: number,
    fallback: number | null = null,
  ): number | null {
    return sampleAt(typeName, fieldName, timeMs, fallback, true)
  }

  function errCodeLabel(subsystemVal: number, codeVal: number): string {
    const defs = logdefs.value
    if (!defs) return ''
    const subsystemId = String(Math.round(subsystemVal))
    const codeId = String(Math.round(codeVal))
    const subsystemName = defs.errorSubsystems[subsystemId] || ''
    const codeTable = defs.errorCodes[subsystemId]
    let codeName = codeTable ? (codeTable[codeId] || '') : ''
    if (!codeName) codeName = defs.generalErrorCodes[codeId] || ''
    return subsystemName ? subsystemName + ': ' + codeName : codeName
  }

  function clear(): void {
    schema.value = null
    schemaLoaded.value = false
    schemaLoading.value = null
    typeBodies.value = {}
    typeBodyLoading.value = {}
    fieldCache.value = {}
    logdefs.value = null
    logdefsLoaded.value = false
    logdefsLoading.value = null
  }

  return {
    // state
    schema,
    schemaLoaded,
    schemaLoading,
    typeBodies,
    typeBodyLoading,
    fieldCache,
    logdefs,
    logdefsLoaded,
    logdefsLoading,
    // actions
    ensureSchema,
    getTypeBody,
    findField,
    get,
    peek,
    rawInt32Column,
    getValueAt,
    getAngleAt,
    clear,
    ensureLogDefs,
    errCodeLabel,
  }
})
