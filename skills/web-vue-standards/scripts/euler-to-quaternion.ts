/**
 * 欧拉角转四元数脚本
 *
 * 检测欧拉角的使用并转换为四元数，避免万向锁问题
 */

interface QuaternionFix {
  original: string
  fixed: string
  reason: string
}

export function detectEulerUsage(code: string): QuaternionFix[] {
  const fixes: QuaternionFix[] = []

  // 检测直接使用欧拉角
  const eulerPatterns = [
    // new THREE.Euler()
    {
      pattern: /new\s+THREE\.Euler\(([^)]+)\)/g,
      fix: (match: string, args: string) => {
        return `quaternionFromEuler(${args})`
      },
      reason: '将欧拉角转换为四元数'
    },
    // .rotation.set(pitch, roll, yaw)
    {
      pattern: /(\w+\.rotation)\.set\(([^)]+)\)/g,
      fix: (match: string, obj: string, args: string) => {
        return `setQuaternionFromEuler(${obj}, ${args})`
      },
      reason: '使用四元数设置旋转'
    },
    // 直接访问 .rotation.x/.rotation.y/.rotation.z
    {
      pattern: /(\w+\.rotation)\.[xyz]/g,
      fix: (match: string, obj: string) => {
        return `// TODO: Convert to quaternion - ${match}`
      },
      reason: '避免直接操作欧拉角分量'
    }
  ]

  eulerPatterns.forEach(({ pattern, fix, reason }) => {
    let match
    while ((match = pattern.exec(code)) !== null) {
      fixes.push({
        original: match[0],
        fixed: fix(match[0], match[1] || ''),
        reason
      })
    }
  })

  return fixes
}

export function generateQuaternionHelpers(): string {
  return `
// 三元数工具函数
import * as THREE from 'three'

/**
 * 从欧拉角创建四元数
 * @param pitch - X 轴旋转（俯仰）
 * @param roll - Y 轴旋转（翻滚）
 * @param yaw - Z 轴旋转（偏航）
 * @param order - 旋转顺序，默认 'YXZ'（避免万向锁）
 */
export function quaternionFromEuler(
  pitch: number,
  roll: number,
  yaw: number,
  order: 'XYZ' | 'YXZ' | 'ZXY' = 'YXZ'
): THREE.Quaternion {
  const euler = new THREE.Euler(pitch, roll, yaw, order)
  return new THREE.Quaternion().setFromEuler(euler)
}

/**
 * 从四元数获取欧拉角（仅在需要显示时使用）
 * @param q - 四元数
 * @param order - 旋转顺序
 */
export function eulerFromQuaternion(
  q: THREE.Quaternion,
  order: 'XYZ' | 'YXZ' | 'ZXY' = 'YXZ'
): { pitch: number; roll: number; yaw: number } {
  const euler = new THREE.Euler().setFromQuaternion(q, order)
  return {
    pitch: euler.x,
    roll: euler.y,
    yaw: euler.z
  }
}

/**
 * 使用欧拉角设置对象的旋转（内部转换为四元数）
 * @param obj - Three.js 对象
 * @param pitch - 俯仰角
 * @param roll - 翻滚角
 * @param yaw - 偏航角
 */
export function setQuaternionFromEuler(
  obj: { quaternion: THREE.Quaternion },
  pitch: number,
  roll: number,
  yaw: number
): void {
  const q = quaternionFromEuler(pitch, roll, yaw)
  obj.quaternion.copy(q)
}

/**
 * 四元数球面插值（平滑旋转）
 * @param start - 起始四元数
 * @param end - 目标四元数
 * @param alpha - 插值因子 (0-1)
 */
export function slerp(
  start: THREE.Quaternion,
  end: THREE.Quaternion,
  alpha: number
): THREE.Quaternion {
  return new THREE.Quaternion().copy(start).slerp(end, alpha)
}

/**
 * 四元数乘法（组合旋转）
 */
export function multiplyQuaternions(
  q1: THREE.Quaternion,
  q2: THREE.Quaternion
): THREE.Quaternion {
  return q1.clone().multiply(q2)
}
`
}

export function applyQuaternionConversion(code: string): string {
  let updatedCode = code
  const fixes = detectEulerUsage(code)

  // 添加工具函数
  if (fixes.length > 0 && !updatedCode.includes('quaternionFromEuler')) {
    updatedCode = generateQuaternionHelpers() + '\n' + updatedCode
  }

  // 应用修复
  fixes.forEach(fix => {
    updatedCode = updatedCode.replace(fix.original, fix.fixed)
  })

  return updatedCode
}

export function generateRotationExample(): string {
  return `
// ===== 错误做法 - 使用欧拉角 =====
function updateAttitudeBad(pitch: number, roll: number, yaw: number): void {
  // 可能导致万向锁
  camera.rotation.set(pitch, roll, yaw)

  // 或者
  camera.rotation.x = pitch
  camera.rotation.y = roll
  camera.rotation.z = yaw
}

// ===== 正确做法 - 使用四元数 =====
function updateAttitudeGood(pitch: number, roll: number, yaw: number): void {
  const q = quaternionFromEuler(pitch, roll, yaw)
  camera.quaternion.copy(q)
}

// ===== 最佳做法 - 带插值的平滑旋转 =====
function smoothAttitudeUpdate(
  currentPitch: number,
  currentRoll: number,
  currentYaw: number,
  targetPitch: number,
  targetRoll: number,
  targetYaw: number,
  delta: number
): void {
  const targetQ = quaternionFromEuler(targetPitch, targetRoll, targetYaw)
  camera.quaternion.slerp(targetQ, delta * 2.0)
}

// ===== 组合旋转 =====
function combineRotations(): void {
  const baseRotation = quaternionFromEuler(0, 0, 0)
  const additionalPitch = quaternionFromEuler(Math.PI / 4, 0, 0)
  const finalRotation = multiplyQuaternions(baseRotation, additionalPitch)
  camera.quaternion.copy(finalRotation)
}
`
}