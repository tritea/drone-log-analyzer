# 前端架构

> 本文讲清 `frontend/` 的目录布局、状态管理、传输 client、3D/地图/chart 模块。后端契约见 [architecture.md](architecture.md)；接口字段见 [api.md](api.md)；3D/地图渲染的硬核规则见 [skills/frontend-3d-map](../skills/frontend-3d-map)。

技术栈：Vue 3（`<script setup>` + Composition API）+ Pinia 3（**setup store**）+ Three.js r160 + MapLibre GL 5.24 + Leaflet 1.9，TypeScript，Vite 5 编译。**主图是自绘 `LineChart`（[chart/line-chart.ts](../frontend/src/chart/line-chart.ts)），不用 ECharts。**

## 工程结构（注意：package.json 在仓库根）

`package.json` / `tsconfig.json` / `vite.config.ts` / `node_modules/` 都在**仓库根**，不在 `frontend/` 下。`frontend/` 只放 `src/`、`dist/`（gitignored，Go `//go:embed`）、`index.html`。所以跑 node 命令在**根目录**，不要 `cd frontend`。Vite 编译 `frontend/src` → `frontend/dist`，再由 Go embed、Wails AssetServer 同源服务。

```
frontend/src/
├── main.ts / App.vue / lifecycle.ts   启动：createApp + createPinia + 挂载 + window 监听
├── stores/          Pinia setup store，一域一文件（见下节）
├── services/{log,map,config}/   传输 client：接口 + Wails 实现，换传输只改 index.ts
├── profiles/        格式无关的字段源映射（apm/ulog），见 §profile
├── chart/           自绘折线：LineChart + 曲线二进制解析 + 刻度/配色
├── utils/           runtime.ts（非响应式重对象容器）/ dom / colors / drone-model / geo / maplibre-drone-layer / flight-fields
├── types/           所有状态/数据类型（store state 用 as XxxState 挂类型）
├── constants/       阈值/颜色常量
├── composables/     组合式逻辑（useToolbarOverflow）
├── components/      charts / common / curves / dialogs / fields / map / three + views/Home
└── wailsjs/         Wails 生成的前端绑定（go/wails/*、runtime）—— 勿手改
```

> 本项目**没有** `core/` 目录——共享逻辑在 `utils/`、`stores/` 的 action、`constants/`、`types/`。新代码按此归位。

## 传输 client：接口 + 实现，换传输只改 index.ts

后端不再走 HTTP `/api`，前端经 `services/{log,map,config}` 的 client 调 Wails 绑定。每个域三件套：

```
services/log/
├── client.ts      接口 LogClient（镜像后端 LogService 的方法）
├── types.ts       后端 DTO 的 TS 镜像（namespace logservice）
├── wails/client.ts Wails 实现：调用 @/wailsjs/go/wails/LogAPI，二进制端点归一化为 ArrayBuffer
└── index.ts       导出当前传输的实例：export const logClient = wailsLogClient
```

`index.ts` 是唯一知道「当前用 Wails」的地方：

```ts
// services/log/index.ts —— 未来切 http：新增 http/client.ts 并把下行改为 httpLogClient，各 store 无需改动
import { wailsHostClient, wailsLogClient } from './wails/client';
export const logClient = wailsLogClient;
export const hostClient = wailsHostClient;
```

Wails 实现里有一个必须的归一化：Wails v2 经 JSON IPC 把 Go `[]byte` 编成 **base64 字符串**（生成的 `.d.ts` 标 `Array<number>` 只是类型映射），`toBuffer()` 统一解码成 `ArrayBuffer` 供 `DataView` 消费（[services/log/wails/client.ts](../frontend/src/services/log/wails/client.ts)）。store 只 import `{ logClient }`、不直接碰 `wailsjs`。

## 状态管理：Pinia setup store

所有跨组件共享状态进 Pinia store，组件不自己持有。统一 **setup store** 写法（`defineStore(name, () => {...})`），不用 Options Store：

```ts
// stores/ui.ts —— 纯状态域
export const useUiStore = defineStore('ui', () => {
  const ui = reactive({ mainView: 'chart', dragOver: false, /* ... */ }) as UiState;
  return { ui };
});
```

带逻辑的域（`log`/`chart`/`three` 等）额外有 `computed` 和普通函数（不是 Options 的 getters/actions）：

```ts
export const useLogStore = defineStore('log', () => {
  const log = reactive({ loading: false, summary: null, /* ... */ }) as LogState;

  const currentLogFileName = computed<string>(() => { /* ... */ });
  const filteredMessages = computed<LogMessage[]>(() => {
    // 跨域派生：在 computed 内调用其它 store（惰性，避开循环依赖初始化）
    return log.messages.filter((m) => useChartStore().formatMessageTime(m) /* ... */);
  });

  async function loadMessages(): Promise<void> {
    try { log.messages = await logClient.messages() ?? []; }
    catch { log.messages = []; }
  }
  return { log, currentLogFileName, filteredMessages, loadMessages };
});
```

要点：

- **state 是 `reactive()` 对象**，用 `as XxxState` 挂 `@/types` 的类型；store id = 文件名 = `useXxxStore`。
- **跨 store 调用写在 setup 函数/computed/函数体内**（不在模块顶层），否则 store 未注册时触发 "no active pinia"。
- setup store 的函数里**直接读写 `log.xxx`**（Pinia 允许），`this` 不参与——所以也不需要旧式的 `const self = this`。

### 异步：async/await，不要 .then 链

```ts
async function loadMessages() {
  try {
    const items = await logClient.messages();
    log.messages = Array.isArray(items) ? items : [];
  } catch {
    log.messages = [];          // 不要静默吞错；UI 兜底
  }
}
```

- 多个独立请求用 `Promise.all([...])` 并行。
- 用户可见错误用 `showToast(msg, 'error')`（来自 [`@/utils`](../frontend/src/utils/index.ts)，不是 `@/core/util`）。
- `loading` / `restoring` 这类标志要能在异常路径复位——放 `finally`，或像上例那样在 `catch` 里兜底赋值。

## 组件：`<script setup>` + storeToRefs

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

模板 ref 通过 store 注册（如 `:ref="registerThreeMain"`），让 store 能拿到 DOM——不在组件里持有 chart/three 实例。单个 `.vue` 超过 ~200 行或出现多个无关功能块时，拆成同目录小组件。

## 非响应式重对象：`runtime`

ECharts 早已移除；主图是自绘 [`LineChart`](../frontend/src/chart/line-chart.ts)。`LineChart` 实例、Three.js 视图、MapLibre/Leaflet 地图、RAF/timer 句柄这些**不该进响应式系统**的重对象，统一放在 [`utils/runtime.ts`](../frontend/src/utils/runtime.ts) 的模块级容器：

```ts
export const runtime: {
  mainChart: LineChart | null;        // 自绘主图
  threeView: ThreeView | null;        // 3D 视图全部可变状态
  threeCurveChart: LineChart | null;  // 3D 底部曲线轴
  mapView: MapRuntime | null;         // Leaflet 地图
  mapLibreView: MapLibreRuntime | null; // MapLibre 3D 地图（含 lock/chase 相机状态）
  chartInteractionsBound: boolean;
} = { /* ...null... */ };
```

store 的函数 `import { runtime } from '@/utils/runtime'` 读写它。用对象容器（而非导出变量）是因为 ES 模块导入绑定只读、不能重新赋值，而 `runtime.mainChart` 需要被替换。

## 三个渲染模块

| 模块 | 入口 | 说明 |
|------|------|------|
| 自绘折线 | [`chart/`](../frontend/src/chart/) | `LineChart`（原 GPUChart）直接画 GPU 折线，独立缩放/平移/可见性。曲线数据走后端二进制 `CurveData`/`TypeBody`/`TypeSchema`，`curve-binary.ts` 解析 |
| 3D 姿态/航线 | [`stores/three.ts`](../frontend/src/stores/three.ts) + `components/three/` | Three.js 场景：无人机模型、轨迹、姿态仪、桨叶、天空/地面/水面。姿态/位置/RC/电机源全部 profile 驱动 |
| 地图 | `components/map/MapView.vue`（Leaflet 2D）+ `MapLibreView.vue`（MapLibre 3D） | 2D 用 Leaflet 加载瓦片；3D 用 MapLibre custom layer 渲染无人机/3D 轨迹（共享 MapLibre 的 GL 上下文） |

3D 与 MapLibre 的硬核规则（floating-origin、constant-screen-size、altitude 基准、GLSL ES 1.00、lock/chase 相机）沉淀在 [skills/frontend-3d-map](../skills/frontend-3d-map)，**动 3D/地图前先读**。

## 格式无关的字段源：profile

3D/地图/飞行数据按日志格式取字段（APM `ATT.Roll` vs PX4 `vehicle_attitude.q[0..3]` 等），通过 [`profiles/`](../frontend/src/profiles/) 抽象，**不写死格式名**：

```ts
// profiles/profile.ts
export interface FormatProfile {
  format: string; label: string;
  attitudeSources: AttitudeSource[];   // euler 或 quat
  positionSources: PositionSource[];   // global（含 altIsMSL）或 local NED
  defaultAttitude: string; defaultPosition: string;
  rc?: RcSource; motor?: MotorSource; volt?: FieldSource[];
  voltCells?: {...}; velocity?: {...}; armedDetection?: ArmedDetection;
  homePosition?: {...};
}
export function registerProfile(p: FormatProfile): void;
export function getProfile(format: string): FormatProfile | undefined;
```

各格式一个文件（`apm.ts`/`ulog.ts`），顶层 `registerProfile(...)`，`profiles/index.ts` 汇总，`main.ts` `import '@/profiles'` 触发注册。`three.ts` 用 `getProfile(summary.format)` 取当前 profile；**新格式只加 profile 文件，不动 three/地图/面板**。

## 文件加载

桌面端加载日志**不走前端上传**，走 Wails 原生能力：

- 「打开文件」按钮 → `hostClient.pickLogPath()`（`HostAPI.PickLogPath` 原生对话框）取路径 → `logClient.load({path})`（`LogAPI.Load` → `logservice.Load` → `parser.ParseFile`）→ 返回摘要，前端 `applyLoadedLog` 拉数据 + 调 `configClient.setFormat`。
- 拖放当前**已禁用**（go-webview2 bug，见 [architecture.md](architecture.md#组装maingo)），相关代码注释保留。

## 类型与依赖

- 业务模型类型集中在 [`types/index.ts`](../frontend/src/types/index.ts)，store state 用 `as XxxState` 挂类型；联合类型优于枚举。
- `api()` 返回的对接后端的局部 `any` 是当前刻意的取舍（后端 JSON 未强类型化），新代码尽量定义类型收窄，不必为存量 `any` 强改。
- 依赖走 npm（根 `package.json`），代码里 ES import；禁止 CDN `<script>` 与 `window.XXX`。
