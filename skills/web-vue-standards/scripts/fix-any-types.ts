/**
 * 修复 any 类型脚本
 *
 * 自动检测代码中的 any 类型并推断实际类型
 */

interface CodeFix {
  original: string
  fixed: string
  reason: string
}

export function fixAnyTypes(code: string): CodeFix[] {
  const fixes: CodeFix[] = []

  // 检测 any 类型的各种模式
  const patterns = [
    // 函数参数 any
    {
      pattern: /(\w+)\s*:\s*any/g,
      fix: (match: string, name: string) => {
        // 尝试从上下文推断类型
        return `${name}: unknown`
      },
      reason: '将 any 替换为 unknown，强制类型检查'
    },
    // 变量 any
    {
      pattern: /(\w+):\s*any/g,
      fix: (match: string, name: string) => {
        return `${name}: unknown`
      },
      reason: '使用 unknown 替代 any'
    },
    // 类型断言 as any
    {
      pattern: /\s+as\s+any/g,
      fix: () => {
        return ' as unknown'
      },
      reason: '避免使用 as any 跳过类型检查'
    }
  ]

  patterns.forEach(({ pattern, fix, reason }) => {
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

export function generateTypeInference(variableName: string, usageContext: string): string {
  // 基于使用上下文推断类型
  if (usageContext.includes('.map(') || usageContext.includes('.filter(')) {
    return `Array<unknown>`
  }
  if (usageContext.includes('.ch1') || usageContext.includes('.ch2')) {
    return `RcState`
  }
  if (usageContext.includes('.roll') || usageContext.includes('.pitch')) {
    return `AttitudeData`
  }
  return `unknown`
}

export function createInterfaceFromUsage(
  variableName: string,
  usageContext: string
): string {
  const properties: { name: string; type: string }[] = []

  // 解析属性访问
  const propertyMatches = usageContext.matchAll(/\.(\w+)/g)
  for (const match of propertyMatches) {
    const propName = match[1]
    let propType = 'unknown'

    // 简单类型推断
    if (['ch1', 'ch2', 'ch3', 'ch4'].includes(propName)) {
      propType = 'number'
    } else if (['mode', 'name'].includes(propName)) {
      propType = 'string'
    } else if (['enabled', 'visible'].includes(propName)) {
      propType = 'boolean'
    }

    properties.push({ name: propName, type: propType })
  }

  // 生成接口
  const interfaceLines = properties.map(
    p => `  ${p.name}: ${p.type}`
  )

  return `interface ${capitalize(variableName)}Type {\n${interfaceLines.join('\n')}\n}`
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}