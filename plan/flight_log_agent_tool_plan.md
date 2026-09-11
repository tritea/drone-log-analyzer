# 飞控日志分析 Agent Tool 系统设计 Plan

## 1. 项目目标

构建一个基于 Eino Agent 的飞控日志智能分析系统。

目标：

-   Agent 不直接读取完整日志。
-   Agent 通过 Tool 动态获取日志结构、字段说明和分析数据。
-   不同飞控、不同日志格式拥有独立知识库。
-   JSON 配置支持扩展新的日志类型。
-   Tool 负责数据访问和计算，Agent 负责分析决策。

------------------------------------------------------------------------

## 2. 总体架构

    User
     |
     v
    Log Analysis Agent
     |
     +-- get_metadata
     +-- get_group_metadata
     +-- query_signal
     |
     v
    Log Plugin System
     |
     +-- PX4 ULog
     +-- ArduPilot
     +-- DJI Log

------------------------------------------------------------------------

## 3. 核心原则

### Tool 无业务状态

Tool 不保存：

-   当前日志
-   当前用户
-   当前机型

由 Analysis Session 管理：

-   日志类型
-   飞控类型
-   机型
-   Parser
-   Metadata

------------------------------------------------------------------------

## 4. 日志插件系统

每种日志类型作为独立插件。

目录：

    metadata/

      px4_ulog/
          metadata.json
          gps.json
          motor.json
          ekf.json

      ardupilot_bin/
          metadata.json
          gps.json
          ekf.json

      dji_log/
          metadata.json
          gps.json

------------------------------------------------------------------------

## 5. Metadata设计

### get_metadata

获取当前日志支持的大分类。

示例：

``` json
{
  "groups": [
    {
      "name": "GPS",
      "description": "位置、速度、导航可靠性"
    },
    {
      "name": "MOTOR",
      "description": "动力输出状态"
    }
  ]
}
```

### get_group_metadata

获取具体模块字段。

字段可以包含：

-   描述
-   单位
-   阈值
-   影响范围
-   关联字段
-   飞控特殊说明

------------------------------------------------------------------------

## 6. query_signal Tool

用于查询数据。

示例：

``` json
{
  "queries": [
    {
      "name": "GPS.satellite_count",
      "start_at": 100,
      "end_at": 120,
      "interval": 1,
      "operation": {
        "type": "statistics",
        "method": "minmax"
      }
    }
  ]
}
```

支持：

-   raw
-   min
-   max
-   average
-   range
-   derivative
-   trend
-   peak
-   abnormal

默认返回分析结果，不返回大量原始日志。

------------------------------------------------------------------------

## 7. 不做强制统一字段映射

不要强制：

    PX4 GPS = ArduPilot GPS

原因：

-   字段含义不同
-   可用字段不同
-   分析逻辑不同

每种日志维护自己的 JSON。

------------------------------------------------------------------------

## 8. Plugin 注册

接口：

``` go
type LogPlugin interface {
    Format() string
    MetadataPath() string
    Parser() LogParser
}
```

注册：

``` go
RegisterPlugin(
    "px4_ulog",
    Px4Plugin{}
)
```

------------------------------------------------------------------------

## 9. Agent分析流程

用户：

    飞机为什么漂移？

流程：

1.  get_metadata()

发现：

    GPS
    EKF
    ATTITUDE

2.  get_group_metadata("GPS")

获取：

    satellite_count
    hdop

3.  query_data()

查询：

    GPS质量变化

4.  根据结果继续分析。

------------------------------------------------------------------------

## 10. 扩展方式

新增飞控：

添加：

    metadata/new_fc/
    parser/new_fc/
    plugin/new_fc.go

无需修改：

-   Agent
-   Tool接口
-   查询逻辑

------------------------------------------------------------------------

## 最终目标

    通用Agent
        +
    Eino Tool
        +
    日志插件系统
        +
    JSON领域知识库
        +
    统一查询接口

形成可扩展的飞控日志智能诊断系统。
