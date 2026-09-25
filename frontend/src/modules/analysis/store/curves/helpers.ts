/** 曲线域小工具：错误描述与配置响应判错（save/lifecycle/groups 共用）。 */
export const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const isConfigError = (res: unknown): res is { error: string } =>
  !!res && typeof res === 'object' && !Array.isArray(res) && typeof (res as { error?: unknown }).error === 'string';
