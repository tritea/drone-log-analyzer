// Package fieldstats 提供数值序列（带时间戳）的时间窗统计运算（纯模块）：
// 最值/均值/峰峰值、变化率、趋势、峰值检测、越限段、降采样。
// 输入输出均为纯数据结构，不 import parser/services，可独立表驱动单测。
// 所有运算跳过非有限值（NaN/±Inf），保证结果可安全 JSON 序列化。
package fieldstats

// Op 是查询运算类型。
type Op string

const (
	OpRaw        Op = "raw"        // 降采样原始序列
	OpMin        Op = "min"        // 窗口最小值
	OpMax        Op = "max"        // 窗口最大值
	OpAvg        Op = "avg"        // 窗口均值
	OpMinMax     Op = "minmax"     // 同时返回 min/max
	OpP2P        Op = "p2p"        // 峰峰值 max-min
	OpDerivative Op = "derivative" // 变化率（最大/平均速率）
	OpTrend      Op = "trend"      // 趋势（线性回归斜率 + 方向）
	OpPeaks      Op = "peaks"      // 峰值检测
	OpAbnormal   Op = "abnormal"   // 越限段
)

// ValidOp 判断 op 是否受支持。
func ValidOp(op Op) bool {
	switch op {
	case OpRaw, OpMin, OpMax, OpAvg, OpMinMax, OpP2P, OpDerivative, OpTrend, OpPeaks, OpAbnormal:
		return true
	}
	return false
}

// Series 是一条并行等长的输入序列，Times 单位秒且单调不减。
type Series struct {
	Times  []float64
	Values []float64
}

// Len 返回样本数（Times/Values 取小者，异常输入按 0 处理）。
func (s Series) Len() int {
	return min(len(s.Times), len(s.Values))
}
