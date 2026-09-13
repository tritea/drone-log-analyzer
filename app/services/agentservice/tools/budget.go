package tools

import "sync"

// RawBudget 是轮级原始点预算：一轮诊断里所有 raw 查询共享总额。ReAct
// 每次迭代重发全部历史，约 6 万 token 的原始序列在 20 次迭代下会被
// 放大到百万 token 级——总额封顶从根上限制重发质量。工具实例跨迭代
// 复用、eino 可并行执行同消息的多个调用，须并发安全。
type RawBudget struct {
	mu   sync.Mutex
	left int // 剩余可分配点数
}

// NewRawBudget 建立总额为 total 的预算。
func NewRawBudget(total int) *RawBudget {
	return &RawBudget{left: total}
}

// take 申请 want 个点，返回实际可分配数（≤want；预算尽返回 0）。nil 接收者
// 不设限（测试/独立使用）。
func (b *RawBudget) Take(want int) int {
	if b == nil {
		return want
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	got := min(want, b.left)
	b.left -= got
	return got
}
