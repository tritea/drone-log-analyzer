/**
 * 拆分大型 Vue 文件脚本
 *
 * 当 Vue 文件超过 200 行时，自动拆分为多个小组件
 */

interface ComponentAnalysis {
  lineCount: number
  features: string[]
  suggestedSplit: ComponentSplit[]
}

interface ComponentSplit {
  featureName: string
  componentName: string
  lines: [number, number]
  reason: string
}

export function analyzeVueFile(content: string): ComponentAnalysis {
  const lines = content.split('\n')
  const lineCount = lines.length

  // 识别不同的功能块
  const features: string[] = []
  const splits: ComponentSplit[] = []

  if (lineCount <= 200) {
    return { lineCount, features, suggestedSplit: [] }
  }

  // 检测模板中的功能块
  const templateMatches = content.matchAll(/<!--\s*(\w+)\s*-->/g)
  for (const match of templateMatches) {
    const featureName = match[1]
    features.push(featureName)
  }

  // 检测不同的 div 块（有 class 或 id）
  const divMatches = content.matchAll(/<div\s+(class|id)="([^"]+)"/g)
  const currentBlocks: { name: string; startLine: number; content: string[] }[] = []

  lines.forEach((line, index) => {
    const divMatch = line.match(/<div\s+(class|id)="([^"]+)"/)
    if (divMatch) {
      const blockName = divMatch[2].replace(/\s+/g, '-')
      currentBlocks.push({
        name: blockName,
        startLine: index + 1,
        content: [line]
      })
    } else if (currentBlocks.length > 0) {
      currentBlocks[currentBlocks.length - 1].content.push(line)
    }
  })

  // 生成拆分建议
  currentBlocks.forEach(block => {
    if (block.content.length > 20) {
      splits.push({
        featureName: block.name,
        componentName: `${capitalize(block.name)}Component.vue`,
        lines: [block.startLine, block.startLine + block.content.length],
        reason: `大型功能块 (${block.content.length} 行)`
      })
    }
  })

  return { lineCount, features, suggestedSplit: splits }
}

export function generateComponentFile(
  componentName: string,
  featureName: string,
  originalContent: string
): string {
  // 提取相关的模板、脚本和样式
  const template = extractTemplate(originalContent, featureName)
  const script = extractScript(originalContent, featureName)
  const style = extractStyle(originalContent, featureName)

  return `<template>
  <!-- ${featureName} -->
  ${template}
</template>

<script setup lang="ts">
${script}
</script>

<style scoped>
${style}
</style>
`
}

export function updateOriginalFile(
  originalContent: string,
  splits: ComponentSplit[]
): string {
  let updatedContent = originalContent

  // 为每个拆分的组件生成导入语句
  const imports = splits.map(split => {
    return `import ${split.componentName.replace('.vue', '')} from './${split.componentName}'`
  })

  // 在 <script setup> 顶部添加导入
  const scriptSetupMatch = updatedContent.match(/<script setup lang="ts">/)
  if (scriptSetupMatch) {
    const insertPosition = updatedContent.indexOf(scriptSetupMatch[0]) + scriptSetupMatch[0].length
    updatedContent =
      updatedContent.slice(0, insertPosition) +
      '\n' +
      imports.join('\n') +
      '\n' +
      updatedContent.slice(insertPosition)
  }

  // 替换拆分的内容为组件引用
  splits.forEach(split => {
    const componentName = split.componentName.replace('.vue', '')
    const kebabName = camelToKebab(componentName)
    const replacement = `<${kebabName} />`

    // 简单替换（实际需要更精确的位置匹配）
    updatedContent = updatedContent.replace(
      new RegExp(`<!--\\s*${split.featureName}\\s*-->[\\s\\S]*?<!--\\s*/${split.featureName}\\s*-->`, 'g'),
      replacement
    )
  })

  return updatedContent
}

function extractTemplate(content: string, featureName: string): string {
  // 提取特定功能的模板内容
  const regex = new RegExp(
    `<!--\\s*${featureName}\\s*-->[\\s\\S]*?(?=<!--|$)`,
    'g'
  )
  const match = content.match(regex)
  return match ? match[0].replace(/<!--.*?-->/g, '').trim() : ''
}

function extractScript(content: string, featureName: string): string {
  // 提取特定功能的脚本内容
  // 这里简化实现，实际需要更复杂的解析
  return '// TODO: 提取相关逻辑\nconst props = defineProps<{}>()\n'
}

function extractStyle(content: string, featureName: string): string {
  // 提取特定功能的样式
  return `.${featureName} {\n  /* TODO: 添加样式 */\n}\n`
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}