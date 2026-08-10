/**
 * check-legacy-style.ts — 检查是否使用了过时的 JavaScript 语法
 *
 * 项目推荐使用现代 ES6/ES7 语法（const/let/箭头函数/数组方法），
 * 而不是过时的传统语法（var/function/for 循环）。
 *
 * 此脚本扫描指定文件或目录，报告可能使用了过时语法的代码模式。
 *
 * 用法：
 *   ts-node scripts/check-legacy-style.ts web/src/stores/chart.ts
 *   ts-node scripts/check-legacy-style.ts web/src/stores/
 */

import * as fs from 'fs';
import * as path from 'path';

interface LegacyStyleIssue {
  file: string;
  line: number;
  type: 'var' | 'old-function' | 'traditional-for' | 'indexof-vs-includes';
  description: string;
  suggestion: string;
}

function checkFile(filePath: string): LegacyStyleIssue[] {
  const issues: LegacyStyleIssue[] = [];

  if (!fs.existsSync(filePath)) {
    console.error(`文件不存在: ${filePath}`);
    return issues;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const trimmed = line.trim();

    // 跳过注释行
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      return;
    }

    // 检查 var（排除 import 和 type 声明）
    if (!trimmed.startsWith('import ') && !trimmed.startsWith('type ')) {
      const varMatch = trimmed.match(/\bvar\s+\w+/);
      if (varMatch && !trimmed.includes(' = useState') && !trimmed.includes(' = useRef')) {
        issues.push({
          file: filePath,
          line: lineNum,
          type: 'var',
          description: '使用了 var',
          suggestion: '考虑使用 const/let（现代 ES6 语法）'
        });
      }
    }

    // 检查过时的 function 声明（排除类方法和接口）
    if (trimmed.match(/^function\s+\w+/)) {
      issues.push({
        file: filePath,
        line: lineNum,
        type: 'old-function',
        description: '使用了传统 function 声明',
        suggestion: '考虑使用箭头函数或 const（现代 ES6 语法）'
      });
    }

    // 检查传统 for 循环
    const traditionalFor = trimmed.match(/for\s*\(\s*(var|let)\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*\w+\.length\s*;\s*\w+\+\+\s*\)/);
    if (traditionalFor) {
      issues.push({
        file: filePath,
        line: lineNum,
        type: 'traditional-for',
        description: '使用了传统 for 循环',
        suggestion: '考虑使用数组方法（.map()/.filter()/.reduce()）或 for...of'
      });
    }

    // 检查 indexOf !== -1（可以替换为 includes）
    const indexOfMatch = trimmed.match(/\.indexOf\s*\(/);
    if (indexOfMatch && trimmed.includes('>= 0') || trimmed.includes('!== -1') || trimmed.includes('>-1')) {
      issues.push({
        file: filePath,
        line: lineNum,
        type: 'indexof-vs-includes',
        description: '使用 indexOf 检查存在',
        suggestion: '考虑使用 .includes()（更语义化的现代方法）'
      });
    }
  });

  return issues;
}

function checkDirectory(dirPath: string): LegacyStyleIssue[] {
  let allIssues: LegacyStyleIssue[] = [];

  if (!fs.existsSync(dirPath)) {
    console.error(`目录不存在: ${dirPath}`);
    return allIssues;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // 递归检查子目录
      allIssues = allIssues.concat(checkDirectory(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.vue'))) {
      // 检查 TypeScript 和 Vue 文件
      allIssues = allIssues.concat(checkFile(fullPath));
    }
  }

  return allIssues;
}

function printReport(issues: LegacyStyleIssue[]): void {
  if (issues.length === 0) {
    console.log('✅ 没有发现过时语法！代码使用了现代 ES6+ 语法。');
    return;
  }

  console.log(`⚠️  发现 ${issues.length} 个潜在的过时语法问题：\n`);

  // 按类型分组
  const byType = issues.reduce((acc, issue) => {
    if (!acc[issue.type]) {
      acc[issue.type] = [];
    }
    acc[issue.type].push(issue);
    return acc;
  }, {} as Record<string, LegacyStyleIssue[]>);

  for (const [type, typeIssues] of Object.entries(byType)) {
    console.log(`\n${type.toUpperCase()} 问题 (${typeIssues.length} 个)：`);
    typeIssues.slice(0, 5).forEach(issue => { // 每个类型只显示前 5 个
      const relativePath = path.relative(process.cwd(), issue.file);
      console.log(`  - ${relativePath}:${issue.line}`);
      console.log(`    ${issue.description}`);
      console.log(`    💡 ${issue.suggestion}`);
    });

    if (typeIssues.length > 5) {
      console.log(`  ... 还有 ${typeIssues.length - 5} 个相同类型的问题`);
    }
  }

  console.log('\n提示：这些问题只是提醒，不是强制要求。但推荐使用现代语法提升代码质量。');
}

// 主函数
function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('用法: ts-node scripts/check-legacy-style.ts <文件或目录路径>');
    console.log('示例: ts-node scripts/check-legacy-style.ts web/src/stores/chart.ts');
    console.log('      ts-node scripts/check-legacy-style.ts web/src/stores/');
    process.exit(1);
  }

  const target = args[0];
  let issues: LegacyStyleIssue[] = [];

  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    issues = checkDirectory(target);
  } else if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    issues = checkFile(target);
  } else {
    console.error(`路径不存在或无效: ${target}`);
    process.exit(1);
  }

  printReport(issues);
}

// 如果直接运行此脚本
if (require.main === module) {
  main();
}

export { checkFile, checkDirectory, LegacyStyleIssue };
