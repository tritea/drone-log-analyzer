---
name: web-vue-standards
description: 飞控日志分析器（Drone Log Analyzer）前端的 Vue 3 + TypeScript 开发规范。规范以项目**当前真实写法**为准：前端源码在 `frontend/src/`（不是 `web/src/`），状态管理用 Pinia **setup store**（`defineStore(name, () => {...})` + `reactive()`/`computed()`，不是 Options Store），后端调用经 `services/{log,map,config}` 的 client（接口 + Wails 实现，**不是** `fetch('/api/')`），主图是自绘 `CurveChart`（**不是** ECharts）。在所有涉及前端代码工作时必须应用——新建/修改组件、写 store、加后端调用、重构、补类型、处理 3D（Three.js）/地图（MapLibre/Leaflet）/图表逻辑。当用户提到「组件」「vue」「前端」「typescript」「pinia」「store」「状态管理」「接口」「api」「异步」「3d」「three」「maplibre」「leaflet」「图表」等关键词时触发。
---

# Vue 3 + TypeScript 前端开发规范

本规范定义 Drone Log Analyzer 前端（`frontend/src/`）的开发标准。**所有示例都来自项目真实代码**，目标是让新增/修改的代码与现有架构保持一致。

技术栈：Vue 3（`<script setup>` + Composition API）+ Pinia 3（**setup store**）+ Three.js r160 + MapLibre GL 5.24 + Leaflet 1.9，TypeScript，Vite 5 编译，Go embed。**主图是自绘 [`CurveChart`](../../frontend/src/modules/analysis/renderer/curve-chart.ts)，不用 ECharts。**

> 架构背景（目录为什么这样分、传输 client 为什么这样设计、runtime 为什么存在）见 [docs/frontend.md](../../docs/frontend.md)；3D/地图渲染的硬核规则见 [frontend-3d-map](../frontend-3d-map/SKILL.md)。本文件只讲「怎么写才一致」。

## 0. 先记住这几条（项目特有的「坑」）

| 别写成 | 要写成 | 原因 |
|---|---|---|
| `web/src/...` | `frontend/src/...` | 目录早就改名了 |
| `core/api.ts` 的 `api()` / `fetch('/api/...')` | `import { logClient } from '@/services/log'` 等服务 client | 前端不再走 HTTP，走 Wails 绑定 |
| Pinia **Options Store**（`{ state, getters, actions }`） | Pinia **setup store**（`defineStore(name, () => {...})`） | 全项目 13 个 store 都是 setup 写法 |
| `this.xxx` / `const self = this` | 闭包变量 `xxx`（setup store 直接引用 `reactive` 对象） | setup store 没有 `this` |
| `@/core/types` / `@/core/util` / `@/core/runtime` | `@/types` / `@/utils` / `@/utils/runtime` | 没有 `core/` 目录 |
| `echarts.init(el)` | `new CurveChart(el, ...)`（放 `runtime.mainChart`） | ECharts 已移除，主图自绘 |
| 「项目没有 `composables/`」 | 有 `composables/`（如 `useToolbarOverflow`） | 别再说没有 |

## 1. 目录结构（对齐真实代码）

```
frontend/src/
├── main.ts / App.vue / lifecycle.ts   启动：createApp + createPinia + 挂载 + window 监听
├── stores/          Pinia setup store，一域一文件
├── services/{log,map,config}/   传输 client：接口 + Wails 实现，换传输只改 index.ts
├── profiles/        格式无关的字段源映射（apm/ulog）
├── modules/analysis/   分析域：renderer/（自绘 CurveChart + 刻度/配色）、store/（data/view/curves 三域工厂）、utils/（曲线二进制解析）
├── utils/           runtime.ts（非响应式重对象容器）/ dom / colors / drone-model / geo / maplibre-drone-layer / flight-fields / showToast
├── types/           所有状态/数据类型（store state 用 as XxxState 挂类型）
├── constants/       阈值/颜色常量
├── composables/     组合式逻辑（useToolbarOverflow）
├── components/      charts / common / curves / dialogs / fields / map / three + views/Home
└── wailsjs/         Wails 生成的前端绑定 —— 勿手改
```

**注意**：本项目**没有** `core/` 目录。共享逻辑在 `utils/`、`stores/` 的函数、`constants/`、`types/`。`package.json`/`node_modules/` 在**仓库根**，不在 `frontend/`。

### 文件大小与拆分

- 单个 `.vue`/`.ts` 目标几百行；接近/超过 ~800 行就拆。
- **拆分用文件夹包裹**：大组件拆成「`<域>/index.vue` + `<域>/components/` 子组件」——项目已有范例 [`views/Home/`](../../frontend/src/views/Home)（`index.vue` + `components/CenterStage.vue` / `DataSidebar.vue` / ...）。**不要**在同级目录摊一堆兄弟文件。
- **组件归位**：按功能进对应子目录（`components/charts`、`components/three`、`components/map`...），别散落在根 `components/`。
- **类型/常量按作用域放**：**跨域共享**的进中心 [`types/index.ts`](../../frontend/src/types/index.ts)（如 `UiState`/`LogState` 这类跨 store 的状态类型）、[`constants/index.ts`](../../frontend/src/constants/index.ts)；**只在一个文件夹内用的**，就地放该文件夹的 `types.ts`/`const.ts`（或域命名的 `xxxx.ts`），不塞进中心、也不散到根。范例：[`services/log/types.ts`](../../frontend/src/services/log/types.ts)、[`chart/types.ts`](../../frontend/src/chart/types.ts) 是文件夹私有类型。需要私有 `types.ts`/`const.ts` 的模块，本身就该是个**文件夹**。

## 2. 状态管理：Pinia setup store（核心）

所有跨组件共享状态进 Pinia store，组件不自己持有。统一 **setup store** 写法：`defineStore(name, () => {...})`，state 用 `reactive()`，派生用 `computed()`，逻辑用普通函数（不是 Options 的 getters/actions）。

### 2.1 纯状态域

```typescript
// stores/ui.ts
import { defineStore } from 'pinia';
import { reactive } from 'vue';
import type { UiState } from '@/types';

export const useUiStore = defineStore('ui', () => {
  const ui = reactive({
    mainView: 'chart',
    simpleFieldFilter: '',
    dragOver: false,
    toast: null,
  }) as UiState;
  return { ui };
});
```

### 2.2 带逻辑的域：computed + 函数

```typescript
// stores/log.ts（节选）
export const useLogStore = defineStore('log', () => {
  const log = reactive({ loading: false, summary: null, messages: [], /* ... */ }) as LogState;

  // 派生：只依赖本域直接用闭包变量
  const currentLogFileName = computed<string>(() => { /* ... */ });

  // 跨域派生：在 computed 内部调其它 store（惰性，避开循环依赖初始化）
  const filteredMessages = computed<LogMessage[]>(() => {
    if (!log.messageFilter) return log.messages;
    const q = log.messageFilter.toLowerCase();
    return log.messages.filter((m) =>
      String(m.message || '').toLowerCase().includes(q) ||
      useChartStore().formatMessageTime(m).toLowerCase().includes(q));
  });

  // 写状态的逻辑写成普通函数，直接读写 log.xxx（没有 this）
  async function loadMessages(): Promise<void> {
    try {
      const items = await logClient.messages();
      log.messages = Array.isArray(items) ? items : [];
    } catch {
      log.messages = [];
    }
  }

  return { log, currentLogFileName, filteredMessages, loadMessages };
});
```

要点：

- **state 是 `reactive()` 对象**，用 `as XxxState` 挂 [`@/types`](../../frontend/src/types/index.ts) 的类型；store id = 文件名 = `useXxxStore`。
- **没有 `this`**：setup store 的函数直接引用闭包里的 `reactive` 对象。旧式的 `const self = this` 在这里无意义。
- **跨 store 调用写在 setup 函数 / `computed` / 普通函数体内**（不在模块顶层）——模块顶层 `const ui = useUiStore()` 会在 store 未注册时执行，触发 "no active pinia"。

### 大 store 靠顺序收敛（不硬拆）

一个 store 围绕同一业务域，state/派生/函数耦合紧，**不要**为减行数强行拆成多个文件（拆完还要互相 import 大量内部细节 = 割裂）。改用统一的**垂直顺序**让它易读——[`stores/log.ts`](../../frontend/src/stores/log.ts) 即此范本：

1. imports
2. `defineStore('<id>', () => {`
3. `reactive()` state（`as XxxState`）
4. `computed()`（先本域派生，后跨域派生）
5. async 函数（拉数据：`loadXxx`）
6. 同步函数（写状态 / 业务逻辑）
7. `return { ... }`
8. `})`

命名统一：store id = 文件名 = `useXxxStore`；state 顶层对象用短域名（`log`/`chart`/`three`...）；加载类函数统一 `loadXxx`、写状态类见名知意。store 大没关系，**顺序一致 + 命名统一**就耐读。

## 3. 后端调用：services client（核心）

**前端不再走 HTTP `/api`**。后端调用经 [`services/{log,map,config}`](../../frontend/src/services) 的 client，每个域三件套：

```
services/log/
├── client.ts       接口 LogClient（镜像后端 LogService 方法）
├── types.ts        后端 DTO 的 TS 镜像
├── wails/client.ts Wails 实现：调 @/wailsjs/go/wails/LogAPI，二进制端点归一化为 ArrayBuffer
└── index.ts        导出当前传输实例：export const logClient = wailsLogClient
```

store 里 `import { logClient } from '@/services/log'` 直接用，**不散落 `fetch`、不直接碰 `wailsjs`**：

```typescript
import { logClient } from '@/services/log';

async function loadErrors() {
  try { log.errors = await logClient.errors() ?? []; }
  catch { log.errors = []; }
}
```

`index.ts` 是唯一知道「当前用 Wails」的地方；未来切 http 只需新增 `http/client.ts` 并改 `index.ts` 的导出，各 store 无需改动。文件加载走 `hostClient.pickLogPath()`（`HostAPI.PickLogPath` 原生对话框）+ `logClient.load({path})`。

> **注意二进制端点**：Wails v2 经 JSON IPC 把 Go `[]byte` 编成 **base64 字符串**（`.d.ts` 标 `Array<number>` 只是类型映射）。`services/*/wails/client.ts` 的 `toBuffer()` 已统一解码成 `ArrayBuffer`，调用方按 `DataView` 消费即可。

## 4. 异步：async/await + try/catch

不要用裸 `.then()` 链。多个独立请求用 `Promise.all([...])` 并行。用户可见错误用 `showToast(msg, 'error')`（来自 [`@/utils`](../../frontend/src/utils/index.ts)）。需要复位的标志（`loading`/`restoring`）放 `finally`，或像下面这样在 `catch` 里兜底：

```typescript
async function loadMessages() {
  try {
    log.loading = true;                    // 前置 loading
    const items = await logClient.messages();
    log.messages = Array.isArray(items) ? items : [];
  } catch {
    log.messages = [];                      // 异常路径兜底，不静默吞错
  } finally {
    log.loading = false;                    // 必须复位
  }
}
```

## 5. 组件：`<script setup>` + storeToRefs

组件只做「展示 + 转发用户操作到 store」。共享状态从 store 拿，不在组件里 `ref` 一份：

```vue
<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useLogStore } from '@/stores/log';

const logStore = useLogStore();
const { log } = storeToRefs(logStore);          // state 必须经 storeToRefs 才保响应式
const { loadMessages } = logStore;              // 函数直接解构没问题
</script>
```

- **state 要 `storeToRefs`**：直接 `const { log } = storeStore` 解构丢响应式。
- **props 用泛型 `defineProps<{ ... }>()`**，不用运行时对象写法。
- 模板 ref 通过 store 的注册函数（如 `:ref="registerThreeMain"`）让 store 拿到 DOM，不在组件里持有 chart/three 实例。
- 单个 `.vue` 职责单一；超 ~200 行或出现多个无关功能块，拆成同目录小组件。

## 6. 非响应式重对象：`runtime`

`CurveChart` 实例、Three.js 视图、MapLibre/Leaflet 地图、RAF/timer 句柄这些**不该进响应式系统**的重对象，统一放 [`modules/shared/runtime.ts`](../../frontend/src/modules/shared/runtime.ts) 的模块级容器：

```typescript
import { runtime } from '@/utils/runtime';

if (!runtime.mainChart) runtime.mainChart = new CurveChart(el, dataset, options);
```

```typescript
export const runtime: {
  mainChart: CurveChart | null;        // 自绘主图（不是 echarts）
  threeView: ThreeView | null;
  threeCurveChart: CurveChart | null;
  mapView: MapRuntime | null;          // Leaflet
  mapLibreView: MapLibreRuntime | null; // MapLibre 3D
  chartInteractionsBound: boolean;
} = { /* ...null... */ };
```

用对象容器（而非导出变量）是因为 ES 模块导入绑定只读、不能重新赋值，而 `runtime.mainChart` 需要被替换。

## 7. 类型安全

- 业务模型集中在 [`types/index.ts`](../../frontend/src/types/index.ts)，store state 用 `as XxxState` 挂类型；联合类型优于枚举。
- 应用代码避免 `any`；外部/不可信数据用 `unknown` 再收窄。
- **现实取舍**：服务 client 返回的对接后端 JSON 的局部变量常用 `any`/`as any` 兜底（后端返回结构未强类型化）。新代码尽量给响应定义类型并收窄，但**不必为存量 `any` 强行改造**。

## 8. 3D / 地图

- 3D 世界的位置用 **lerp 插值**、旋转用**四元数 slerp**（避免万向锁、避免数据跳变）；不要直接赋原始值或欧拉角。逻辑集中在 [`stores/three.ts`](../../frontend/src/stores/three.ts)。
- 3D/MapLibre 自定义图层有一批硬核规则（floating-origin、constant-screen-size、altitude 基准、GLSL ES 1.00、lock/chase 相机），**动 3D/地图前先读** [frontend-3d-map](../frontend-3d-map/SKILL.md)。
- 姿态/位置/RC/电机字段源按日志格式取，经 [`profiles/`](../../frontend/src/profiles) 抽象，**不写死格式名**；新格式只加 profile 文件。

## 9. 依赖管理

依赖走 npm（根 `package.json`），代码里 ES import；禁止 CDN `<script>` 与 `window.XXX` 全局变量。

```typescript
// ✅
import * as THREE from 'three';
import { CurveChart } from '@/modules/analysis';
// ❌
const scene = new (window as any).THREE.Scene();
```

---

## 反模式速查（出现即改）

| 反模式 | 正确做法 |
|---|---|
| `web/src/...` 路径 | `frontend/src/...` |
| Pinia Options Store / `this.xxx` / `const self = this` | setup store（`defineStore(n, () => {...})`，闭包变量） |
| `api()` / `fetch('/api/...')` / 直接碰 `wailsjs` | `import { logClient } from '@/services/log'` 等 client |
| `@/core/types` / `@/core/util` / `@/core/runtime` | `@/types` / `@/utils` / `@/utils/runtime` |
| `echarts.init(el)` | `new CurveChart(...)`（放 `runtime.mainChart`） |
| 组件里 `ref()` 持有共享状态 | 放进对应 Pinia store |
| 用 `.then().catch()` 链做异步 | `async/await` + try/catch/finally |
| `loading` 没复位 / 异常被静默吞掉 | `finally` 复位 / `catch` 兜底 + `showToast` |
| 直接解构 store 拿 state（丢响应式） | `storeToRefs(store)` |
| 把 CurveChart/Three/MapLibre 实例塞进 Pinia state | 放 `runtime` |
| `camera.rotation.set(euler)` / 直接赋位置 | 四元数 slerp / 位置 lerp |
| 单文件 >~800 行不拆 | 拆成小文件，用文件夹包裹（`<域>/index.vue` + `<域>/components/`） |
| 拆出的文件在同级摊一堆 | 放进以域命名的文件夹 |
| 大 store 为减行数硬拆 | 不拆，用统一垂直顺序收敛（state→computed→async→sync→return） |
| `any` 绕过自己写的类型 | 定义接口或 `unknown` 收窄（存量 client `any` 可接受） |
| CDN / `window.XXX` | npm + ES import |

## 工作流程

1. **路径对吗？** `frontend/src/`，没有 `core/`。
2. **共享状态？** 进 Pinia **setup store**（`reactive` + `computed` + 普通函数，无 `this`）。
3. **调后端？** 经 `services/{log,map,config}` 的 client，`async/await` + try/catch。
4. **组件取数？** `storeToRefs` 拿 state，直接解构拿函数。
5. **重对象？** CurveChart/Three/Map → `runtime`。
6. **类型？** 模型进 `types/`；避免新增无谓 `any`。
7. **3D/地图？** 插值 + 四元数；先读 [frontend-3d-map](../frontend-3d-map/SKILL.md)。

## 附带的辅助脚本（`scripts/`）

扫描/辅助修复用，**不是必须运行**，检测到对应问题时按需调用：`fix-any-types.ts`、`split-component.ts`、`add-interpolation.ts`、`euler-to-quaternion.ts`、`organize-components.ts`、`check-legacy-style.ts`。
