/**
 * 自定义模型的渲染层规格：由 store 数据（CustomModel/ModelGroup 展开的 tile）派生，
 * 经 URL 加载 GLB/OBJ 后按此位姿摆放。earth 渲染器与 runtime 共享。
 * （原定义在 map-3d/renderer/drone-layer.ts，MapLibre 3D 渲染器移除后归本域。）
 */
export interface CustomModelSpec {
  name: string
  url: string
  lon: number
  lat: number
  /** 相对地面的离地高（米） */
  alt: number
  yaw: number
  pitch: number
  roll: number
  scale: number
  hidden: boolean
}
