/**
 * Skill 功能验证脚本
 *
 * 验证 web-vue-standards skill 是否能正确识别代码问题
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取测试文件
const testFilePath = path.join(process.cwd(), 'test_component.vue');
const content = fs.readFileSync(testFilePath, 'utf-8');

console.log('🔍 开始分析测试文件...\n');

// 检查 1: any 类型使用
const anyPattern = /:\s*any\b/g;
const anyMatches = content.match(anyPattern);
console.log(`📌 any 类型检查:`);
if (anyMatches) {
  console.log(`   ❌ 发现 ${anyMatches.length} 处使用 any 类型`);
  content.split('\n').forEach((line, index) => {
    if (anyPattern.test(line)) {
      console.log(`   - 第 ${index + 1} 行: ${line.trim()}`);
    }
  });
} else {
  console.log('   ✅ 未发现 any 类型');
}
console.log();

// 检查 2: 欧拉角使用
const eulerPatterns = [/rotation\.set\(/, /rotation\.[xyz]\s*=/, /new THREE\.Euler\(/];
console.log('📌 欧拉角使用检查:');
let eulerFound = false;
content.split('\n').forEach((line, index) => {
  if (eulerPatterns.some(pattern => pattern.test(line))) {
    console.log(`   ⚠️  第 ${index + 1} 行: ${line.trim()}`);
    eulerFound = true;
  }
});
if (!eulerFound) {
  console.log('   ✅ 未发现直接欧拉角操作');
} else {
  console.log('   ❌ 建议使用四元数替代欧拉角');
}
console.log();

// 检查 3: 插值使用
console.log('📌 插值使用检查:');
const hasLerp = content.includes('.lerp(');
const hasSlerp = content.includes('.slerp(');
if (hasLerp || hasSlerp) {
  console.log('   ✅ 发现插值使用');
} else {
  console.log('   ⚠️  未发现插值，建议为 3D 移动添加平滑过渡');
}
console.log();

// 检查 4: 功能混合
console.log('📌 功能混合检查:');
const features = [];
if (/rc-hud|rcState|ch1/i.test(content)) features.push('遥控器');
if (/attitude|pitch|roll/i.test(content)) features.push('姿态显示');
if (/chart|graph/i.test(content)) features.push('图表');

if (features.length > 1) {
  console.log(`   ⚠️  发现混合功能: ${features.join(', ')}`);
  console.log('   ❌ 建议拆分为独立组件');
} else {
  console.log('   ✅ 功能单一');
}
console.log();

// 检查 5: 组件大小
console.log('📌 组件大小检查:');
const lineCount = content.split('\n').length;
if (lineCount > 200) {
  console.log(`   ❌ 组件过大: ${lineCount} 行 (建议 < 200 行)`);
} else {
  console.log(`   ✅ 组件大小合理: ${lineCount} 行`);
}
console.log();

console.log('📊 分析完成！');
console.log('💡 建议: 创建一个符合规范的组件作为示例');