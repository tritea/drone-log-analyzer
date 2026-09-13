---
name: llm-agent
description: 飞控日志分析器（Drone Log Analyzer）LLM Agent（eino ReAct + 日志工具集）的 token 经济学、知识分层与基准对齐经验。涉及文件：app/services/agentservice/agent/（service/prompt/pacing/summary/trimContext）、app/services/agentservice/tools/（registry/signal/records/groups/topics）、app/modules/knowledge/（formats/*.json 知识库）。当用户要改 agent 工具输出、知识库字段/枚举、系统提示词、迭代步数、或遇到「token 消耗异常」「AI 把枚举值/时间/参数含义读错」「模型烧满迭代不收尾」「工具结果重复计费」之类问题时**必须先读本文件**。关键词：agent、llm、token、上下文、迭代、ReAct、pacing、forceSummary、知识库、枚举、values、阈值、时区、UTC、topic、name_search、get_params、query_data、DeepSeek、GLM。
---

# LLM Agent：token 经济学、知识分层与基准对齐

本文是 2026-09 大规模实测调优沉淀的**经验规则**，每条附「为什么」与真实案例数字。改 agent 工具、知识库或提示词前先读这里——这些坑都表现为「token 悄悄暴涨」或「AI 自信地读错数据」，事后极难归因。

涉及文件：[`agent/`](../../app/services/agentservice/agent/)（ReAct 装配：[service.go](../../app/services/agentservice/agent/service.go)、[prompt.go](../../app/services/agentservice/agent/prompt.go)、[pacing.go](../../app/services/agentservice/agent/pacing.go)、[summary.go](../../app/services/agentservice/agent/summary.go)、[context.go](../../app/services/agentservice/agent/context.go)）、[`tools/`](../../app/services/agentservice/tools/)（[registry.go](../../app/services/agentservice/tools/registry.go)、[signal.go](../../app/services/agentservice/tools/signal.go)、[records.go](../../app/services/agentservice/tools/records.go)、[groups.go](../../app/services/agentservice/tools/groups.go)、[topics.go](../../app/services/agentservice/tools/topics.go)）、[`knowledge/`](../../app/modules/knowledge/)（[topics.go](../../app/modules/knowledge/topics.go) 排查链、[formats/](../../app/modules/knowledge/formats/) 三格式知识库）。

## 1. Token 成本结构（先懂这个再动手优化）

一轮的上行 token = **固定开销 × 模型调用次数 + 工具结果滚雪球重发**：

- 固定开销 ≈ 系统提示词（~2.7k 字符）+ 工具定义 JSON（10 工具 ~5.7k 字符），**每次调用都原样重发**，与档位无关；
- ReAct 每次迭代把之前所有工具结果再发一遍 → 成本**超线性**：实测 fast 档 3 步 30.8k、5 步 75.9k（+146%，不是 +67%）；
- **计数 ≠ 账单**：DeepSeek 等有自动前缀缓存，重复前缀按 ~1/10 计费——↑ 计数含缓存命中，实际费用约为计数价的四~六成。

**规则**：
1. 动任何优化前，先按 `tool_call_id` 配对统计该档位**实际轮次形态**（旧批次体量 / 最后一批占比）。教训：轮内压缩在 fast=3 下天花板 <5%（旧批次才 8.5k、最后一批按设计不动），做完没效果整体回退了。
2. 工具结果输出前先估 token（`[条数 × 行宽]` 粗算），加条目上限 + `truncated` 标记 + 精度收敛（raw 点 t 取 0.1s / 值 0.01 一类）。
3. 砍「每行宽度」不如砍「行数」不如砍「重发次数」——优先级：让模型少一步收尾 > 输出更小 > 单行更紧凑。

## 2. 模型不会自主收尾：迭代上限是成本旋钮

**模型对「还能查几步」没有感知，把上限当目标用完**（实测 3 步烧满、5 步照样烧满），最后一步撞上限触发 forceSummary 的额外全量重发。

**已落地的解法**：[pacing.go](../../app/services/agentservice/agent/pacing.go) 经 adk `BeforeModelRewriteState` 钩子在系统提示词尾部注入预算（旧提示先剥掉，始终只有一条）：

- 第 n<max 次：`【调用预算】进度 n/max，剩余 K 次；按需收敛…`
- 第 n==max 次：`不得再调用任何工具，立即作答`——**这一次调用本身就是答案**，forceSummary 退居兜底。

**分层原则**：软引导（pacing/提示词）提质量，硬保证（上限 + forceSummary + incidentPatch 格式修补 + RawBudget + trimContext）保下限。目标是「下限一致」而非「结果一致」——把模型当 CPU，系统当操作系统：不同 CPU 跑分不同，但 OS 保证都不崩。

## 3. 知识分层：只发模型不知道的，其余交给训练知识

知识库（formats/*.json）里的字段/参数元数据按「提示而非教学」分层：

| 内容 | 处置 | 为什么 |
|---|---|---|
| 阈值 / 默认值 / 单位 | **必须下发** | 客观判读基准；模型记忆跨版本不可靠（参数默认值错了会**静默**归因错） |
| 枚举/位段取值（values 列） | **必须下发** | 跨体系刻度不同（见 §4），猜错必然而非偶发 |
| desc（一句话用途）+ affects（相关域数组） | 下发 | 给缺训练数据的模型兜底，p50≈12 字符很便宜 |
| analysis（[条件,含义] 启发式） | **不发**（KB 保留） | 这是方法论，训练知识覆盖；发出来是浪费 |
| 长述（long） | 条目 >40 时省略 | token 大头 |

**惨痛案例**：`GPS.Status=4` 在 dataflash 刻度=DGPS，AI 按别家体系记忆读成「3D Fix」。枚举刻度三库互不相同：dataflash 0~8 / tlog 0~6 / ulog 0~5，同一数字含义不同——所以 values 列按格式各带各的，测试锁锚点（[knowledge_test.go](../../app/modules/knowledge/knowledge_test.go) 的 `TestEnumValuesCarried`）防串库。

**KB 修改纪律**：formats/*.json 是「每字段一行」的紧凑 JSON——改条目用括号配对的**文本手术**只重写受影响行，别整库 JSON.stringify 重排（会产生 5k+ 行噪声 diff）。

## 4. 基准对齐：口径不一致 = AI 自信地出错

- **时区**：界面曲线显示 UTC，工具输出、用户时刻、AI 回答必须**同一根轴**（[timeaxis.go](../../app/services/agentservice/tools/timeaxis.go) 的 AbsTime 全链路 `.UTC()`，timeBase 带 `+00:00` 后缀）。曾因工具渲染本机时区：用户问「06:55 之后」，模型时间线（本地 14:37 起）里**根本不存在** 06:55，只能瞎猜。
- **飞控生态**：系统提示词注明 `apm=ArduPilot / ulog=PX4 / tlog=两者皆可能`——两家的枚举、参数体系、字段语义互不通用，格式名（apm/ulog）是内部黑话，不注明模型会套错体系。
- **诊断技巧**：agent 思考过程里出现「若为 / 可能 / 推测」这类**口径类**措辞 = 某个基准没对齐（实例：模型推理「你看到的 06:55 **若为** UTC 则对应本地 14:55」——它在做时区侦探，赌对了不等于没问题）。

## 5. 查询阶梯：索引优先、暴力兜底

参数与字段的取数是同一条阶梯，**索引是快路径但绝不允许卡住探索**：

```
topic 索引直达（排查链 formatChains，一步）
  → name_search 名字子串全局搜索（暴力兜底，防固件参数体系失配）
  → name_prefix 前缀浏览
  → 缺省全量（截断 + 分批提示）
```

- **宁可裸给真参数，不给幽灵参数**：名称+值（无描述）照发——描述模型训练知识能补，名字不给就彻底丢了；但 dataflash/ulog 的参数表是固件全集，链上参数全量表未见 = 该固件没有，剔除不发（发了他会以为可分析），缺失计数进 hint 引导暴力搜索。
- **菜单 → 详情**：list_groups 只给分组名纯名单（有哪些大类必须现场告知，机型/固件有差异；含义交给训练知识），字段级详情走 get_fields 按需查。
- 同族归并：首段去尾数字（EK2/EK3、RNGFND1/RNGFND2 同族），实例号与代际差异不当失配。

## 6. 分析 agent 行为的方法论

1. **工具结果统计必须按 `tool_call_id` 配对**——按顺序配对会错位（曾把 508 字符的 modes 误报成 8k，连带优化方向跑偏）。
2. 轮与轮之间的**行为方差**（模型这轮拉 raw、下轮不拉）远大于小优化的收益，验证要跑同题多次看稳定形态。
3. forceSummary 是终止保证不是浪费：迭代烧完仍强制兑换结论，已花费的调用不能白花。别试图删它，只减少触发它的频率。
4. 系统提示词只放**通用方法论**（怎么排查），领域细节（查什么参数/阈值）进知识库——提示词每次调用都重发，是固定开销。
