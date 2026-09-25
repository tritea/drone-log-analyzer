// GLB 原生尺寸测量：量出模型在「模型空间」的真实世界包围盒（maxDim / minY），
// 供 earth 视图无人机 GLB 归一化缩放（droneBaseScale = physBase / maxDim）与 halfH 抬升
// （droneLiftPerScale = max(0,-minY) × baseScale）。Cesium 的 model.scale 直接乘 GLB 原生米数
// （不像 map-3d 先归一化到 ~1.5m），不量就会「超级大」；对齐 map-3d 的真实物理尺寸渲染需要此测量。
//
// 关键：必须递归累积 scene 节点树的 TRS/matrix 变换。POSITION accessor 的 min/max 只是 mesh 本地坐标，
// 若直接取并集（旧实现）会忽略节点层级——VTOL 的 `Sketchfab_model` 根节点带一个绕 X 轴 -90° 的 rotation，
// 旧实现据此算出 minY=-45/maxDim=62，实际应用旋转后是 minY=-7.66/maxDim=84，导致 halfH 多抬 ~3.3m
// （模型飞到航线之上数个机身高度）、尺寸偏大 ~36%。正确做法：把每个 mesh 的 accessor AABB 八角点用
// 节点世界矩阵变换到模型空间后取并集。glTF +Y 朝上（Cesium upAxis 默认 Axis.Y），故模型空间 minY 即底部偏移。

export interface GlbNativeBox { maxDim: number; minY: number }

const FALLBACK_BOX: GlbNativeBox = { maxDim: 1, minY: 0 }
const glbBoxCache = new Map<string, GlbNativeBox>()

// 列主序 4×4 矩阵（与 glTF/WebGL 一致）：translation 在 column3 = [12,13,14]。
type Mat4 = number[]

function mat4Identity(): Mat4 {
  const m = new Array(16).fill(0)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}

function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[row + k * 4] * b[k + col * 4]
      out[row + col * 4] = s
    }
  }
  return out
}

function mat4FromTranslation(t: number[]): Mat4 {
  const m = mat4Identity()
  m[12] = t[0] ?? 0
  m[13] = t[1] ?? 0
  m[14] = t[2] ?? 0
  return m
}

interface GlbNodeLike {
  matrix?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
  mesh?: number
  children?: number[]
}

// 节点本地矩阵：`matrix` 优先（覆盖 TRS），否则按 T·R·S（先缩放→旋转→平移）合成。
function nodeLocalMatrix(node: GlbNodeLike): Mat4 {
  if (node.matrix) return node.matrix.slice(0, 16)
  const t = node.translation ?? [0, 0, 0]
  const r = node.rotation ?? [0, 0, 0, 1]
  const s = node.scale ?? [1, 1, 1]
  const [qx, qy, qz, qw] = r
  // 四元数 → 3×3 旋转（行主序暂存 R[row*3+col]），再按列乘缩放进列主序 4×4 的左上 3×3（RS）。
  const R = [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw),
    2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw),
    2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy),
  ]
  const rs: Mat4 = new Array(16).fill(0)
  rs[15] = 1
  for (let c = 0; c < 3; c++) {
    const sc = s[c] ?? 1
    rs[0 + c * 4] = R[0 + c * 3] * sc
    rs[1 + c * 4] = R[1 + c * 3] * sc
    rs[2 + c * 4] = R[2 + c * 3] * sc
  }
  return mat4Multiply(mat4FromTranslation(t), rs)
}

function transformPoint(m: Mat4, p: number[]): number[] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ]
}

export async function measureGlbBox(uri: string): Promise<GlbNativeBox> {
  const cached = glbBoxCache.get(uri)
  if (cached) return cached
  try {
    // uri 形如 'vendor/VTOL.glb'（相对）；按文档基准解析成绝对 URL，避免 Wails/vite 基路径差异致 fetch 失败。
    const res = await fetch(new URL(uri, document.baseURI).href)
    if (!res.ok) throw new Error('fetch ' + uri + ' -> ' + res.status)
    const buf = await res.arrayBuffer()
    const view = new DataView(buf)
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
    if (magic !== 'glTF' || view.byteLength < 20) throw new Error('not glTF')
    const jsonLen = view.getUint32(12, true)
    const jsonType = String.fromCharCode(view.getUint8(16), view.getUint8(17), view.getUint8(18), view.getUint8(19))
    if (jsonType !== 'JSON' || 20 + jsonLen > view.byteLength) throw new Error('bad JSON chunk')
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen))) as {
      accessors?: Array<{ min?: number[]; max?: number[] }>
      meshes?: Array<{ primitives?: Array<{ attributes?: { POSITION?: number } }> }>
      nodes?: GlbNodeLike[]
      scenes?: Array<{ nodes?: number[] }>
    }
    const accessors = json.accessors ?? []
    const roots = json.scenes?.[0]?.nodes ?? []
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    const acc = (p: number[]): void => {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k])
        max[k] = Math.max(max[k], p[k])
      }
    }
    // 深度优先递归：累积父节点世界矩阵，对每个 mesh 节点的 POSITION accessor AABB 八角点做世界变换后并入全局 AABB。
    const walk = (idx: number, parentWorld: Mat4): void => {
      const node = json.nodes?.[idx]
      if (!node) return
      const world = mat4Multiply(parentWorld, nodeLocalMatrix(node))
      if (node.mesh != null) {
        for (const prim of json.meshes?.[node.mesh]?.primitives ?? []) {
          // 只取 POSITION，避免 normal/tangent 的 [-1,1] 单位向量污染包围盒。
          const a = accessors[prim.attributes?.POSITION ?? -1]
          if (!a || !Array.isArray(a.min) || !Array.isArray(a.max) || a.min.length < 3 || a.max.length < 3) continue
          const [mnx, mny, mnz] = a.min
          const [mxx, mxy, mxz] = a.max
          const corners: number[][] = [
            [mnx, mny, mnz], [mxx, mny, mnz], [mnx, mxy, mnz], [mxx, mxy, mnz],
            [mnx, mny, mxz], [mxx, mny, mxz], [mnx, mxy, mxz], [mxx, mxy, mxz],
          ]
          for (const c of corners) acc(transformPoint(world, c))
        }
      }
      for (const ci of node.children ?? []) walk(ci, world)
    }
    for (const ri of roots) walk(ri, mat4Identity())
    if (!isFinite(min[0])) throw new Error('no POSITION bounds')
    const box: GlbNativeBox = {
      maxDim: Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]),
      minY: min[1],
    }
    glbBoxCache.set(uri, box)
    return box
  } catch {
    glbBoxCache.set(uri, FALLBACK_BOX)
    return FALLBACK_BOX
  }
}
