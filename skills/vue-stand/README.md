# Web Vue Standards Skill

飞控日志分析器（Drone Log Analyzer）前端的 Vue 3 + TypeScript 开发规范。

> 规范以项目**当前真实写法**为准：源码在 `frontend/src/`，Pinia **setup store**（`defineStore(name, () => {...})` + `reactive()`/`computed()`），后端调用经 `services/{log,map,config}` 的 client（不走 HTTP `/api`），主图是自绘 `CurveChart`（无 ECharts），`<script setup>` + `storeToRefs`。完整内容见 [SKILL.md](./SKILL.md)。

## 核心规范

1. **路径/目录** —— `frontend/src/`；**没有 `core/`**（共享逻辑在 `utils/`/`stores/`/`constants/`/`types/`）；有 `composables/`。`package.json` 在仓库根。
2. **状态管理** —— Pinia **setup store**，一域一文件；state 用 `reactive()` + `as XxxState`；派生用 `computed()`；逻辑用普通函数。**没有 `this`**，不需要 `const self = this`。
3. **后端调用** —— 经 `services/{log,map,config}` 的 client（接口 + Wails 实现 + `index.ts` 接线）。**不要** `api()` / `fetch('/api/...')` / 直接碰 `wailsjs`。换传输只改 `index.ts`。
4. **异步** —— `async/await` + try/catch/finally；多个独立请求 `Promise.all`；用户错误 `showToast(msg, 'error')`（来自 `@/utils`）；`loading` 标志必须能复位。
5. **组件** —— `<script setup lang="ts">`，state 经 `storeToRefs`，函数直接解构，props 用泛型 `defineProps`；超 ~200 行或功能混杂就拆。
6. **非响应式重对象** —— `CurveChart` / Three.js / MapLibre / Leaflet 实例 + timer 句柄放 [`modules/shared/runtime.ts`](../../frontend/src/modules/shared/runtime.ts)，不进 Pinia state。
7. **类型** —— 模型集中 `types/index.ts`，避免新增无谓 `any`（client 返回的存量 `any` 可接受）。
8. **3D/地图** —— 位置 lerp、旋转四元数 slerp；硬核规则见 [../frontend-3d-map/SKILL.md](../frontend-3d-map/SKILL.md)。
9. **依赖** —— npm + ES import，禁止 CDN / `window.XXX`。

## 触发场景

新建/修改 Vue 组件、写/改 Pinia store、加后端调用、重构、补类型、处理 Three.js / MapLibre / Leaflet / 自绘图表逻辑；提到关键词 `组件`/`vue`/`前端`/`typescript`/`pinia`/`store`/`状态管理`/`接口`/`api`/`异步`/`3d`/`three`/`maplibre`/`leaflet`/`图表`。

## 辅助脚本

`scripts/` 下（按需调用，非强制）：`fix-any-types` / `split-component` / `add-interpolation` / `euler-to-quaternion` / `organize-components` / `check-legacy-style`。

## 目录结构

```
web-vue-standards/
├── SKILL.md     # 主规范（触发后加载）
├── README.md    # 本文件
├── USAGE.md     # 使用指南 + 示例
├── scripts/     # 辅助扫描/修复脚本
└── evals/       # 测试用例
```

## 相关资源

- [docs/frontend.md](../../docs/frontend.md) —— 前端架构背景
- [../frontend-3d-map/SKILL.md](../frontend-3d-map/SKILL.md) —— 3D/MapLibre 渲染规则
- [../../AGENTS.md](../../AGENTS.md) —— 开发约束/模块边界
