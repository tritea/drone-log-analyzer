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
	StartAt   *float64 `json:"start_at,omitempty" jsonschema_description:"窗口起点（秒，相对日志起点），缺省=从头"`
	EndAt     *float64 `json:"end_at,omitempty" jsonschema_description:"窗口终点（秒），缺省=到尾"`
	Operation string   `json:"operation" jsonschema:"required" jsonschema_description:"raw/min/max/avg/minmax/p2p/derivative/trend/peaks/abnormal"`
	Threshold *float64 `json:"threshold,omitempty" jsonschema_description:"abnormal 的显式阈值；缺省用知识库分级阈值"`
	MaxPoints int      `json:"max_points,omitempty" jsonschema_description:"raw 的降采样点数上限，默认2000"`
}

type signalInput struct {
	Queries []signalQuery `json:"queries" jsonschema:"required" jsonschema_description:"批量查询，一次返回全部结果"`
}

type abnormalLevel struct {
	Level    string       `json:"level"`
	Cond     string       `json:"cond"` // 如 "lt 5"
	Segments []abnSegment `json:"segments"`
}

// abnSegment 是越限段的对外形态：相对秒 + 绝对时刻（供报告直接引用）。
type abnSegment struct {
	Start    float64 `json:"start"`
	End      float64 `json:"end"`
	StartAt  string  `json:"startAt,omitempty"` // 绝对时刻（本地时区）
	EndAt    string  `json:"endAt,omitempty"`
	Duration float64 `json:"duration"`
	Worst    float64 `json:"worst"`
	Extent   float64 `json:"extent"`
}

type queryResult struct {
	Name      string  `json:"name"`
	Operation string  `json:"operation"`
	StartAt   float64 `json:"startAt"`
	EndAt     float64 `json:"endAt"`
	TimeBase  string  `json:"timeBase,omitempty"` // 相对秒 0 对应的绝对时刻（本地时区）
	Samples   int     `json:"samples,omitempty"`

	Points     [][2]float64                `json:"points,omitempty"` // raw
	Stats      *fieldstats.BasicStats      `json:"stats,omitempty"`  // min/max/avg/minmax/p2p
	Derivative *fieldstats.DerivativeStats `json:"derivative,omitempty"`
	Trend      *fieldstats.TrendStats      `json:"trend,omitempty"`
	Peaks      *fieldstats.PeakStats       `json:"peaks,omitempty"`
	Abnormal   []abnormalLevel             `json:"abnormal,omitempty"`

	WindowStart   float64 `json:"windowStart,omitempty"` // 实际命中的窗口首末时刻
	WindowEnd     float64 `json:"windowEnd,omitempty"`
	WindowStartAt string  `json:"windowStartAt,omitempty"` // 窗口首末的绝对时刻
	WindowEndAt   string  `json:"windowEndAt,omitempty"`
	Error         string  `json:"error,omitempty"`
}

type signalOutput struct {
	Results []queryResult `json:"results"`
}

// querySignalTool 是核心数据工具：按 组.字段 + 时间窗 + 运算类型批量查询。
// 默认返回统计结果而非原始序列（raw 也会降采样），控制上下文体积。
func querySignalTool(deps Deps) (tool.InvokableTool, error) {
	return infer("query_data",
		"按 分组.字段（如 GPS.NSats）批量查询时间窗内的数据。operation 可选："+
			"raw(原始点,超量自动抽稀)/min/max/avg/minmax/p2p(峰峰值)/derivative(变化率)/"+
			"trend(趋势)/peaks(峰值检测)/abnormal(越限段,缺省按参考阈值)。"+
			"时间单位秒、相对日志起点。不确定字段名先查字段清单。",
		func(ctx context.Context, in signalInput) (signalOutput, error) {
			results := make([]queryResult, 0, len(in.Queries))
			for _, q := range in.Queries {
				results = append(results, runQuery(ctx, deps, q))
			}
			return signalOutput{Results: results}, nil
		})
}

func runQuery(ctx context.Context, deps Deps, q signalQuery) queryResult {
	res := queryResult{Name: q.Name, Operation: q.Operation}
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

	sr, err := deps.Log.Series(ctx, logservice.SeriesRequest{Type: g, Field: f})
	if err != nil {
		res.Error = err.Error()
		return res
	}
	s := fieldstats.Series{Times: sr.Times, Values: sr.Values}
	t0, t1 := 0.0, 0.0
	if q.StartAt != nil {
		t0 = *q.StartAt
	}
	if q.EndAt != nil {
		t1 = *q.EndAt
	}
	res.StartAt, res.EndAt = t0, t1
	res.TimeBase = deps.Abs.Start()
	win := fieldstats.Slice(s, t0, t1)
	res.Samples = win.Len()
	if win.Len() > 0 {
		res.WindowStart = win.Times[0]
		res.WindowEnd = win.Times[win.Len()-1]
		res.WindowStartAt = deps.Abs.At(res.WindowStart)
		res.WindowEndAt = deps.Abs.At(res.WindowEnd)
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
		res.Points = make([][2]float64, ds.Len())
		for i := 0; i < ds.Len(); i++ {
			res.Points[i] = [2]float64{round3(ds.Times[i]), round3(ds.Values[i])}
		}
	case fieldstats.OpMin, fieldstats.OpMax, fieldstats.OpAvg,
		fieldstats.OpMinMax, fieldstats.OpP2P:
		st := fieldstats.Stats(win)
		res.Stats = &st
	case fieldstats.OpDerivative:
		d := fieldstats.Derivative(win)
		res.Derivative = &d
	case fieldstats.OpTrend:
		tr := fieldstats.Trend(win)
		res.Trend = &tr
	case fieldstats.OpPeaks:
		ps := fieldstats.Peaks(win, 0)
		res.Peaks = &ps
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
func runAbnormal(deps Deps, group, field string, win fieldstats.Series, explicit *float64) []abnormalLevel {
	var out []abnormalLevel
	if explicit != nil {
		cond := fieldstats.Cond{Op: "gt", Value: *explicit}
		segs := fieldstats.Abnormal(win, cond)
		out = append(out, abnormalLevel{
			Level: "custom", Cond: condLabel(cond), Segments: toAbnSegments(deps, segs),
		})
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
			out = append(out, abnormalLevel{
				Level: th.Level, Cond: condLabel(cond), Segments: toAbnSegments(deps, segs),
			})
		}
	}
	return out
}

// toAbnSegments 把统计段映射为对外形态（附绝对时刻）。
func toAbnSegments(deps Deps, segs []fieldstats.Segment) []abnSegment {
	if len(segs) == 0 {
		return nil
	}
	out := make([]abnSegment, len(segs))
	for i, s := range segs {
		out[i] = abnSegment{
			Start: round3(s.Start), End: round3(s.End),
			StartAt: deps.Abs.At(s.Start), EndAt: deps.Abs.At(s.End),
			Duration: round3(s.Duration), Worst: round3(s.Worst), Extent: round3(s.Extent),
		}
	}
	return out
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
