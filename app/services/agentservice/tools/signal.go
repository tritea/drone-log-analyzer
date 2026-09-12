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

// raw 降采样预算：默认 600 点（约 3~4k token）已足够看趋势；上限 2000
// 防止模型显式传大值撑爆上下文。精确数值用 min/max/avg 等统计拿。
const (
	defaultRawMaxPoints  = 600
	maxRawMaxPointsLimit = 2000
)

type signalQuery struct {
	Name      string   `json:"name" jsonschema:"required" jsonschema_description:"字段全名 GROUP.Field，如 GPS.NSats、CTUN.ThrOut"`
	StartSec  *float64 `json:"start_sec,omitempty" jsonschema_description:"窗口起点（秒，相对日志起点），缺省=从头"`
	EndSec    *float64 `json:"end_sec,omitempty" jsonschema_description:"窗口终点（秒），缺省=到尾"`
	Operation string   `json:"operation" jsonschema:"required" jsonschema_description:"raw/min/max/avg/minmax/p2p/derivative/trend/peaks/abnormal"`
	Threshold *float64 `json:"threshold,omitempty" jsonschema_description:"abnormal 的显式阈值；缺省用知识库分级阈值"`
	MaxPoints int      `json:"max_points,omitempty" jsonschema_description:"raw 的降采样点数上限，默认600"`
}

type signalInput struct {
	Queries []signalQuery `json:"queries" jsonschema:"required" jsonschema_description:"批量查询，一次返回全部结果"`
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

	Points     [][]float64 `json:"pts,omitempty"`   // raw：[相对秒, 值]
	Stats      []any       `json:"stats,omitempty"` // [ok,n,min,minAt,max,maxAt,avg,p2p,minT,maxT]
	Derivative []any       `json:"rate,omitempty"`  // [ok,maxRate,maxRateAt,avgRate,n,maxRateT]
	Trend      []any       `json:"trend,omitempty"` // [ok,slope,方向,first,last,change,dur]
	Peaks      []any       `json:"peaks,omitempty"` // [ok,n,maxPeak,maxPeakAt,prominence,maxPeakT]
	Abnormal   [][]any     `json:"abn,omitempty"`   // 每级 [级别, 条件, [t0,t1,t0T,t1T,worst,extent] 段行]
	Error      string      `json:"error,omitempty"`
}

type signalOutput struct {
	TimeBase string        `json:"timeBase,omitempty"` // 相对秒 0 对应的绝对时刻（完整日期，本地时区）
	Results  []queryResult `json:"results"`
}

// querySignalTool 是核心数据工具：按 组.字段 + 时间窗 + 运算类型批量查询。
// 默认返回统计结果而非原始序列（raw 也会降采样），控制上下文体积。
func querySignalTool(deps Deps) (tool.InvokableTool, error) {
	return infer("query_data",
		"按 分组.字段（如 GPS.NSats）批量查询时间窗内的数据。operation 可选："+
			"raw(原始点,超量自动抽稀)/min/max/avg/minmax/p2p(峰峰值)/derivative(变化率)/"+
			"trend(趋势)/peaks(峰值检测)/abnormal(越限段,缺省按参考阈值)。"+
			"时间单位秒、相对日志起点；win/winT=实际命中窗口首末（相对秒/绝对时刻）。"+
			"各操作载荷为定长数组：stats=[ok,n,min,minAt,max,maxAt,avg,p2p,minT,maxT]、"+
			"rate=[ok,maxRate,maxRateAt,avgRate,n,maxRateT]、"+
			"trend=[ok,slope,dir,first,last,change,dur]、"+
			"peaks=[ok,n,maxPeak,maxPeakAt,prominence,maxPeakT]、"+
			"abn=每级[级别,条件,[t0,t1,t0T,t1T,worst,extent]段行]（段为 null=该级无越限）。"+
			"T 后缀=绝对时刻，At 结尾=相对秒；stats/rate 的 ok=false 时载荷仅为 [false]。"+
			"不确定字段名先查字段清单。",
		func(ctx context.Context, in signalInput) (signalOutput, error) {
			results := make([]queryResult, 0, len(in.Queries))
			for _, q := range in.Queries {
				results = append(results, runQuery(ctx, deps, q))
			}
			return signalOutput{TimeBase: deps.Abs.Start(), Results: results}, nil
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
		ds := fieldstats.Downsample(win, maxPoints)
		res.Points = make([][]float64, ds.Len())
		for i := 0; i < ds.Len(); i++ {
			res.Points[i] = []float64{round3(ds.Times[i]), round3(ds.Values[i])}
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
		res.Stats = []any{true, st.Count, st.Min, st.MinAt, st.Max, st.MaxAt, avg, st.P2P,
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
		out = append(out, []any{"custom", condLabel(cond), abnRows(deps, segs)})
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
			out = append(out, []any{th.Level, condLabel(cond), abnRows(deps, segs)})
		}
	}
	return out
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
