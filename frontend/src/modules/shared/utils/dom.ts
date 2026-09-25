
import type { ComponentPublicInstance } from 'vue'

/** 模板 ref 函数形式回调的入参：原生元素、组件实例或 null。store 的 register 方法用此类型，在内部 instanceof 收窄。 */
export type TemplateRefTarget = Element | ComponentPublicInstance | null

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as HTMLElement;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || !!el.isContentEditable;
}

export function hasDraggedFiles(e: DragEvent): boolean {
  const types = e.dataTransfer && e.dataTransfer.types;
  if (!types) return false;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'Files') return true;
  }
  return false;
}
