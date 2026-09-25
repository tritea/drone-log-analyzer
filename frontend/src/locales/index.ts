/**
 * i18n 单例（叶子模块：不 import 任何 modules/stores，可被任意层安全引用）。
 *
 * 组件内用 `const { t } = useI18n()`；store/utils 等非组件环境用 `tr()`——
 * 二者都读全局 locale ref，语言切换即时生效。
 */
import { createI18n } from 'vue-i18n';
import zhCN from './zh-CN';
import enUS from './en-US';

export type AppLocale = 'zh-CN' | 'en-US';
export const LOCALES: readonly AppLocale[] = ['zh-CN', 'en-US'];

/** 首次启动跟随系统语言（无保存偏好时）；手动切换后持久化偏好优先。 */
export function detectLocale(): AppLocale {
  return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'zh-CN',
  globalInjection: true,
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
});

/** 非组件环境的翻译入口（读全局 locale，具响应性）。 */
export function tr(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params ?? {});
}

/**
 * 姿态/位置源等 profile 标签的展示名：词条 `profiles.labels.<label>` 命中则翻译
 * （如 apm 的 'ATT 实际'），否则原样返回（profile 自带的英文标签）。
 */
export function sourceLabel(label: string): string {
  const key = 'profiles.labels.' + label;
  return i18n.global.te(key) ? tr(key) : label;
}
