/**
 * 组件目录重组脚本
 *
 * 检测组件是否在正确的功能文件夹中，自动移动到正确位置
 */

interface ComponentMove {
  fromPath: string
  toPath: string
  reason: string
}

interface FolderStructure {
  [key: string]: string[] // 功能名 -> 组件列表
}

// 定义功能文件夹映射
const FUNCTIONAL_FOLDERS: FolderStructure = {
  chart: ['MainChart', 'ChartLegend', 'ChartToolbar', 'ChartAxis', 'ChartTooltip'],
  three: [
    'ThreeView',
    'RcHud',
    'AttitudePanel',
    'FlightMetricsGrid',
    'ThreeTimeline',
    'ThreeCurveAxis',
    'CameraControl',
    'Object3D'
  ],
  dialogs: [
    'ParametersDialog',
    'CommandsDialog',
    'AnomalyConfigDialog',
    'SimplePickerDialog',
    'TemplateDeleteDialog',
    'TemplateExportDialog',
    'SettingsDialog'
  ],
  layout: [
    'CenterStage',
    'CurveSidebar',
    'DataSidebar',
    'DropOverlay',
    'WelcomeScreen',
    'AppLayout'
  ],
  curves: ['CurveCard', 'CurveGroupCard', 'CurveList', 'CurveEditor'],
  templates: ['TemplateItem', 'SimpleTemplateList', 'TemplateEditor'],
  header: ['AppHeader', 'HeaderToolbar'],
  messages: ['MessageList', 'NotificationPanel'],
  types: ['TypeTree', 'FieldLeaf', 'TypeSelector']
}

export function detectMisplacedComponents(files: string[]): ComponentMove[] {
  const moves: ComponentMove[] = []

  files.forEach(file => {
    const componentName = file
      .replace(/.*\//, '')
      .replace(/\.vue$/, '')

    const currentPath = file.replace(/.*\/components\//, '')

    // 检查组件是否应该在特定文件夹
    for (const [folder, components] of Object.entries(FUNCTIONAL_FOLDERS)) {
      if (components.includes(componentName)) {
        const expectedPath = `${folder}/${componentName}.vue`

        if (currentPath !== expectedPath) {
          moves.push({
            fromPath: file,
            toPath: `components/${expectedPath}`,
            reason: `${componentName} 属于 ${folder} 功能`
          })
        }
        break
      }
    }
  })

  return moves
}

export function generateFolderStructure(): string {
  let output = '# 推荐的组件目录结构\n\n'
  output += '```\nweb/src/components/\n'

  Object.entries(FUNCTIONAL_FOLDERS).forEach(([folder, components]) => {
    output += `${folder}/\n`
    components.forEach(comp => {
      output += `  ├── ${comp}.vue\n`
    })
    output += `  └── index.ts (导出该文件夹的所有组件)\n\n`
  })

  output += '```\n\n'
  output += '## 使用方式\n\n'
  output += '```typescript\n'
  output += '// 从特定功能文件夹导入\n'
  output += "import { ChartLegend } from '@/components/chart'\n"
  output += "import { RcHud } from '@/components/three'\n"
  output += "import { ParametersDialog } from '@/components/dialogs'\n"
  output += '```\n'

  return output
}

export function createIndexFiles(): Record<string, string> {
  const indexFiles: Record<string, string> = {}

  Object.entries(FUNCTIONAL_FOLDERS).forEach(([folder, components]) => {
    indexFiles[`components/${folder}/index.ts`] = components
      .map(name => {
        const camelName = name
        return `export { default as ${camelName} } from './${name}.vue'`
      })
      .join('\n')
  })

  return indexFiles
}

export function generateMoveScript(moves: ComponentMove[]): string {
  let script = '#!/bin/bash\n# 组件移动脚本\n\n'

  moves.forEach(move => {
    const from = move.fromPath
    const to = move.toPath
    script += `# ${move.reason}\n`
    script += `mkdir -p "$(dirname "${to}")"\n`
    script += `git mv "${from}" "${to}"\n\n`
  })

  return script
}

export function suggestNewFolder(
  componentName: string,
  componentContent: string
): string {
  // 基于组件内容推断功能类别
  const content = componentContent.toLowerCase()

  if (content.includes('three') || content.includes('3d') || content.includes('quaternion')) {
    return 'three'
  }
  if (content.includes('chart') || content.includes('graph') || content.includes('plot')) {
    return 'chart'
  }
  if (content.includes('dialog') || content.includes('modal') || content.includes('popup')) {
    return 'dialogs'
  }
  if (content.includes('layout') || content.includes('sidebar') || content.includes('header')) {
    return 'layout'
  }
  if (content.includes('curve') || content.includes('param')) {
    return 'curves'
  }
  if (content.includes('template') || content.includes('preset')) {
    return 'templates'
  }
  if (content.includes('message') || content.includes('notification')) {
    return 'messages'
  }

  // 如果无法明确分类，建议放在 common 或根据具体功能创建新文件夹
  return 'common'
}

export function analyzeComponentClusters(files: string[]): FolderStructure {
  // 分析现有组件，识别可能的新功能组
  const clusters: FolderStructure = { ...FUNCTIONAL_FOLDERS }

  // 检测未分类的组件
  const unclassified = files.filter(file => {
    const componentName = file.replace(/.*\//, '').replace(/\.vue$/, '')
    return !Object.values(clusters).some(components =>
      components.includes(componentName)
    )
  })

  // 基于命名和内容聚类
  unclassified.forEach(file => {
    // 这里简化实现，实际应该读取文件内容进行分析
    // 可以使用文本相似度算法来分组
  })

  return clusters
}