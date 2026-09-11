# LLM Agent 日志分析 — 设计文档

> 状态：设计稿（待评审）。参考草案：[flight_log_agent_tool_plan.md](flight_log_agent_tool_plan.md)。
> 本文档在其基础上合并了 JSON 知识库结构、对齐了现有代码架构（`app/` 三层、services 接口模式、Wails 绑定）。

## 1. 背景与目标

给 DroneLogAnalyzer 接入 LLM Agent，让用户用自然语言问"飞机为什么漂移"、"这次飞行电池健康吗"，Agent 通过工具读取日志结构与数据后给出诊断。

核心原则（继承自草案）：

- **Agent 不直接读原始日志**。Agent 只通过 Tool 获取：日志元信息 → group/字段知识 → 按需的统计结果。
- **Tool 无业务状态**。当前日志、机型、知识库由 Agent Session 持有，Tool 只做数据访问与计算。
- **不同日志格式各自维护知识库**，不做强制字段映射（PX4 的 GPS ≠ ArduPilot 的 GPS）。
- **日志格式只增不改**（AGENTS.md 不变量）：新格式 = 新 parser loader + 新知识库 JSON 文件，不改 Agent/Tool 代码。

新增硬约束（用户强调）：**代码必须拆文件夹、分层级组织**。禁止把所有东西平铺进一个大文件夹；每个子域一个文件夹，文件夹内文件保持小（几百行内）。

## 2. 总体架构

```
前端 modules/agent（聊天 UI + 设置）
        │ wailsjs 绑定 + Wails Events（流式）
        ▼
transport/wails/AgentAPI ──事件emit──► 前端
        │
        ▼
services/agentservice ──────────────────────────────┐
  │  eino 装配（ChatModel + ChatModelAgent/ReAct）    │
  │  tools/（6 个 InvokableTool，InfereTool 生成）     │
  │        │                                          │
  │        ├─► services/logservice（数据所有者）        │
  │        ├─► modules/knowledge（字段知识库，embed JSON）  │
  │        └─► modules/fieldstats（纯统计函数）         │
  └─ LLM 配置 ◄─ services/configservice（llm_config_v1.json）
```

依赖方向遵守模块边界（依赖只能自上而下）：

- `agentservice` import `logservice`（service 组合 service 接口，非实现；与 HostAPI 持有 Log 同类的组合方式）
- `agentservice` import `modules/knowledge`、`modules/fieldstats`
- `modules/*` 不 import services；`knowledge`/`fieldstats` 是纯模块，可独立单测
- 跨服务 DTO（`LlmConfig`）放 `app/model/`

## 3. 知识库 JSON 设计（合并式）

### 3.1 文件组织

一个格式**一个合并 JSON 文件**（group 级 + field 级知识合一，不再拆 metadata.json + 每 group 一个文件），embed 进二进制：

```
app/modules/knowledge/
  knowledge.go        # 对外查询 API（Lookup / GroupMeta / FieldMeta）
  types.go        # 知识库结构体定义
  loader.go       # embed + 加载 + 建索引（group 名 → 条目）
  vehicle.go      # 机型归一化 + appliesTo 过滤
  formats/
    apm.json      # ArduPilot DataFlash（.bin/.log）
    tlog.json     # ArduPilot/PX4 tlog
    ulog.json     # PX4 ulog
```

新格式接入：`formats/` 下加一个 JSON + loader 里注册一行，零代码改动。

### 3.2 JSON Schema

顶层：

```jsonc
{
  "format": "apm",                        // 必须与 parser 注册的格式名一致
  "version": 1,                           // 知识库 schema 版本
  "vehicleClasses": ["multirotor", "fixedwing", "helicopter", "vtol", "rover", "boat", "sub"],
  "groups": {                             // group 名（如 GPS）→ 条目
    "GPS": {
      "description": "定位、卫星质量、地速，导航可靠性的基础",
      "affects": ["position", "navigation", "ekf"],
      "appliesTo": ["multirotor", "fixedwing", "helicopter", "vtol", "rover", "boat", "sub"],  // 缺省=全部
      "vehicleNotes": {                   // 机型特殊说明（可选）
        "rover": "Rover 无高度相关语义，只看 2D 精度"
      },
      "fields": {
        "NSats": {
          "description": "卫星数量",
          "unit": "count",
          "thresholds": [                 // 分级阈值，op: lt/gt/le/ge
            { "level": "warning",  "op": "lt", "value": 8 },
            { "level": "critical", "op": "lt", "value": 5 }
          ],
          "affects": ["position", "navigation"],
          "analysis": [                   // 组合条件 → 含义（给 AI 的启发式知识）
            { "condition": "NSats 下降 && HDop 升高", "meaning": "GPS 质量下降" }
          ],
          "appliesTo": ["multirotor", "fixedwing"],   // 字段级机型区分（可选）
          "related": ["GPS.HDop", "GPS.Status"]      // 关联字段（可选）
        },
        "HDop": { "description": "水平精度因子", "unit": "", "thresholds": [...] }
      }
    },
    "BAT": { "...": "..." }
  }
}
```

规则：

- **机型区分**：group 级和 field 级都有可选 `appliesTo`（归一化机型类，见 3.3）；缺省 = 适用于所有机型。过滤发生在查询侧（`vehicle.go`），AI 拿到的字段列表永远与当前机型匹配。
- **多实例 group**（BARO2、GPS2…）：查找规则 = 先精确匹配 group 名 → 未命中则去掉尾部数字回退到基础条目（BARO2 → BARO）。
- **阈值泛化**：`{level, op, value}` 数组而非固定 warning/critical 两个数字，因为有的字段低于阈值危险（NSats）、有的高于危险（振动）；同一 level 可有多条（三轴振动各一阈值）。
- 字段条目里**所有键除 description 外均可选**，按具体字段裁剪，不强行凑齐。
- 首期内容量：schema + 核心示范条目（GPS、BAT、CTUN、ATT 四个 group 的常用字段），后续人工逐步充实。

### 3.3 机型归一化

`LogSummary.VehicleType/Frame/Airframe` 在三种格式里取值不一（"Copter" / "multirotor" / "QUADROTOR"…）。`knowledge/vehicle.go` 提供归一化：

```
multirotor | fixedwing | helicopter | vtol | rover | boat | sub | unknown
```

输入优先级：`Airframe`（logservice 已做 vtol/multirotor 分类，PX4 走 px4airframe.go 的细分）→ `VehicleType`（Copter/Plane/Rover/Sub 映射）→ `unknown`（不过滤，全量返回）。

## 4. 数据查询层

### 4.1 logservice 扩展（数据所有者）

现状：`Browse` 返回整 group 数值列但**无时间戳**；`CurveBytes` 是给前端渲染的二进制 blob。统计需要 (times, values) 对。新增一个只读方法（接口 + model + dataflash 实现各加一小块）：

```go
// app/services/logservice/service.go
Series(ctx context.Context, req SeriesRequest) (*SeriesResponse, error)

// app/services/logservice/model.go
type SeriesRequest struct{ Type, Field string }
type SeriesResponse struct {
    Times  []float64  // 相对起飞秒
    Values []float64  // 解码后的物理值（scale/offset 已应用）
}
```

实现放 `app/services/logservice/dataflash/series.go`（从 `TypeBody` 解码时间列 + 目标列）。NaN/Inf 在 DTO 边界 sanitize（Wails JSON 闪退陷阱，见 model.go 里 `Parameter` 的先例）。

### 4.2 fieldstats 纯统计模块

```
app/modules/fieldstats/
  types.go       # Op 枚举、Query、Result 结构
  window.go      # 时间窗切片（times/values + [t0, t1]）
  stats.go       # min / max / avg / minmax / p2p（峰峰值）
  derivative.go  # 差分与变化率（最大/平均速率）
  trend.go       # 趋势（线性回归斜率 + 方向判定）
  peaks.go       # 峰值检测（局部极值计数、最大峰值）
  threshold.go   # 越限段（进入/退出时刻、持续时长、越限幅度）
```

输入输出全部为纯数据结构（`[]float64`），不 import parser/services，可独立表驱动单测。所有运算**只在时间窗内**进行；`raw` 操作做降采样（LTB bucket 均值，默认上限 ~2000 点）防止 token 爆炸。

## 5. agentservice

### 5.1 文件组织（分层）

```
app/services/agentservice/
  service.go        # Service 接口 + sentinel errors
  model.go          # ChatRequest/ChatResponse/AgentEvent 等 DTO
  agent/            # eino 装配与实现（未导出 struct，New() 返回接口）
    service.go      # type service struct + New(deps) + Chat/Stop/History/Clear
    chatmodel.go    # 从 LlmConfig 构建 eino ChatModel（openai 兼容）
    session.go      # 会话状态：消息历史、当前日志摘要快照、cancelFunc
    prompt.go       # 系统提示词组装（注入格式/机型/固件/工具用法）
    stream.go       # eino 流式事件 → AgentEvent 回调适配
  tools/            # 6 个 InvokableTool（utils.InferTool 从函数+tag 生成）
    registry.go     # buildTools(deps) []tool.BaseTool 汇总
    overview.go     # get_log_overview
    groups.go       # list_groups、get_group_fields
    signal.go       # query_signal（核心）
    records.go      # get_flight_events（errors+events+mode changes）、get_parameters
```

### 5.2 Service 接口

```go
// service.go
var (
    ErrNoLogLoaded    = errors.New("no log loaded")     // 对齐 logservice 语义
    ErrLlmNotConfigured = errors.New("llm not configured")
    ErrAgentBusy      = errors.New("agent busy")         // 单会话，上一轮未结束
)

type Service interface {
    Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) // 流式经 EventSink
    Stop(ctx context.Context) error                                    // 取消当前轮
    History(ctx context.Context) (*HistoryResponse, error)
    Clear(ctx context.Context) error
}
```

流式：`Chat` 内部把 token/工具调用事件推给注入的 `EventSink func(AgentEvent)`；`EventSink` 由传输层注入（Wails 侧 = `runtime.EventsEmit`），service 不 import transport。`Chat` 返回最终汇总（answer + 工具调用轨迹）。

`AgentEvent`（model.go，前端也按此渲染）：

```jsonc
{ "type": "delta",     "text": "..." }                 // 增量文本
{ "type": "tool_start","tool": "query_signal", "args": {...} }
{ "type": "tool_end",  "tool": "query_signal", "summary": "...", "durationMs": 12 }
{ "type": "final",     "messageId": 3 }
{ "type": "error",     "message": "..." }
```

### 5.3 LLM 配置

DTO 放 `app/model/llm.go`（跨服务共享）：

```go
type LlmConfig struct {
    Provider string  // 展示用：GLM / DeepSeek / Qwen / Ollama / 自定义
    BaseURL  string  // OpenAI 兼容端点；本地 Ollama 填 http://127.0.0.1:11434/v1
    APIKey   string
    Model    string  // 如 glm-4.7 / deepseek-chat / qwen-plus
    Temperature float64
    MaxSteps int     // ReAct 循环上限，默认 15
}
```

- 持久化归 **configservice**（沿用 jsonstore 模式）：`GetLlmConfig/SaveLlmConfig` 接口方法 + `jsonstore/llm.go`（`llm_config_v1.json`，`%APPDATA%/DroneLogAnalyzer`）。
- agentservice 经 `Deps.Llm LlmConfigProvider`（接口，签名用 `app/model` 类型）消费，main.go 装配时注入 cfgSvc——service 之间不直接 import，组合发生在 main。
- 安全：APIKey 不写日志、不进 prompt、不随事件发给前端（设置面板回显用打码值）；BaseURL 校验 http(s)。

### 5.4 Eino 装配

依赖：`github.com/cloudwego/eino` + `github.com/cloudwego/eino-ext/components/model/openai`。

```go
// agent/chatmodel.go — 一个 OpenAI 兼容入口覆盖所有主流提供商
cm, err := openai.NewChatModel(ctx, &openai.ChatModelConfig{
    APIKey: cfg.APIKey, Model: cfg.Model, BaseURL: cfg.BaseURL,
    Temperature: cfg.Temperature,
})

// agent/service.go — ReAct Agent
agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
    Model:       cm,
    ToolsConfig: adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{Tools: tools}},
    MaxStep:     cfg.MaxSteps,
})
```

工具用 `utils.InferTool(name, desc, fn)` 从带 `jsonschema` tag 的入参结构体自动生成 schema（eino 推荐路径，无手写 ParamsOneOf）。

流式细节（`stream.go`）：以 eino ADK 的流式/回调能力为准把 token 与 toolcall 事件转成 `AgentEvent`；**实现时先核对当前 eino 版本的 ADK 流式 API**（`GenerateStream`/回调 Handler），此为装配层唯一需要现场验证的点，不影响接口设计。

会话历史 `[]*schema.Message` 存内存（单窗口应用，重启即清）；每轮把系统提示词按当前日志重建（切换日志后旧对话标记失效提示）。

### 5.5 系统提示词（prompt.go）

组装进 system message 的"系统层级"信息（用户要求）：

- 日志格式（apm/tlog/ulog）、机型类（归一化后）、具体 VehicleType/Frame/Airframe、固件版本、飞行时长
- 工具使用套路：先 `get_log_overview` → `list_groups` → `get_group_fields` → `query_signal`，不确定字段先查知识库再取数
- 输出约束：中文回答；引用数据注明时间范围与字段名；阈值判断依据知识库；不确定就说不确定

## 6. Tool 清单（tools/）

| 工具 | 入参 | 出参（摘要） |
|------|------|--------------|
| `get_log_overview` | 无 | 格式/机型/固件/时长/参数量/错误数/模式切换数/事件数 |
| `list_groups` | 无 | 当前日志实际存在的 group 列表 + 知识库描述 + affects |
| `get_group_fields` | `group` | 字段列表：description/unit/thresholds/affects/analysis/related + 实测 min/max/count |
| `query_signal` | `queries[]{name:"GROUP.Field", start_at, end_at, interval?, operation}` | 每查询一条统计结果（见 6.1） |
| `get_flight_events` | `kind: errors\|events\|modes` | 错误/事件/模式切换条目（时间+文案） |
| `get_parameters` | `name_prefix?` | 参数名→值（可前缀过滤，全量较大） |

设计要点：

- **知识库与实测融合**：`list_groups` 是"日志里真实有的 group"（来自 logservice.MessageTypes）左连接知识库描述；`get_group_fields` 同理，知识库没有的字段也列出（description 留空），避免 AI 不知道有这列。
- **组.字段寻址**统一 `"GROUP.Field"`（与前端曲线寻址一致）；多实例直接 `BARO2.Alt`。
- 时间单位秒（相对日志起点）；`start_at/end_at` 缺省 = 全程。
- 未加载日志时所有工具返回明确错误文本（LLM 可读），引导用户先打开日志。

### 6.1 query_signal.operation

`operation` 为对象 `{type, ...参数}`（继承草案，可扩展）：

| type | 语义 | 附带 |
|------|------|------|
| `raw` | 降采样原始序列 | 点数上限默认 2000，interval 可调 |
| `min` / `max` / `avg` | 窗口最值/均值 | 命中时刻（min/max） |
| `minmax` | 同时返回 min/max | |
| `p2p` | 峰峰值 | |
| `derivative` | 变化率统计 | max/avg 速率 + 命中时刻（差分数据） |
| `trend` | 趋势 | 回归斜率 + 方向 |
| `peaks` | 峰值检测 | 峰个数、最大峰值、时刻 |
| `abnormal` | 越限段 | 可带 `threshold`（缺省用知识库阈值）→ 段列表（进入/退出/时长/幅度/等级） |

多查询批量（`queries[]`）一次往返，减少工具调用轮数。

## 7. 传输层

```
app/transport/wails/agentapi.go   # AgentAPI{ Svc agentservice.Service }
```

- 方法（无 ctx，同既有绑定约定）：`Chat(req)`、`Stop()`、`History()`、`Clear()`；LLM 配置走既有 `ConfigAPI`（`GetLlmConfig/SaveLlmConfig`）。
- 流式：`AgentAPI` 持有 wails ctx（同 HostAPI 的 `Startup(ctx)` 注入模式），把 service 的 EventSink 接到 `runtime.EventsEmit(ctx, "agent:event", payload)`。
- main.go：`agentSvc := agentservice.agent.New(agentservice.Deps{Log: logSvc, Llm: cfgSvc})`，`Bind` 追加 `&wailsapp.AgentAPI{Svc: agentSvc}`；改绑定后跑 `wails generate module`。

## 8. 前端

```
frontend/src/services/agent/          # client 三层（对齐 log/config 域）
  client.ts                           # AgentClient 接口
  wails/client.ts                     # wailsjs 实现 + 事件订阅封装
  index.ts                            # 单例出口
  types.ts                            # 镜像 Go DTO（ChatRequest/AgentEvent/...）

frontend/src/modules/agent/           # agent 域（文件夹包裹）
  store/
    agent-store.ts                    # messages/streaming/toolTrace/llmConfig；经 services/agent client
  components/
    AgentPanel.vue                    # 右侧聊天抽屉容器（打开/关闭/标题）
    MessageList.vue                   # 滚动加载与自动置底
    MessageItem.vue                   # 单条消息（用户/助手，pre-wrap 文本）
    ToolCallCard.vue                  # 工具调用折叠条（name+args+summary+耗时）
    ChatInput.vue                     # 输入框 + 停止按钮（流式中）
    LlmSettingsDialog.vue             # Provider/BaseURL/APIKey/Model 表单（走 config client）
```

- 事件：`EventsOn('agent:event')` 分发进 store（delta 追加当前流式消息、tool_* 进 toolTrace、final/error 收尾）。
- 绑定规则：不直接碰 `wailsjs`（经 `services/agent`）；ECharts/无渲染实例入 state 的问题不涉及；组件按域放 `modules/agent/components`，不进全局 components。
- 入口：Home 右侧抽屉（工具栏图标切换），首期不做多会话管理。

## 9. 不变量与既有约束的遵守

| 约束 | 落实 |
|------|------|
| 依赖只向下 | agentservice→(logservice 接口, knowledge, fieldstats)；modules 纯净；DTO 跨服务进 `app/model` |
| 日志格式只增不改 | 新格式 = parser loader（现有机制）+ `knowledge/formats/<fmt>.json` |
| NaN/Inf 闪退 | `SeriesResponse`、统计结果、工具 JSON 输出统一 sanitize（复用 logservice model.go 的先例写法） |
| 文件小 + 文件夹包裹 | 上文目录树即交付结构；单文件几百行内 |
| 构建须 wails | 验证一律 `wails dev` / `wails build`；改绑定后 `wails generate module` |
| store 不碰 wailsjs | 前端只经 `services/agent` |

## 10. 实施分期

**M1 后端全链路（本分支 feat_llm 先行）**

1. `app/model/llm.go` + configservice 扩展（Get/SaveLlmConfig + jsonstore/llm.go）
2. `modules/knowledge`（types/loader/vehicle + formats/apm.json 示范条目 GPS/BAT/CTUN/ATT）
3. logservice `Series`（接口/model/dataflash 实现）
4. `modules/fieldstats` 全部运算 + 表驱动单测
5. `agentservice`（agent/ + tools/）+ `AgentAPI` + main.go 装配 + `wails generate module`
6. 后端冒烟：`wails dev` 下用调试控制台/日志验证一轮真实问答（GLM 或 DeepSeek key）

**M2 前端 UI**

7. `services/agent` client + 事件封装
8. `modules/agent` store + 五个组件 + 设置对话框 + Home 抽屉接入

**M3 知识库充实与打磨（持续）**

9. 逐格式补全 group/字段条目（可先用 AI 生成草稿再人工校对）
10. tlog/ulog 知识库文件；工具结果截断与 token 预算调优；多轮上下文裁剪

## 11. 验证

- **单测**：`fieldstats`（窗口/统计/越限，含 NaN 与空窗边界）、`knowledge`（加载/机型过滤/多实例回退）、agentservice tools（对 logservice stub 测入出参映射）
- **集成**：`wails dev` 加载真实日志 → 设置面板配 LLM → 问"GPS 质量如何" → 观察 tool 调用轨迹（应走 overview→groups→fields→signal）与流式回答
- **回归**：`wails build` 产出 exe；前端 `vue-tsc --noEmit`
- **边界**：未加载日志就提问、未配置 LLM 就提问、流式中 Stop、切换日志后再提问

## 12. 风险与开放问题

- eino/eino-ext 版本迭代较快：ADK 流式 API 以实现时版本为准（仅影响 `stream.go` 一个文件）。
- 模型必须支持 function calling（GLM/DeepSeek/Qwen 主流型号均支持）；设置面板加提示。
- `raw` 大序列 token 风险：降采样上限 + 工具输出截断双保险。
- APIKey 本地明文存储（桌面应用、用户目录）：首期接受，后续可选 DPAPI 加密，不阻塞。
- 知识库准确性：阈值/analysis 条目属领域知识，需人工review，AI 只做草稿。
