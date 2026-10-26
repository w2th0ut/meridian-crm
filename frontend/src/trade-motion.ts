/**
 * 客多多 · 动效控制器
 *
 * 设计约束（与 docs/DESIGN.md 一致）：
 * 1. 全站只有一处编排动效——工作台「唛头带」入场：航线描出 → 唛头依次盖下 → 数量计数。
 * 2. 其余动效只回答用户动作（切换页面时页首标题落位），不做滚动揭示、不给每张卡加抬升。
 * 3. 一律由 JS 驱动（WAAPI / requestAnimationFrame），便于统一取消、重入与降级；
 *    CSS 只保留静态样式。
 * 4. `prefers-reduced-motion: reduce` 时全部跳过，直接落到终态。
 * 5. 工作台每 60 秒会重渲染；用数据签名去重，同一份数据只播一次，重渲染只做静态重绘。
 */

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(REDUCED_QUERY).matches;
}

const EASE_OUT = 'cubic-bezier(.16, 1, .3, 1)';

/** 已播放过的市场数据签名；避免 60 秒轮询重渲染时重复播放入场。 */
let playedSignature = '';
/** 正在进行的编排，重入前先取消。 */
let runningAnimations: Animation[] = [];
let runningFrame = 0;
let lineLayer: SVGSVGElement | null = null;
let resizeBound = false;

function stopAnimations() {
  runningAnimations.forEach((animation) => {
    try { animation.cancel(); } catch { /* 元素已被替换，忽略 */ }
  });
  runningAnimations = [];
  if (runningFrame) {
    cancelAnimationFrame(runningFrame);
    runningFrame = 0;
  }
}

function play(animation: Animation): void {
  runningAnimations.push(animation);
}

/** 数字计数：0 → 目标值，等宽数字不跳动。 */
function countUp(element: HTMLElement, target: number, delay: number, duration: number): void {
  if (prefersReducedMotion()) {
    element.textContent = String(target);
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const elapsed = now - start - delay;
    if (elapsed < 0) {
      element.textContent = '0';
      runningFrame = requestAnimationFrame(step);
      return;
    }
    const progress = Math.min(1, elapsed / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = String(Math.round(target * eased));
    if (progress < 1) runningFrame = requestAnimationFrame(step);
    else element.textContent = String(target);
  };
  element.textContent = '0';
  runningFrame = requestAnimationFrame(step);
}

interface Point { x: number; y: number }

function centerOf(box: DOMRect, hostBox: DOMRect): Point {
  return {
    x: box.left - hostBox.left + box.width / 2,
    y: box.top - hostBox.top + box.height / 2
  };
}

function ensureLineLayer(host: HTMLElement): SVGSVGElement {
  // 无论上一轮用的是哪个宿主，先把页面里所有旧航线层清掉：
  // 只允许存在一层，且只挂在唛头带根节点上（避免回落成嵌套层叠加）。
  document.querySelectorAll('.kd-route-layer').forEach((node) => node.remove());
  lineLayer = null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('kd-route-layer');
  svg.style.position = 'absolute';
  svg.style.inset = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '0';
  svg.style.overflow = 'visible';
  host.prepend(svg);
  lineLayer = svg;
  return svg;
}

/**
 * 从「起运 上海」画到每枚唛头的细线。
 * 只画可见范围内的唛头；窄屏横向滚动时自动收敛。
 */
function drawRouteLines(host: HTMLElement, animate: boolean): Array<SVGPathElement> {
  const origin = host.querySelector<HTMLElement>('.mh-origin');
  const marks = Array.from(host.querySelectorAll<HTMLElement>('.mh-mark'));
  if (!host.classList.contains('mh-band')) return [];
  const svg = ensureLineLayer(host);
  // 每次重绘先清空，避免尺寸变化/重渲染后路径叠加。
  svg.replaceChildren();
  const hostBox = host.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${hostBox.width} ${hostBox.height}`);
  const originCenter = origin ? centerOf(origin.getBoundingClientRect(), hostBox) : { x: 28, y: 26 };

  const paths: SVGPathElement[] = [];
  marks.forEach((mark) => {
    const box = mark.getBoundingClientRect();
    const local = { left: box.left - hostBox.left, right: box.right - hostBox.left };
    // 完全在可视区之外（横向滚动隐藏）就不画
    if (local.right < 0 || local.left > hostBox.width) return;
    const target = centerOf(box, hostBox);
    const start = { x: originCenter.x, y: originCenter.y + 10 };
    const midX = (start.x + target.x) / 2;
    const midY = Math.min(start.y, target.y) - 16;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${midX.toFixed(1)} ${midY.toFixed(1)} ${target.x.toFixed(1)} ${(target.y - 12).toFixed(1)}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1');
    path.setAttribute('stroke-linecap', 'round');
    path.style.color = 'rgba(204, 33, 24, .28)';
    path.style.strokeDasharray = '3 5';
    svg.append(path);
    paths.push(path);
  });

  if (!animate) return paths;

  paths.forEach((path, index) => {
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    path.style.strokeDashoffset = `${length}`;
    path.style.opacity = '0';
    const animation = path.animate(
      [
        { strokeDashoffset: length, opacity: 0 },
        { strokeDashoffset: length * 0.35, opacity: 1, offset: 0.55 },
        { strokeDashoffset: 0, opacity: 1 }
      ],
      { duration: 620, delay: 60 + index * 55, easing: 'linear', fill: 'both' }
    );
    play(animation);
    animation.finished.then(() => {
      // 归位成静态虚线，避免 fill:both 长期占用合成层
      path.style.strokeDasharray = '3 5';
      path.style.strokeDashoffset = '0';
      path.style.opacity = '1';
    }).catch(() => { /* cancelled */ });
  });
  return paths;
}

function bindResize(host: HTMLElement) {
  if (resizeBound) return;
  resizeBound = true;
  let timer = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (host.isConnected && host.querySelector('.mh-mark')) drawRouteLines(host, false);
    }, 140);
  }, { passive: true });
}

export interface MarketIntroOptions {
  /** 唛头容器（#tradeRouteHero） */
  host: HTMLElement | null;
  /** 唛头带根节点（.mh-band），用于定位航线层 */
  band: HTMLElement | null;
  /** 数据签名：相同则不重复播放 */
  signature: string;
}

/**
 * 工作台唛头带入场编排（唯一一处非用户触发的动效）。
 * 顺序：航线描出 → 唛头按名次盖下 → 数字计数。
 */
export function playMarketsIntro({ host, band, signature }: MarketIntroOptions): void {
  if (!host) return;
  const marks = Array.from(host.querySelectorAll<HTMLElement>('.mh-mark'));
  if (!marks.length) {
    stopAnimations();
    playedSignature = '';
    return;
  }
  const repeated = signature === playedSignature;
  playedSignature = signature;
  stopAnimations();
  bindResize(band ?? host);

  if (prefersReducedMotion()) {
    drawRouteLines(band ?? host, false);
    return;
  }

  // 航线永远重绘（尺寸可能变了）；只有首次或数据变化时才动画
  drawRouteLines(band ?? host, !repeated);

  marks.forEach((mark, index) => {
    const count = mark.querySelector<HTMLElement>('.mh-count');
    const target = Number(count?.dataset.value || count?.textContent || '0') || 0;
    if (count) count.dataset.value = String(target);

    if (repeated) {
      if (count) count.textContent = String(target);
      mark.style.opacity = '1';
      mark.style.transform = 'none';
      return;
    }

    mark.style.transformOrigin = '50% 0%';
    const stamp = mark.animate(
      [
        { opacity: 0, transform: 'translateY(-7px) scale(.97)' },
        { opacity: 1, transform: 'translateY(0) scale(1.015)', offset: 0.62 },
        { opacity: 1, transform: 'none' }
      ],
      { duration: 300, delay: 90 + index * 55, easing: EASE_OUT, fill: 'both' }
    );
    play(stamp);
    if (count) countUp(count, target, 210 + index * 55, 520);
  });
}

/** 切换页面后让页首标题落位：只回答用户动作，短、轻、不抢戏。 */
export function playViewEnter(view: HTMLElement | null): void {
  if (!view || prefersReducedMotion()) return;
  const head = view.querySelector<HTMLElement>(
    ':scope > .page-head, :scope > .pc-head, :scope > .sh-head, :scope > .lg-head, ' +
    ':scope > .file-center-head, :scope > .exam-workspace-head, :scope > .approval-head, ' +
    ':scope > .customer-pool-head, :scope > .th-page-head, :scope > .kb-head, ' +
    ':scope > .todo-page-head, :scope > .dashboard-masthead'
  );
  if (!head) return;
  const targets = Array.from(head.querySelectorAll<HTMLElement>('h1, .head-actions, .page-head-actions, .dashboard-masthead-side'));
  targets.forEach((element) => {
    const animation = element.animate(
      [
        { opacity: 0, transform: 'translateY(9px)' },
        { opacity: 1, transform: 'none' }
      ],
      { duration: 240, delay: 20, easing: EASE_OUT, fill: 'both' }
    );
    animation.finished.then(() => {
      element.style.opacity = '';
      element.style.transform = '';
    }).catch(() => { /* cancelled */ });
  });
}

/** 登出或清空数据时复位，避免下次进入误判为“已播放”。 */
export function resetMotionState(): void {
  stopAnimations();
  playedSignature = '';
  lineLayer?.remove();
  lineLayer = null;
}
