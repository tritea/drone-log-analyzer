# 地图瓦片与缓存

> 本文讲底图 provider 抽象、单一共享 MBTiles 缓存、读取/淘汰/回收管线。绑定/路由字段见 [api.md](api.md)「地图底图」一节。

「可视化」视图里的「地图」渲染项：前端 Leaflet（2D）/ Cesium（3D 地图）通过 Go 中转取瓦片，Go 侧按 provider 抽象上游、缓存优先、未命中抓取并落盘。整个地图子系统在 [`app/modules/maptiles`](../app/modules/maptiles)（格式无关的核心）+ [`app/modules/maptiles/providers`](../app/modules/maptiles/providers)（内置源，唯一知道完整源清单的包，破除循环依赖）+ [`app/services/mapservice/tilecache`](../app/services/mapservice/tilecache)（`MapService` 实现，管启用配置）。

## Provider 抽象

[provider.go](../app/modules/maptiles/provider.go)：`Provider` 接口只有 `ID/Name/Attribution/TileURL/Fetch`，**provider 不持有数据库**。`TileSource` 是共享基类（持有共享 storage 引用 + HTTP client + 一个 provider 专有的 `urlFn`），具体 provider 就是一个 `New` 函数包一个 URL 公式：

```go
func (s *TileSource) Fetch(z, x, y int) ([]byte, error) {
    return s.storage.Get(s.id, z, x, y, func() ([]byte, error) {
        return HTTPFetch(s.client, s.urlFn(z, x, y), s.id)   // 上游 HTTP 兜底
    })
}
```

内置源（[providers.go](../app/modules/maptiles/providers/providers.go)，显示顺序）：

| id | 源 | 上游 URL 要点 |
|----|----|---------------|
| `esri_satellite` | Esri World Imagery | `server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` |
| `amap_vector` | 高德矢量 | `webrd0{1-4}.is.autonavi.com/appmaptile?...&style=8`，四子域按 `(x*2+y)%4+1` 分摊 |
| `amap_road` | 高德路标 | `webst0{1-4}.is.autonavi.com/appmaptile?...&style=8`，同上分摊 |
| `bing_road` | Bing 路网 | Bing quadkey：`(x,y,z)` → quadkey |
| `osm` | OpenStreetMap | `tile.openstreetmap.org/{z}/{x}/{y}.png`，单域名 |

> 显示顺序把 `esri_satellite` 放首位，使 3D 地图默认用影像底图（地形在影像上读感最好）。具体 URL 公式以各 provider 子包代码为准。
>
> **高德两源是 GCJ-02 坐标系**（火星偏移）。在 3D 地图里用 GCJ-02 底图时必须**关闭地形 DEM**——否则 GCJ-02 底图与 MSL 地形基准不一致会出错（这也是 3D 地图 altitude-basis 设计的一个前提，见 [skills/frontend-3d-map](../skills/frontend-3d-map)）。

上游抓取统一走 [`HTTPFetch`](../app/modules/maptiles/provider.go)：单瓦片 ≤ 1 MiB、`User-Agent: DroneLogAnalyzer/1.0 (local tile proxy)`、15s 超时、最多 5 次重定向、共享 client。

## 单一共享缓存：MBTiles

所有 provider 共用一个 SQLite 文件，**一张 `tiles` 表带 `provider` 列**（不是每源一个 db）。纯 Go 驱动 `modernc.org/sqlite`（无 cgo）。存储用 TMS 的 y 翻转，对外统一 XYZ。

**缓存目录在可执行文件旁的 `db/`**（[`appcfg.CacheDir`](../app/config/paths.go) = `<exeDir>/db`，`os.Executable` 失败时回退到 `<UserConfigDir>/db`），文件 `<cacheDir>/tiles.mbtiles`——**刻意不放用户配置目录 / C 盘**，避免大缓存占用用户 profile。

## 读取管线（`Get`，per-tile `singleflight` 去重）

```
key = provider/z/x/y
  ① LRU(容量 2000，TTL 5min) 命中 → 直接返回（过期只淘汰内存条目，不动 SQLite）
  ② singleflight 去重（同 key 并发只抓一次）
  ③ SQLite 命中 → 返回；
       若 created_at 超过 7 天(tileFreshness) → 后台用 fallback 异步刷新，失败保留旧值
       否则 → markAccess（缓冲写 last_used，不逐读写库）
  ④ 未命中 → fallback(HTTP) → storeNew（入库 + 更新计数 + 可能淘汰）+ 加入 LRU
```

[storage.go](../app/modules/maptiles/storage.go) 常量：

| 常量 | 值 | 含义 |
|------|----|------|
| `DefaultMaxCacheBytes` | 500 MiB | 全部 provider 共享的总量上限 |
| `tileFreshness` | 7 天 | SQLite 条目超过此龄 → 后台刷新（保留旧值兜底） |
| `lruCapacity` / `lruTTL` | 2000 / 5 min | 内存热瓦片层 |
| `accessFlushInterval` | 30 s | `last_used` 写入合并窗口 |

`refresh` 也走 singleflight（key 加 `#refresh` 后缀），与正常 `Get` 互不阻塞。

## 容量统计与淘汰

- **各源字节数与瓦片数都在内存维护**：启动时一次 `GROUP BY provider` 聚合（`COUNT(*)` + `SUM(length(tile_data))`）预加载进内存计数器——这是进程生命周期内唯一一次全表聚合；之后所有写路径（新瓦片入库、后台刷新替换、LRU 淘汰、清空单源/全部）同步增量更新计数。`CacheStats` 因此**完全不查库**，瞬时返回（不再有每次按源 `COUNT(*)` 的开销）。
- **`last_used` 不逐读更新**：`markAccess` 把访问记进内存 map，`accessFlushLoop` 每 30s 合并成一次事务批量写。
- **淘汰**（`evictIfNeeded`，仅在 `storeNew` 后触发）：总量超 `capBytes` 时，按 `last_used ASC` 流式累积字节数直到覆盖「待释放量 = `total - cap*80%`」，取该 cutoff 时间戳**一次** `DELETE WHERE last_used <= cutoff`，按 freed 字芔回减各源计数。即「最久未用」优先，目标降到上限的 80%。
- **磁盘回收**：只在**启动时**异步跑一次 `PRAGMA incremental_vacuum`（[OpenStorage](../app/modules/maptiles/storage.go)），不每次淘汰都 `VACUUM`（避免写放大）。淘汰本身只做内存记账 + DELETE，把空闲页留给下次启动的 incremental_vacuum 收拢。

## 启用源配置

哪些源显示由 `map_providers_v1.json`（在 [`<UserConfigDir>`](../app/config/paths.go) = Windows `%APPDATA%/DroneLogAnalyzer/`）的 `enabled` 控制。[`loadMapProvidersConfig`](../app/services/mapservice/tilecache/map.go) 的合并策略：文件不存在时 seed 默认源（5 个全 enabled）；新版本新增的内置源**自动并入**（默认 enabled），**不覆盖**用户已选。`UpdatedAt` 在保存时刷新。

`MapAPI.Providers` 只返回 enabled 源（按注册顺序）；`CacheStats`/`ClearCache`/`ClearCacheProvider` 经 `TileService` 转发到共享 storage。瓦片本身走唯一 HTTP 路由 `GET /map/provider/:provider/:z/:x/:y`（[router.go](../app/transport/http/router.go)），由 `mapservice.GetTile` → `TileService.GetTile` → provider `Fetch` → storage `Get` 提供。
