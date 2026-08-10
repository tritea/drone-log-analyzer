/**
 * 为 3D 移动添加插值脚本
 *
 * 检测直接赋值位置/旋转的代码，添加插值逻辑以实现平滑移动
 */

interface InterpolationFix {
  original: string
  fixed: string
  location: 'position' | 'rotation' | 'scale'
  method: 'lerp' | 'slerp' | 'smoothstep'
}

export function detectDirectAssignment(code: string): InterpolationFix[] {
  const fixes: InterpolationFix[] = []

  // 检测直接位置赋值
  const positionAssignments = code.matchAll(
    /(\w+\.position)\s*=\s*(new THREE\.Vector3\([^)]+\)|\{[^}]+\})/g
  )
  for (const match of positionAssignments) {
    fixes.push({
      original: match[0],
      fixed: `${match[1]}.lerp(${match[2]}, delta * 5.0)`,
      location: 'position',
      method: 'lerp'
    })
  }

  // 检测直接旋转赋值（欧拉角）
  const eulerAssignments = code.matchAll(
    /(\w+\.rotation)\s*=\s*(new THREE\.Euler\([^)]+\)|\{[^}]+\})/g
  )
  for (const match of eulerAssignments) {
    fixes.push({
      original: match[0],
      fixed: `// TODO: Convert to quaternion and use slerp\n${match[1]}.copy(${match[2]})`,
      location: 'rotation',
      method: 'slerp'
    })
  }

  // 检测直接缩放赋值
  const scaleAssignments = code.matchAll(
    /(\w+\.scale)\s*=\s*(new THREE\.Vector3\([^)]+\)|\{[^}]+\})/g
  )
  for (const match of scaleAssignments) {
    fixes.push({
      original: match[0],
      fixed: `${match[1]}.lerp(${match[2]}, delta * 3.0)`,
      location: 'scale',
      method: 'lerp'
    })
  }

  return fixes
}

export function generateInterpolationFunction(
  location: 'position' | 'rotation' | 'scale'
): string {
  if (location === 'rotation') {
    return `
// 旋转插值 - 使用四元数避免万向锁
function updateRotation(
  current: Quaternion,
  targetPitch: number,
  targetRoll: number,
  targetYaw: number,
  alpha: number
): Quaternion {
  const target = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(targetPitch, targetRoll, targetYaw, 'YXZ')
  )
  return current.slerp(target, alpha)
}
`
  }

  return `
// 位置/缩放插值 - 平滑过渡
function update${capitalize(location)}(
  current: THREE.Vector3,
  target: THREE.Vector3,
  delta: number,
  speed: number = 5.0
): THREE.Vector3 {
  return current.lerp(target, delta * speed)
}
`
}

export function addInterpolationToCode(
  code: string,
  fixes: InterpolationFix[]
): string {
  let updatedCode = code

  fixes.forEach(fix => {
    // 替换直接赋值为插值调用
    updatedCode = updatedCode.replace(fix.original, fix.fixed)

    // 如果还没有插值函数，添加它
    if (!updatedCode.includes('update' + capitalize(fix.location))) {
      const functionCode = generateInterpolationFunction(fix.location)
      updatedCode = functionCode + '\n' + updatedCode
    }
  })

  return updatedCode
}

export function generateSmoothMovement(
  code: string,
  deltaTime: number = 0.016
): string {
  // 为没有时间参数的函数添加 delta 参数
  const functionPattern = /function\s+(\w+)\s*\(([^)]*)\)/g
  let match

  while ((match = functionPattern.exec(code)) !== null) {
    const functionName = match[1]
    const params = match[2]

    if (!params.includes('delta') && params.includes('position')) {
      const newParams = params
        ? `${params}, delta: number = ${deltaTime}`
        : `delta: number = ${deltaTime}`

      code = code.replace(
        new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)`),
        `function ${functionName}(${newParams})`
      )
    }
  }

  return code
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}