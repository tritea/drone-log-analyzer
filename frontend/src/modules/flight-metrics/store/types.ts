import type { MetricBarOrient, MetricFieldSettings, MetricItem, MetricRender } from '@/types';

/** 字段选择对话框的全部临时状态（新建/编辑 metric 时复用同一份）。 */
export interface PickerState {
  open: boolean;
  editingId: string;
  selected: Record<string, boolean>;
  fieldSettings: Record<string, MetricFieldSettings>;
  name: string;
  render: MetricRender;
  orient: MetricBarOrient;
  filter: string;
  expanded: Record<string, boolean>;
}

/** flight-metrics store 的全部响应式状态。 */
export interface MetricState {
  items: MetricItem[];
  restoring: boolean;
  saveTimer: ReturnType<typeof setTimeout> | null;
  started: boolean;
  picker: PickerState;
}

/** 从磁盘读回的配置文档（边界数据，字段需运行时 narrow）。 */
export interface MetricsDoc {
  items: unknown[];
  version?: number;
}

export interface MetricsLoadResult {
  error?: string;
  metrics?: MetricsDoc;
}

/** 一份清空的 picker，供打开新建对话框时整体复位。 */
export function blankPicker(): PickerState {
  return {
    open: false,
    editingId: '',
    selected: {},
    fieldSettings: {},
    name: '',
    render: 'number',
    orient: 'horizontal',
    filter: '',
    expanded: {},
  };
}
