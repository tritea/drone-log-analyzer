import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const GAP = 12; 
const MORE_W = 72; 

export function useToolbarOverflow() {
  const containerRef = ref<HTMLElement | null>(null);
  const primaryRef = ref<HTMLElement | null>(null);
  const trailingRef = ref<HTMLElement | null>(null);
  const measureRef = ref<HTMLElement | null>(null);
  const overflowCount = ref(0);

  const overflowOpen = ref(false);
  const moreBtnRef = ref<HTMLElement | null>(null);
  const popupRef = ref<HTMLElement | null>(null);
  const popupStyle = ref<Record<string, string>>({});

  function recompute(): void {
    const c = containerRef.value;
    const prim = primaryRef.value;
    const meas = measureRef.value;
    if (!c || !prim || !meas) return;
    const avail = c.clientWidth;
    const primW = prim.offsetWidth;
    const trailW = trailingRef.value ? trailingRef.value.offsetWidth : 0;
    const widths: number[] = [];
    for (let i = 0; i < meas.children.length; i++) widths.push((meas.children[i] as HTMLElement).offsetWidth);
    const n = widths.length;
    if (!n) { overflowCount.value = 0; return; }
    const prefix = [0];
    for (let i = 0; i < n; i++) prefix.push(prefix[i] + widths[i]);
    if (primW + trailW + prefix[n] + (n + 1) * GAP <= avail) { overflowCount.value = 0; return; }
    let fit = 0;
    for (let k = 1; k <= n; k++) {
      if (primW + trailW + MORE_W + prefix[k] + (k + 2) * GAP <= avail) fit = k;
      else break;
    }
    overflowCount.value = n - fit;
  }

  function positionPopup(): void {
    const btn = moreBtnRef.value;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    popupStyle.value = {
      top: r.bottom + 6 + 'px',
      right: document.documentElement.clientWidth - r.right + 'px',
    };
  }
  function togglePopup(): void {
    overflowOpen.value = !overflowOpen.value;
    if (overflowOpen.value) nextTick(positionPopup);
  }
  function onWinResize(): void {
    recompute();
    if (overflowOpen.value) positionPopup();
  }
  function onDocDown(e: MouseEvent): void {
    if (!overflowOpen.value) return;
    const t = e.target as Node;
    if (moreBtnRef.value && moreBtnRef.value.contains(t)) return;
    if (popupRef.value && popupRef.value.contains(t)) return;
    overflowOpen.value = false;
  }

  let ro: ResizeObserver | null = null;
  function observeContainer(): void {
    if (ro) { ro.disconnect(); ro = null; }
    const el = containerRef.value;
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => recompute());
      ro.observe(el);
    }
    recompute();
    nextTick(recompute);
  }
  onMounted(() => {
    observeContainer();
    window.addEventListener('resize', onWinResize);
    document.addEventListener('mousedown', onDocDown);
  });
  watch(containerRef, () => observeContainer());
  onBeforeUnmount(() => {
    if (ro) ro.disconnect();
    window.removeEventListener('resize', onWinResize);
    document.removeEventListener('mousedown', onDocDown);
  });

  return {
    containerRef, primaryRef, trailingRef, measureRef, overflowCount, recompute,
    overflowOpen, moreBtnRef, popupRef, popupStyle, togglePopup,
  };
}
