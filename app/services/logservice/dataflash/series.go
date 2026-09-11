package dataflash

import (
	"context"
	"fmt"

	"drone-log-analyzer/app/services/logservice"
)

// Series 返回一条曲线的 (相对秒, 数值) 序列。所有 group 的 TypeBody 各自有
// BaseTimeMs 原点（同一时钟：启动毫秒或 UTC 回基），Series 统一减去日志内
// 最早原点，使跨 group 的时间窗可对齐。
func (s *service) Series(ctx context.Context, req logservice.SeriesRequest) (*logservice.SeriesResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lg, err := s.current()
	if err != nil {
		return nil, err
	}
	curves, ok := lg.Curves[req.Type]
	if !ok {
		return nil, fmt.Errorf("%w: %s", logservice.ErrTypeNotFound, req.Type)
	}
	cd, ok := curves[req.Field]
	if !ok {
		return nil, fmt.Errorf("%w: %s.%s", logservice.ErrTypeNotFound, req.Type, req.Field)
	}

	times, values := lg.CurveSeries(cd)
	resp := &logservice.SeriesResponse{Type: req.Type, Field: req.Field}
	resp.Times = make([]float64, len(times))
	for i, t := range times {
		resp.Times[i] = (t - s.startMs) / 1000.0
	}
	resp.Values = values
	return resp, nil
}
