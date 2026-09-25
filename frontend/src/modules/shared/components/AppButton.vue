<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'

/**
 * 通用按钮。取代散落各处的 `<button class="btn ..."><AppIcon/><span/></button>` 手写模式，
 * 统一 variant/size/icon 语义（消除 danger 多种写法、token 顺序不稳等问题）。
 *
 * 样式由全局 `app-btn` 类族提供（见 styles/_button.scss），非 scoped——见该文件注释。
 * 上下文钩子类（open-file-btn/metric-add-btn 等）经 class 透传到根 button，仍是全局类、照常生效。
 * 文本走默认 slot 且【不包额外 span】，以保留旧级联（如 .chart-toolbar span 规则）的行为。
 */
interface Props {
  variant?: 'default' | 'primary' | 'danger'
  size?: 'md' | 'xs'
  icon?: string
  iconRight?: boolean
  iconOnly?: boolean
  ghost?: boolean
  active?: boolean
  disabled?: boolean
  title?: string
  type?: 'button' | 'submit'
  /** 显式覆盖图标尺寸（px）；不传则按 size 推断（xs→13，md→15）。用于密集行内的小移除按钮。 */
  iconSize?: number
}
const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  size: 'md',
  type: 'button',
})

const effectiveIconSize = computed(() => props.iconSize ?? (props.size === 'xs' ? 13 : 15))
</script>

<template>
  <button
    :type="type"
    :title="title"
    :disabled="disabled"
    class="app-btn"
    :class="{
      'is-primary': variant === 'primary',
      'is-danger': variant === 'danger',
      'is-xs': size === 'xs',
      'is-icon-only': iconOnly,
      'is-ghost': ghost,
      'is-active': active,
    }"
  >
    <AppIcon v-if="icon && !iconRight" :name="icon" :size="effectiveIconSize" />
    <slot />
    <AppIcon v-if="icon && iconRight" :name="icon" :size="effectiveIconSize" />
  </button>
</template>
