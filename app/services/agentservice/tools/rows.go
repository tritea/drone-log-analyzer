package tools

// rows.go — 行数组编码助手。列表型工具输出用 cols（列名，只出现一次）+
// rows（行数据）代替对象数组，键名不随条目重复（省 token）。约定：
//   - 行尾可选列缺省由 trimRow 裁掉（trailing-omit）；中段缺省必须占位
//     （字符串用 ""，数组/指针用 nil → null）保持列位置对齐。
//   - 行用 []any 构造，序列化交给 sonic，无需手工转义。

import (
	"drone-log-analyzer/app/modules/knowledge"
)

// trimRow 去掉行尾的 nil 单元格（可选列缺省），返回原切片前缀。
func trimRow(row []any) []any {
	for len(row) > 0 && row[len(row)-1] == nil {
		row = row[:len(row)-1]
	}
	return row
}

// ptrVal 把可省略数值指针展开为单元格值：nil → nil（行尾被 trimRow 裁掉）。
func ptrVal(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

// strOrNil 空串 → nil（用于行尾可选字符串列）。
func strOrNil(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// strsOrNil 空串数组 → nil。
func strsOrNil(ss []string) any {
	if len(ss) == 0 {
		return nil
	}
	return ss
}

// thrRows 阈值列表 → [级别,op,值] 行数组；空 → nil。
func thrRows(ts []knowledge.Threshold) any {
	if len(ts) == 0 {
		return nil
	}
	rows := make([][]any, len(ts))
	for i, t := range ts {
		rows[i] = []any{t.Level, t.Op, t.Value}
	}
	return rows
}

// nameOrID 名称缺省时回退 "#<id>"，合并名称/编号两列为一格。
func nameOrID(name string, id int) string {
	if name != "" {
		return name
	}
	return "#" + formatFloat(float64(id))
}
