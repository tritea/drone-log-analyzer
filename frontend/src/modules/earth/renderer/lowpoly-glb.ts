import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { buildLowpolyDroneModel } from '@/modules/shared/utils/drone-model'

// 机型名 → lowpoly GLB blob URL 的 in-flight 缓存。
// 缓存 Promise（而非最终值），让 60fps render 循环在 await 期间并发触发同一机型时复用同一次导出。
const lowpolyGlbCache = new Map<string, Promise<string>>()
// 所有已创建的 blob URL：dispose 时统一 revoke，避免内存泄漏。
const lowpolyGlbUrls = new Set<string>()
// 代计数器：dispose 时递增，使所有 in-flight 导出的 onDone 能识别「自己已被废弃」→ 立即 revoke 新建的 url，
// 避免「dispose 时正好有导出在跑、其 onDone 延迟到达后创建的 url 没人 revoke」的孤儿泄漏。
let lowpolyGeneration = 0

/**
 * 取（或首次生成并缓存）某机型 lowpoly 程序化模型的 GLB blob URL。
 *
 * 用于 Cesium earth：vendor/ 无对应 GLB 的机型（HEXA-X/OCTO-X 等）按真实轴数，
 * 复用共享 buildLowpolyDroneModel 生成 Three.js Group → GLTFExporter(binary) → GLB ArrayBuffer → blob URL，
 * 作为 ModelGraphics.uri 喂给 Cesium。
 *
 * 桨叶节点名 M1..M8（addLowpolyProp 设 propGroup.name）经 GLTFExporter 逐字保留进 glTF，
 * 与 earth 的 nodeTransformations 按名匹配，桨叶旋转零改动复用。
 */
export function getLowpolyGlbUrl(name: string): Promise<string> {
  const cached = lowpolyGlbCache.get(name)
  if (cached) return cached

  const generation = lowpolyGeneration
  const promise = new Promise<string>((resolve, reject): void => {
    const group = buildLowpolyDroneModel(name)
    const exporter = new GLTFExporter()
    exporter.parse(
      group,
      (result): void => {
        // binary:true → result 为 ArrayBuffer。
        const blob = new Blob([result as ArrayBuffer], { type: 'application/octet-stream' })
        const url = URL.createObjectURL(blob)
        if (generation !== lowpolyGeneration) {
          // 导出完成前已 dispose（换代）→ 立即回收。仍 resolve 让 await 完成，调用方 stale 守卫会丢弃此 url。
          URL.revokeObjectURL(url)
        } else {
          lowpolyGlbUrls.add(url)
        }
        resolve(url)
      },
      (error: unknown): void => reject(error),
      { binary: true },
    )
  })

  lowpolyGlbCache.set(name, promise)
  return promise
}

/**
 * revoke 所有缓存的 lowpoly GLB blob URL 并清空缓存。
 * disposeEarth 调用：切走测绘视图时释放 blob，避免内存泄漏。
 *
 * 递增 generation：若 dispose 时某导出仍在 pending，其 onDone 到达后识别换代会自 revoke，
 * 不会留下孤儿 url（虽调用方 stale 守卫已保证不会用该 url 建 entity）。
 */
export function disposeLowpolyGlbCache(): void {
  lowpolyGeneration++
  for (const url of lowpolyGlbUrls) URL.revokeObjectURL(url)
  lowpolyGlbUrls.clear()
  lowpolyGlbCache.clear()
}
