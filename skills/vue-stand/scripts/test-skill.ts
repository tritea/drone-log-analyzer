/**
 * Skill 测试脚本
 *
 * 验证 web-vue-standards skill 是否能正确识别和修复代码问题
 */

import fs from 'fs'
import path from 'path'

interface TestResult {
  testName: string
  passed: boolean
  issues: string[]
  suggestions: string[]
}

// 读取测试文件
function readTestFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8')
}

// 检查组件大小规范
function checkComponentSize(content: string): boolean {
  const lines = content.split('\n')
  return lines.length <= 200
}

// 检查 any 类型使用
function checkAnyTypes(content: string): { hasAny: boolean; locations: string[] } {
  const anyPattern = /:\s*any\b/g
  const matches = content.match(anyPattern)
  const locations: string[] = []

  if (matches) {
    content.split('\n').forEach((line, index) => {
      if (anyPattern.test(line)) {
        locations.push(`Line ${index + 1}: ${line.trim()}`)
      }
    })
  }

  return {
    hasAny: matches !== null,
    locations
  }
}

// 检查欧拉角使用
function checkEulerAngles(content: string): { hasEuler: boolean; locations: string[] } {
  const eulerPatterns = [
    /rotation\.set\(/g,
    /rotation\.[xyz]\s*=/g,
    /new THREE\.Euler\(/g
  ]
  const locations: string[] = []

  eulerPatterns.forEach(pattern => {
    content.split('\n').forEach((line, index) => {
      if (pattern.test(line)) {
        locations.push(`Line ${index + 1}: ${line.trim()}`)
      }
    })
  })

  return {
    hasEuler: locations.length > 0,
    locations
  }
}

// 检查插值使用
function checkInterpolation(content: string): { hasInterpolation: boolean; locations: string[] } {
  const lerpPattern = /\.lerp\(/g
  const slerpPattern = /\.slerp\(/g
  const locations: string[] = []

  content.split('\n').forEach((line, index) => {
    if (lerpPattern.test(line) || slerpPattern.test(line)) {
      locations.push(`Line ${index + 1}: ${line.trim()}`)
    }
  })

  return {
    hasInterpolation: locations.length > 0,
    locations
  }
}

// 检查功能混合
function checkMixedFeatures(content: string): { features: string[]; isMixed: boolean } {
  const featureIndicators = [
    { name: '遥控器', patterns: [/rc-hud/i, /ch1/i, /rcState/i] },
    { name: '姿态显示', patterns: [/attitude/i, /pitch/i, /roll/i, /yaw/i] },
    { name: '图表', patterns: [/chart/i, /graph/i, /plot/i] },
    { name: '对话框', patterns: [/dialog/i, /modal/i] },
    { name: '布局', patterns: [/layout/i, /sidebar/i, /header/i] }
  ]

  const foundFeatures: string[] = []

  featureIndicators.forEach(feature => {
    const hasFeature = feature.patterns.some(pattern => pattern.test(content))
    if (hasFeature) {
      foundFeatures.push(feature.name)
    }
  })

  return {
    features: foundFeatures,
    isMixed: foundFeatures.length > 1
  }
}

// 运行所有测试
function runAllTests(): TestResult[] {
  const results: TestResult[] = []
  const testFilePath = path.join(process.cwd(), 'test_component.vue')
  const content = readTestFile(testFilePath)

  console.log('🧪 开始测试 web-vue-standards skill...\n')

  // 测试 1: 组件大小
  const sizeCheck = checkComponentSize(content)
  results.push({
    testName: '组件大小检查',
    passed: sizeCheck,
    issues: sizeCheck ? [] : ['组件超过 200 行'],
    suggestions: sizeCheck ? [] : ['建议将组件拆分为多个小组件']
  })

  // 测试 2: any 类型检查
  const anyCheck = checkAnyTypes(content)
  results.push({
    testName: 'any 类型检查',
    passed: !anyCheck.hasAny,
    issues: anyCheck.hasAny ? anyCheck.locations : [],
    suggestions: anyCheck.hasAny ? ['将 any 替换为具体类型', '使用 unknown 替代 any'] : []
  })

  // 测试 3: 欧拉角检查
  const eulerCheck = checkEulerAngles(content)
  results.push({
    testName: '欧拉角使用检查',
    passed: !eulerCheck.hasEuler,
    issues: eulerCheck.hasEuler ? eulerCheck.locations : [],
    suggestions: eulerCheck.hasEuler ? ['使用四元数替代欧拉角', '避免万向锁问题'] : []
  })

  // 测试 4: 插值检查
  const interpCheck = checkInterpolation(content)
  results.push({
    testName: '插值使用检查',
    passed: interpCheck.hasInterpolation,
    issues: [],
    suggestions: !interpCheck.hasInterpolation ? ['为 3D 移动添加插值', '使用 lerp/slerp 实现平滑过渡'] : []
  })

  // 测试 5: 功能混合检查
  const mixedCheck = checkMixedFeatures(content)
  results.push({
    testName: '功能混合检查',
    passed: !mixedCheck.isMixed,
    issues: mixedCheck.isMixed ? [`发现混合功能: ${mixedCheck.features.join(', ')}`] : [],
    suggestions: mixedCheck.isMixed ? ['按功能拆分组件', '将不同功能移到对应的文件夹'] : []
  })

  return results
}

// 显示测试结果
function displayResults(results: TestResult[]): void {
  let passedCount = 0
  let failedCount = 0

  results.forEach(result => {
    const icon = result.passed ? '✅' : '❌'
    console.log(`${icon} ${result.testName}`)

    if (!result.passed) {
      failedCount++
      console.log('   问题:')
      result.issues.forEach(issue => {
        console.log(`   - ${issue}`)
      })
      console.log('   建议:')
      result.suggestions.forEach(suggestion => {
        console.log(`   - ${suggestion}`)
      })
    } else {
      passedCount++
    }
    console.log()
  })

  console.log('📊 测试总结:')
  console.log(`   通过: ${passedCount}`)
  console.log(`   失败: ${failedCount}`)
  console.log(`   总计: ${results.length}`)
}

// 主函数
function main(): void {
  try {
    const results = runAllTests()
    displayResults(results)

    const allPassed = results.every(r => r.passed)
    if (allPassed) {
      console.log('\n🎉 所有测试通过！')
    } else {
      console.log('\n⚠️  部分测试失败，需要修复代码问题。')
    }
  } catch (error) {
    console.error('测试运行失败:', error)
  }
}

// 运行测试
if (require.main === module) {
  main()
}

export { main, runAllTests, displayResults }