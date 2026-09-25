import * as THREE from 'three'
import {
  THREE_MODEL_MATERIAL, BODY_MATERIAL, THREE_PROPELLER_ORDER, THREE_DEFAULT_DRONE_MODEL,
  THREE_PROPELLER_PWM_MIN, THREE_PROPELLER_PWM_MAX, THREE_PROPELLER_MAX_OMEGA,
  THREE_PROPELLER_ACCEL_TAU, THREE_PROPELLER_DECEL_TAU,
  type MaterialProperties,
} from '@/constants'

export interface PropellerInfo {
  mesh: THREE.Object3D
  dir: number
  func: number
}

export interface AttitudeSample {
  roll: number
  pitch: number
  yaw: number
}

export type MaterialBuilder = (cfg: MaterialProperties) => THREE.Material

function classifyMultirotorFrame(frame: string | number | undefined | null): string | null {
  if (frame == null || frame === '') return null
  if (typeof frame === 'number') {
    if (frame === 1) return 'QUAD-X'
    if (frame === 3 || frame === 4) return 'HEXA-X'
    if (frame === 5 || frame === 6) return 'OCTO-X'
    return null
  }
  const f = frame.toUpperCase().trim()
  if (!f) return null
  if (f.includes('OCT')) return 'OCTO-X'
  if (f.includes('HEX') || f.includes('Y6')) return 'HEXA-X'
  if (f.includes('QUAD')) return 'QUAD-X'
  return null
}

export function resolveDroneModelName(
  frameName: string | number | undefined | null,
  airframe?: string,
  defaultModel: string = THREE_DEFAULT_DRONE_MODEL,
): string {
  if (airframe === 'vtol') return 'VTOL'
  return classifyMultirotorFrame(frameName) ?? defaultModel
}

export function makeDroneQuaternion(sample: AttitudeSample): THREE.Quaternion {
  const deg = Math.PI / 180
  const yaw = (sample.yaw || 0) * deg
  const pitch = (sample.pitch || 0) * deg
  const roll = (sample.roll || 0) * deg
  const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw)
  const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -pitch)
  const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll)
  const uav = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
  return uav.multiply(qYaw).multiply(qPitch).multiply(qRoll)
}

export function computeDronePhysicalScale(
  drone: THREE.Object3D,
  airframe: string | undefined,
): { scale: number; originalMaxDim: number } | null {
  drone.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(drone)
  const maxDim = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z)
  if (!isFinite(maxDim) || maxDim <= 0) return null
  const originalMaxDim = maxDim / (drone.scale.x || 1)
  const physSize = airframe === 'vtol' ? 1.7 : 0.65
  return { scale: physSize / originalMaxDim, originalMaxDim }
}

const ARM_RADIUS = 0.82
const SPAR_WIDTH = 0.1
const SPAR_HEIGHT = 0.1
const SPAR_Y = -0.02
interface LowpolyMotor { name: string; angle: number }
const LOWPOLY_MOTOR_LAYOUT: Record<string, LowpolyMotor[]> = {
  'QUAD-X': [
    { name: 'M1', angle: 45 }, { name: 'M4', angle: 135 },
    { name: 'M2', angle: 225 }, { name: 'M3', angle: 315 },
  ],
  'HEXA-X': [
    { name: 'M1', angle: 30 }, { name: 'M2', angle: 90 }, { name: 'M3', angle: 150 },
    { name: 'M4', angle: 210 }, { name: 'M5', angle: 270 }, { name: 'M6', angle: 330 },
  ],
  'OCTO-X': [
    { name: 'M1', angle: 22.5 }, { name: 'M2', angle: 67.5 }, { name: 'M3', angle: 112.5 }, { name: 'M4', angle: 157.5 },
    { name: 'M5', angle: 202.5 }, { name: 'M6', angle: 247.5 }, { name: 'M7', angle: 292.5 }, { name: 'M8', angle: 337.5 },
  ],
}

export function buildLowpolyDroneModel(name: string): THREE.Group {
  const group = new THREE.Group()
  group.name = 'lowpoly-' + name
  const isVtol = name === 'VTOL'
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x33373f, metalness: 0.4, roughness: 0.48 })
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2e35, metalness: 0.3, roughness: 0.55 })

  if (isVtol) {
    const fuselage = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 1.4), bodyMat)
    fuselage.name = 'shell'
    group.add(fuselage)
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.13, 0.22), bodyMat)
    nose.name = 'shell-nose'
    nose.position.set(0, 0, 0.79)
    group.add(nose)
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.24), frameMat)
    wing.name = 'shell-wing'
    wing.position.set(0, 0, 0.12)
    group.add(wing)
    const hStab = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.16), frameMat)
    hStab.name = 'shell-tail'
    hStab.position.set(0, 0, -0.62)
    group.add(hStab)
    const vStab = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.16), frameMat)
    vStab.name = 'shell-tail'
    vStab.position.set(0, 0.13, -0.6)
    group.add(vStab)
    addLowpolyMotor(group, 'M1', 0.6, 0.12, 0.3, frameMat)
    addLowpolyMotor(group, 'M3', -0.6, 0.12, 0.3, frameMat)
    addLowpolyMotor(group, 'M2', -0.6, 0.12, -0.06, frameMat)
    addLowpolyMotor(group, 'M4', 0.6, 0.12, -0.06, frameMat)
    const pusher = addLowpolyProp(group, 'throttle', 0, 0.16, -0.74)
    pusher.rotation.x = -Math.PI / 2
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.24, 0.62), bodyMat)
    body.name = 'shell'
    group.add(body)
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.2), bodyMat)
    nose.name = 'shell-nose'
    nose.position.set(0, 0, 0.38)
    group.add(nose)
    const layout = LOWPOLY_MOTOR_LAYOUT[name] ?? LOWPOLY_MOTOR_LAYOUT['QUAD-X']
    const half = layout.length >> 1
    for (let i = 0; i < half; i++) addLowpolySpar(group, layout[i].angle, frameMat)
    for (const m of layout) {
      const rad = m.angle * Math.PI / 180
      addLowpolyMotor(group, m.name, Math.sin(rad) * ARM_RADIUS, 0.06, Math.cos(rad) * ARM_RADIUS, frameMat)
    }
  }
  return group
}

export function addLowpolyMotor(parent: THREE.Object3D, name: string, x: number, y: number, z: number, podMat: THREE.Material): void {
  const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 10), podMat)
  pod.name = 'shell-pod'
  pod.position.set(x, y - 0.04, z)
  parent.add(pod)
  addLowpolyProp(parent, name, x, y + 0.05, z)
}

export function addLowpolyProp(parent: THREE.Object3D, name: string, x: number, y: number, z: number): THREE.Group {
  const propGroup = new THREE.Group()
  propGroup.name = name
  propGroup.position.set(x, y, z)
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x14171c, metalness: 0.35, roughness: 0.42 })
  const blade1 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.06), bladeMat)
  const blade2 = blade1.clone()
  blade2.rotation.y = Math.PI / 2
  const hubMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 8), bladeMat)
  propGroup.add(blade1)
  propGroup.add(blade2)
  propGroup.add(hubMesh)
  parent.add(propGroup)
  return propGroup
}

export function addLowpolySpar(parent: THREE.Object3D, angleDeg: number, armMat: THREE.Material): void {
  const spar = new THREE.Mesh(new THREE.BoxGeometry(SPAR_WIDTH, SPAR_HEIGHT, ARM_RADIUS * 2), armMat)
  spar.name = 'shell-arm'
  spar.rotation.y = angleDeg * Math.PI / 180
  spar.position.y = SPAR_Y
  parent.add(spar)
}

export function normalizeLoadedDroneModel(
  gltfScene: THREE.Object3D,
  scale: { x: number; y: number; z: number },
  offsetToCenter: { x: boolean; y: boolean; z: boolean },
  name: string,
  materialTable: Record<string, Record<string, MaterialProperties>>,
  fallbackMaterial: MaterialProperties,
  buildMaterial: MaterialBuilder,
): THREE.Group {
  const droneModel = new THREE.Group()
  droneModel.name = 'drone-model-base'

  const rotationModel = new THREE.Group()
  rotationModel.name = 'drone-model-rotation'

  const specialMaterial = materialTable[name]
  const model = gltfScene
  model.traverse((child: any) => {
    if (child.isMesh) {
      let materialConfig: MaterialProperties | undefined
      let node: any = child
      while (node && !materialConfig) {
        if (specialMaterial && node.name && node.name in specialMaterial) materialConfig = specialMaterial[node.name]
        node = node.parent
      }
      const cfg: MaterialProperties = materialConfig || fallbackMaterial
      child.userData._apmMatConfig = cfg
      child.material = buildMaterial(cfg)
    }
  })

  const box = new THREE.Box3().setFromObject(model)
  const halfX = (box.max.x - box.min.x) * 0.5 + box.min.x
  const halfY = (box.max.y - box.min.y) * 0.5 + box.min.y
  const halfZ = (box.max.z - box.min.z) * 0.5 + box.min.z
  model.position.set(offsetToCenter.x ? -halfX : 0, offsetToCenter.y ? -halfY : 0, offsetToCenter.z ? -halfZ : 0)

  rotationModel.add(model)
  rotationModel.scale.set(scale.x, scale.y, scale.z)
  droneModel.add(rotationModel)
  return droneModel
}

export function collectPropellers(
  root: THREE.Object3D | null,
  name: string,
  propOrder: Record<string, Array<{ name: string; dir: number; func?: number }>> = THREE_PROPELLER_ORDER,
): PropellerInfo[] {
  const out: PropellerInfo[] = []
  if (!root) return out
  const framePropellerOrder = (name in propOrder) ? propOrder[name] : propOrder[THREE_DEFAULT_DRONE_MODEL]
  for (let i = 0; i < framePropellerOrder.length; i++) {
    const cfg = framePropellerOrder[i]
    const mesh = root.getObjectByName(cfg.name)
    if (mesh) out.push({ mesh, dir: cfg.dir, func: cfg.func != null ? cfg.func : (33 + i) })
  }
  return out
}

export function pwmToAngularVelocity(pwm: number | null | undefined): number {
  if (pwm === null || pwm === undefined || !isFinite(Number(pwm))) return 0
  let norm = (Number(pwm) - THREE_PROPELLER_PWM_MIN) / (THREE_PROPELLER_PWM_MAX - THREE_PROPELLER_PWM_MIN)
  if (norm < 0) norm = 0
  else if (norm > 1) norm = 1
  return norm * THREE_PROPELLER_MAX_OMEGA
}

export function spinPropellersByPwm(
  props: PropellerInfo[],
  pwmPerProp: (number | null)[],
  dt: number,
): void {
  if (!props || !props.length || dt <= 0) return
  for (let i = 0; i < props.length; i++) {
    const p = props[i]
    const target = pwmToAngularVelocity(i < pwmPerProp.length ? pwmPerProp[i] : null)
    let omega = (p.mesh.userData.omega as number) || 0
    const tau = target > omega ? THREE_PROPELLER_ACCEL_TAU : THREE_PROPELLER_DECEL_TAU
    let k = dt / tau
    if (k > 1) k = 1 
    omega += (target - omega) * k
    p.mesh.userData.omega = omega
    p.mesh.rotation.y += p.dir * omega * dt
  }
}
