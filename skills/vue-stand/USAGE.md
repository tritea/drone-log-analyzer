# Web Vue Standards Skill — 使用指南

> 本文件是 [SKILL.md](./SKILL.md) 的速查与示例补充。规范以项目当前真实写法为准。

## 触发场景

skill 在以下情况自动应用：新建/修改 Vue 组件、写/改 Pinia store、加后端调用、重构、补类型、处理 Three.js / MapLibre / Leaflet / 自绘图表逻辑；或提到关键词 `组件`/`vue`/`前端`/`typescript`/`pinia`/`store`/`状态管理`/`接口`/`api`/`异步`/`3d`/`three`/`maplibre`/`leaflet`/`图表`。

## 典型用法

### 1. 新增一个域的状态（新 Pinia store）

```
帮我加一个存放「对比会话」列表的 store
```

skill 会：在 `frontend/src/stores/` 新建文件，用 **setup store** 写法；state 用 `reactive()` + `as XxxState`（类型加到 [`types/index.ts`](../../frontend/src/types/index.ts)）；派生用 `computed()`，逻辑用普通函数；导出 `useXxxStore`。

```typescript
// stores/sessions.ts
import { defineStore } from 'pinia';
import { reactive, computed } from 'vue';
import type { SessionState } from '@/types';
import { sessionClient } from '@/services/sessions'; // 假设有的服务 client
import { showToast } from '@/utils';

export const useSessionsStore = defineStore('sessions', () => {
  const sessions = reactive({ items: [], loading: false }) as SessionState;

  const count = computed<number>(() => sessions.items.length); // 没有 this，直接用闭包变量

  async function loadSessions(): Promise<void> {
    sessions.loading = true;
    try {
      const items = await sessionClient.list();
      sessions.items = Array.isArray(items) ? items : [];
    } catch {
      sessions.items = [];
    } finally {
      sessions.loading = false;
    }
  }

  async function removeSession(name: string): Promise<void> {
    try {
      await sessionClient.remove(name);   // 经服务 client，不散落 fetch
      await loadSessions();
    } catch (e: unknown) {
      showToast('删除失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  }

  return { sessions, count, loadSessions, removeSession };
});
```

> 注：示例里的 `services/sessions` 是假设；真实后端域是 `services/{log,map,config}`（见 [`frontend/src/services`](../../frontend/src/services)）。

### 2. 新增一个后端调用

```
加一个删除曲线模板的调用
```

skill 会写一个普通函数：`async/await` 经对应服务 client，try/catch/finally，`showToast` 提示错误，**不散落裸 `fetch`**、**不直接碰 `wailsjs`**。换传输层（未来加 http）只改 `services/<域>/index.ts`。

### 3. 新建组件并消费 store

```
做一个显示当前曲线总数的徽标组件
```

skill 会：`<script setup lang="ts">`，`storeToRefs` 拿响应式 state，函数直接解构，props 用泛型 `defineProps`。

```vue
<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { onMounted } from 'vue';
import { useSessionsStore } from '@/stores/sessions';

defineProps<{ badge?: string }>();

const sessionsStore = useSessionsStore();
const { sessions, count } = storeToRefs(sessionsStore); // state 必须经 storeToRefs
const { loadSessions } = sessionsStore;                 // 函数直接解构

onMounted(() => loadSessions());
</script>

<template>
  <div class="session-list">
    <span class="badge">{{ badge }}: {{ count }}</span>
    <div v-for="s in sessions.items" :key="s.name">{{ s.name }}</div>
  </div>
</template>
```

## 反模式（出现即改）

```vue
<script setup lang="ts">
// ❌ 组件自持共享状态 —— 应进 store
const sessions = ref([])

// ❌ 直接解构 store 拿 state（丢响应式）—— 应用 storeToRefs
const { sessions } = useSessionsStore()
</script>
```

```typescript
// ❌ setup store 里用 this / const self = this —— setup store 没有 this，直接用闭包变量
// ❌ 裸 .then() 链 —— 应 async/await
client.list().then((res) => { sessions.items = res; });

// ❌ store 里散落 fetch / 直接碰 wailsjs —— 应经 services client
const r = await fetch('/api/xxx');

// ❌ loading 没 finally 复位
sessions.loading = true;
try { await client.list() } catch {} // finally 呢？

// ❌ 把 CurveChart / Three / MapLibre 实例塞进 Pinia state —— 应放 runtime
// ❌ echarts.init(el) —— ECharts 已移除，主图是自绘 CurveChart
// ❌ 3D 直接赋值 / 欧拉角
camera.position.copy(target);
camera.rotation.set(p, r, y);

// ❌ 路径 @/core/types / @/core/util —— 没有 core/，用 @/types / @/utils
```

## 工作流程

1. **路径** → `frontend/src/`，没有 `core/`
2. **共享状态** → Pinia setup store（`reactive` + `computed` + 函数，无 `this`）
3. **调后端** → `services/{log,map,config}` client + `async/await` + try/catch
4. **组件取数** → `storeToRefs` 拿 state，直接解构拿函数
5. **重对象** → `runtime`
6. **类型** → `types/`，避免新增无谓 `any`
7. **3D/地图** → lerp + 四元数；先读 [../frontend-3d-map/SKILL.md](../frontend-3d-map/SKILL.md)

## 相关资源

- [SKILL.md](./SKILL.md) —— 主规范
- [docs/frontend.md](../../docs/frontend.md) —— 前端架构
- [../frontend-3d-map/SKILL.md](../frontend-3d-map/SKILL.md) —— 3D/MapLibre 渲染规则
- [../../AGENTS.md](../../AGENTS.md) —— 开发约束
