package tools

import (
	"context"
	"math"
	"strconv"
	"strings"

	"github.com/cloudwego/eino/components/tool"

	"drone-log-analyzer/app/modules/fieldstats"
	"drone-log-analyzer/app/modules/knowledge"
	"drone-log-analyzer/app/services/logservice"
)

// raw 降采样预算：默认 300 点（约 1.5~2k token）已足够看趋势；上限 2000
// 防止模型显式传大值撑爆上下文。精确数值用 min/max/avg 等统计拿；
// 窄瞬态用 stats/peaks/abnormal 定位后缩窗拉 raw，或显式提 max_points。
const (
	defaultRawMaxPoints  = 300
	maxRawMaxPointsLimit = 2000
)

type signalQuery struct {
	Name      string   `json:"name" jsonschema:"required" jsonschema_description:"分组.字段，如 GPS.NSats；逗号分隔多个共享本条操作与窗口"`
	StartSec  *float64 `json:"start_sec,omitempty" jsonschema_description:"窗口起点秒（相对起点），缺省从头"`
	EndSec    *float64 `json:"end_sec,omitempty" jsonschema_description:"窗口终点秒，缺省到尾"`
	Operation string   `json:"operation" jsonschema:"required" jsonschema_description:"raw/min/max/avg/minmax/p2p/derivative/trend/peaks/abnormal"`
	Threshold *float64 `json:"threshold,omitempty" jsonschema_description:"abnormal 显式阈值，缺省用知识库阈值"`
	MaxPoints int      `json:"max_points,omitempty" jsonschema_description:"raw 点数上限，默认300"`
}

type signalInput struct {
	Queries []signalQuery `json:"queries" jsonschema:"required" jsonschema_description:"批量查询列表"`
}

// queryResult 各操作的载荷都是定长数组（列序见工具描述），绝对时刻为短格式
// （HH:MM:SS，日期基准见外层 timeBase）。命名约定：T 后缀=绝对时刻，
// At 结尾=相对秒。
type queryResult struct {
	Name    string    `json:"name"`
	Op      string    `json:"op"`
	Win     []float64 `json:"win,omitempty"`  // 实际命中窗口首末（相对秒）
	WinT    []string  `json:"winT,omitempty"` // 窗口首末绝对时刻（短格式）
	Samples int       `json:"n,omitempty"`    // 窗口样本数
	Res     float64   `json:"res,omitempty"`  // raw：平均点距秒数；窄于此的瞬态时刻被量化（极值经包络抽稀保留）

	Points     [][]float64 `json:"pts,omitempty"`   // raw：[相对秒, 值]；连续同值压缩为 [t0, 值, t1]（保持到 t1）
	Stats      []any       `json:"stats,omitempty"` // [ok,n,min,minAt,max,maxAt,avg,p2p,rms,minT,maxT]
	Derivative []any       `json:"rate,omitempty"`  // [ok,maxRate,maxRateAt,avgRate,n,maxRateT]
	Trend      []any       `json:"trend,omitempty"` // [ok,slope,方向,first,last,change,dur]
	Peaks      []any       `json:"peaks,omitempty"` // [ok,n,maxPeak,maxPeakAt,prominence,maxPeakT]
	Abnormal   [][]any     `json:"abn,omitempty"`   // 每级 [级别, 条件, [t0,t1,t0T,t1T,worst,extent] 段行]
	Error      string      `json:"error,omitempty"`
}

type signalOutput struct {
	TimeBase string        `json:"timeBase,omitempty"` // 相对秒 0 对应的绝对时刻（完整日期，本地时区）
	Dedupe   int           `json:"dedup,omitempty"`    // 被去重丢弃的重复查询数（同名/同操作/同窗口）
	Results  []queryResult `json:"results"`
}

// expandQueries 展开一条查询里的多字段名（逗号/空格/中文逗号分隔）：
// 各字段共享该条的 operation/时间窗/阈值/点数。模型写批量更省事，
// 参数也不必逐字段重复操作与窗口（上下文冗余的一个来源）。
func expandQueries(in []signalQuery) []signalQuery {
	out := make([]signalQuery, 0, len(in))
	for _, q := range in {
		names := strings.FieldsFunc(q.Name, func(r rune) bool {
			return r == ',' || r == '，' || r == ';' || r == '；' || r == ' ' || r == '\t'
		})
		if len(names) <= 1 {
			out = append(out, q)
			continue
		}
		for _, n := range names {
			nq := q
			nq.Name = n
			out = append(out, nq)
		}
	}
	return out
}

// rlePoints 压缩连续同值点：值不变的连续段（≥3 个样本）输出 [t0, v, t1]
// （值从 t0 保持到 t1），孤立点与短段保持 [t, v]。枚举/状态字段
// （GPS.Status 长段 3）与死通道（未用遥控通道全程 0）逐点重复输出是
// 纯冗余。输入须等长且已舍入（相同舍入值才视为同值）。
func rlePoints(times, values []float64) [][]float64 {
	if len(times) == 0 {
		return nil
	}
	out := make([][]float64, 0, len(times))
	i := 0
	for i < len(times) {
		j := i + 1
		for j < len(times) && values[j] == values[i] {
			j++
		}
		if j-i >= 3 {
			out = append(out, []float64{times[i], values[i], times[j-1]})
		} else {
			for k := i; k < j; k++ {
				out = append(out, []float64{times[k], values[k]})
			}
		}
		i = j
	}
	return out
}

// dedupeQueries 去掉完全相同的查询（字段/操作/窗口/阈值/点数全等，
// 名称与操作忽略大小写和空白）。模型偶尔在批量列表里塞大量重复项
// （曾出现 23 条同名查询），逐条执行会把相同结果放大返回，这里
// 只算一次、丢弃计数回传提醒。
func dedupeQueries(in []signalQuery) (kept []signalQuery, dropped int) {
	type key struct {
		name, op  string
		t0, t1    float64
		th        float64
		hasTh     bool
		maxPoints int
	}
	seen := make(map[key]bool, len(in))
	kept = make([]signalQuery, 0, len(in))
	for _, q := range in {
		k := key{
			name:      strings.ToLower(strings.TrimSpace(q.Name)),
			op:        strings.ToLower(strings.TrimSpace(q.Operation)),
			maxPoints: q.MaxPoints,
		}
		if q.StartSec != nil {
			k.t0 = *q.StartSec
		}
		if q.EndSec != nil {
			k.t1 = *q.EndSec
		}
		if q.Threshold != nil {
			k.th, k.hasTh = *q.Threshold, true
		}
		if seen[k] {
			dropped++
			continue
		}
		seen[k] = true
		kept = append(kept, q)
	}
	return kept, dropped
}

// querySignalTool 是核心数据工具：按 组.字段 + 时间窗 + 运算类型批量查询。
// 默认返回统计结果而非原始序列（raw 也会降采样），控制上下文体积。
func querySignalTool(deps Deps) (tool.InvokableTool, error) {
	return infer("query_data",
		"批量查询字段数据。name=分组.字段（如 GPS.NSats，可逗号分隔多个共享本条操作与窗口），"+
			"优先合并进一次批量、勿逐个调用（重复自动去重）。operation："+
			"raw(原始点,超量抽稀保峰值,res=点距秒)/min/max/avg/minmax/p2p/derivative/trend/"+
			"peaks/abnormal(越限段,缺省按参考阈值)。震荡信号（振动/纹波）勿拉 raw，用 minmax/"+
			"abnormal；大跨度先统计定位时段，再缩窗拉 raw。载荷列序（stats 是统计载荷名非操作名）："+
			"stats=[ok,n,min,minAt,max,maxAt,avg,p2p,rms,minT,maxT]、"+
			"rate=[ok,maxRate,maxRateAt,avgRate,n,maxRateT]、"+
			"trend=[ok,slope,dir,first,last,change,dur]、"+
			"peaks=[ok,n,maxPeak,maxPeakAt,prominence,maxPeakT]、"+
			"abn=每级[级别,条件,段行,总越限秒]（段行=[t0,t1,t0T,t1T,worst,extent]，至多50段）。"+
			"win/winT=命中窗口首末；pts 连续同值压缩为 [t0,值,t1]；"+
			"T 后缀=绝对时刻，At 结尾=相对秒；ok=false 时载荷仅为 [false]。"+
			"字段名不确定先查字段清单。",
		func(ctx context.Context, in signalInput) (signalOutput, error) {
			queries, dedup := dedupeQueries(expandQueries(in.Queries))
			results := make([]queryResult, 0, len(queries))
			for _, q := range queries {
				results = append(results, runQuery(ctx, deps, q))
			}
			return signalOutput{TimeBase: deps.Abs.Start(), Dedupe: dedup, Results: results}, nil
		})
}

func runQuery(ctx context.Context, deps Deps, q signalQuery) queryResult {
	res := queryResult{Name: q.Name}
	g, f, ok := splitFieldRef(q.Name)
	if !ok {
		res.Error = "字段名格式应为 GROUP.Field，如 GPS.NSats"
		return res
	}
	op := fieldstats.Op(strings.ToLower(strings.TrimSpace(q.Operation)))
	// 别名兜底：描述里的 "stats" 是统计载荷的统称，模型可能照抄当操作名
	// （实测出现过），归一到 minmax 避免整批报错引发重试循环。
	if op == "stats" {
		op = fieldstats.OpMinMax
	}
	if !fieldstats.ValidOp(op) {
		res.Error = "不支持的 operation: " + q.Operation
		return res
	}
	res.Op = string(op)

	sr, err := deps.Log.Series(ctx, logservice.SeriesRequest{Type: g, Field: f})
	if err != nil {
		res.Error = err.Error()
		return res
	}
	s := fieldstats.Series{Times: sr.Times, Values: sr.Values}
	t0, t1 := 0.0, 0.0
	if q.StartSec != nil {
		t0 = *q.StartSec
	}
	if q.EndSec != nil {
		t1 = *q.EndSec
	}
	win := fieldstats.Slice(s, t0, t1)
	res.Samples = win.Len()
	if win.Len() > 0 {
		res.Win = []float64{round3(win.Times[0]), round3(win.Times[win.Len()-1])}
		if deps.Abs != nil {
			res.WinT = []string{deps.Abs.AtShort(win.Times[0]), deps.Abs.AtShort(win.Times[win.Len()-1])}
		}
	}

	switch op {
	case fieldstats.OpRaw:
		maxPoints := q.MaxPoints
		if maxPoints <= 0 {
			maxPoints = defaultRawMaxPoints
		}
		if maxPoints > maxRawMaxPointsLimit {
			maxPoints = maxRawMaxPointsLimit
		}
		// 轮级预算：全部 raw 查询共享总额，预算尽返回错误引导改用统计。
		if got := deps.RawBudget.Take(maxPoints); got < 50 {
			res.Error = "本轮原始曲线点数预算已用尽——改用 minmax/peaks/abnormal 等统计操作，或缩小时间窗后重试"
			break
		} else {
			maxPoints = got
		}
		ds := fieldstats.Downsample(win, maxPoints)
		ptsT, ptsV := make([]float64, ds.Len()), make([]float64, ds.Len())
		for i := 0; i < ds.Len(); i++ {
			// 降采样点的精度收敛：t 到 0.1s、值到 0.01——点距已数百 ms 起，
			// 更细的数字是序列化浪费（精确值走统计操作）；粗舍入也让 RLE
			// 能合并更多近平坦段。
			ptsT[i] = math.Round(ds.Times[i]*10) / 10
			ptsV[i] = math.Round(ds.Values[i]*100) / 100
		}
		res.Points = rlePoints(ptsT, ptsV)
		if ds.Len() > 1 {
			res.Res = round3((win.Times[win.Len()-1] - win.Times[0]) / float64(ds.Len()))
		}
	case fieldstats.OpMin, fieldstats.OpMax, fieldstats.OpAvg,
		fieldstats.OpMinMax, fieldstats.OpP2P:
		st := fieldstats.Stats(win)
		if !st.Ok {
			res.Stats = []any{false}
			break
		}
		avg := any(st.Avg)
		if !st.HasAvg {
			avg = nil
		}
		res.Stats = []any{true, st.Count, st.Min, st.MinAt, st.Max, st.MaxAt, avg, st.P2P, st.Rms,
			deps.Abs.AtShort(st.MinAt), deps.Abs.AtShort(st.MaxAt)}
	case fieldstats.OpDerivative:
		d := fieldstats.Derivative(win)
		if !d.Ok {
			res.Derivative = []any{false}
			break
		}
		avg := any(d.AvgRate)
		if !d.HasAvg {
			avg = nil
		}
		res.Derivative = []any{true, d.MaxRate, d.MaxRateAt, avg, d.Samples, deps.Abs.AtShort(d.MaxRateAt)}
	case fieldstats.OpTrend:
		tr := fieldstats.Trend(win)
		res.Trend = []any{tr.Ok, tr.Slope, tr.Direction, tr.First, tr.Last, tr.Change, tr.Duration}
	case fieldstats.OpPeaks:
		ps := fieldstats.Peaks(win, 0)
		res.Peaks = []any{ps.Ok, ps.Count, ps.MaxPeak, ps.MaxPeakAt, ps.Prominence, deps.Abs.AtShort(ps.MaxPeakAt)}
	case fieldstats.OpAbnormal:
		res.Abnormal = runAbnormal(deps, g, f, win, q.Threshold)
		if len(res.Abnormal) == 0 {
			res.Error = "无知识库阈值也未显式给 threshold，无法判定越限"
		}
	}
	return res
}

// runAbnormal 逐级扫描越限段：显式 threshold 优先（level=custom），
// 否则用知识库字段阈值全部等级。
func runAbnormal(deps Deps, group, field string, win fieldstats.Series, explicit *float64) [][]any {
	var out [][]any
	if explicit != nil {
		cond := fieldstats.Cond{Op: "gt", Value: *explicit}
		segs := fieldstats.Abnormal(win, cond)
		rows, total := abnLevel(deps, segs)
		out = append(out, []any{"custom", condLabel(cond), rows, total})
		return out
	}
	kb := knowledge.ForFormat(deps.Format)
	if fm, ok := kb.Field(group, field); ok && knowledge.Applies(fm.AppliesTo, deps.Class) {
		for _, th := range fm.Thresholds {
			cond := fieldstats.Cond{Op: th.Op, Value: th.Value}
			if !cond.ValidOp() {
				continue
			}
			segs := fieldstats.Abnormal(win, cond)
			if len(segs) == 0 {
				continue
			}
			rows, total := abnLevel(deps, segs)
			out = append(out, []any{th.Level, condLabel(cond), rows, total})
		}
	}
	return out
}

// abnLevel 把该级越限段合并（相邻 ≤1s 的毛刺段同属一场越限风暴——
// 振动信号在阈值附近抖动会切出上千单采样段）并截断到上限，返回
// [段行, 总越限秒]（总秒按合并后全量计，截断不丢总量信息）。
func abnLevel(deps Deps, segs []fieldstats.Segment) ([][]any, float64) {
	merged := fieldstats.MergeSegments(segs, abnMergeGapSecs)
	total := 0.0
	for _, s := range merged {
		total += s.Duration
	}
	if len(merged) > maxAbnSegments {
		merged = merged[:maxAbnSegments]
	}
	return abnRows(deps, merged), round3(total)
}

// abnRows 把越限段映射为段行：[t0,t1,t0T,t1T,worst,extent]（duration=end-start
// 可推导，不占列）。
func abnRows(deps Deps, segs []fieldstats.Segment) [][]any {
	if len(segs) == 0 {
		return nil
	}
	rows := make([][]any, len(segs))
	for i, s := range segs {
		rows[i] = []any{round3(s.Start), round3(s.End),
			deps.Abs.AtShort(s.Start), deps.Abs.AtShort(s.End),
			round3(s.Worst), round3(s.Extent)}
	}
	return rows
}

func condLabel(c fieldstats.Cond) string {
	return c.Op + " " + formatFloat(c.Value)
}

// splitFieldRef 拆 "GROUP.Field"（首个点号；字段名不含点）。
func splitFieldRef(ref string) (group, field string, ok bool) {
	parts := strings.SplitN(strings.TrimSpace(ref), ".", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

// formatFloat 输出紧凑浮点（去掉多余的 0）。
func formatFloat(v float64) string {
	return strconv.FormatFloat(v, 'g', 6, 64)
}

// round3 收敛到千分位：raw 点/越限段的时间与数值对趋势阅读足够，
// 序列化后比全精度浮点省一半以上 token。精确值走统计操作。
func round3(v float64) float64 {
	return math.Round(v*1000) / 1000
}
