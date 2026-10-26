/**
 * 客多多 · 系统后台「控制台」表现层
 *
 * 只做两件事，且全部基于页面里真实存在的内容，不编造指标：
 * 1. 控制台状态带（.kd-rail）：把这一页的关键读数提出来，一眼看到"开着什么、缺什么"。
 * 2. 授权范围矩阵带（.kd-scope）：把"选了下拉框"翻译成 5 段可读的仪表，
 *    用户改选择时即时更新（回答动作的动效，不做装饰动画）。
 *
 * 幂等：已挂载的节点带 data-kd-* 标记；异步重渲染后由 MutationObserver 补挂。
 */

const ADMIN_VIEW_IDS = [
  'settings',
  'database-maintenance',
  'logs',
  'ai-config',
  'theme',
  'approval-workflows',
  'member-management',
  'organization-structure',
  'role-management',
  'ui-access',
  'member-authorization',
  'permission-audit',
  'platform-operations'
] as const;

type HealthState = { ok: boolean; store: string; queue: string; degraded: boolean };

let healthCache: HealthState | null = null;
let healthRequest: Promise<HealthState | null> | null = null;

function readHealth(): Promise<HealthState | null> {
  if (healthCache) return Promise.resolve(healthCache);
  if (healthRequest) return healthRequest;
  healthRequest = fetch('/api/health', { credentials: 'same-origin' })
    .then((response) => (response.ok ? response.json() : null))
    .then((payload: unknown) => {
      const body = (payload || {}) as { ok?: boolean; store?: string; prospectQueue?: { degraded?: boolean; mode?: string; running?: boolean } };
      const queue = body.prospectQueue;
      const state: HealthState = {
        ok: body.ok === true,
        store: String(body.store || '未知'),
        queue: queue ? (queue.running ? (queue.degraded ? '降级运行' : '运行中') : '未运行') : '未配置',
        degraded: Boolean(queue?.degraded)
      };
      healthCache = state;
      return state;
    })
    .catch(() => null)
    .finally(() => { healthRequest = null; });
  return healthRequest;
}

type Cell = { label: string; value: string; note?: string; tone?: 'ok' | 'warn' | 'danger' | 'idle' };

function count(selector: string, root: ParentNode): number {
  return root.querySelectorAll(selector).length;
}

function text(selector: string, root: ParentNode): string {
  const node = root.querySelector(selector);
  return node?.textContent?.trim() || '';
}

/** 每页的读数：全部来自当前 DOM，取不到就不显示该项。 */
function pageCells(view: HTMLElement, health: HealthState | null): Cell[] {
  const cells: Cell[] = [];
  const id = view.id;

  if (id === 'role-management') {
    const selects = Array.from(view.querySelectorAll<HTMLSelectElement>('select[data-ac-role-scope]'));
    const granted = selects.filter((select) => select.value !== 'none').length;
    const fullTenant = selects.filter((select) => select.value === 'tenant').length;
    cells.push({ label: '角色模板', value: String(count('.ac-role-item', view)) });
    cells.push({ label: '权限项', value: String(selects.length), note: `${count('.ac-module-row', view)} 个模块` });
    cells.push({ label: '已授权', value: String(granted), tone: granted ? 'ok' : 'idle', note: selects.length ? `${Math.round((granted / selects.length) * 100)}%` : '' });
    cells.push({ label: '全公司范围', value: String(fullTenant), tone: fullTenant ? 'danger' : 'idle', note: fullTenant ? '需复核' : '无' });
  } else if (id === 'organization-structure') {
    cells.push({ label: '组织节点', value: String(count('.ac-tree-row', view)) });
    cells.push({ label: '成员', value: String(count('.ac-member-table tbody tr', view) || count('[data-ac-search-row]', view)) });
    cells.push({ label: '未分配', value: String(count('[data-ac-org-filter="unassigned"]', view)), tone: 'warn' });
  } else if (id === 'member-management' || id === 'member-authorization') {
    const rows = count('table tbody tr[data-ac-search-row]', view) || count('table tbody tr', view);
    cells.push({ label: '成员', value: String(rows) });
    cells.push({ label: '启用', value: String(count('.ac-status-chip.active', view)), tone: 'ok' });
    cells.push({ label: '停用', value: String(count('.ac-status-chip.disabled', view) || count('.ac-status-chip.inactive', view)), tone: 'warn' });
  } else if (id === 'ui-access') {
    const total = count('.ac-ui-card', view);
    const open = count('.ac-ui-card.is-active', view);
    const partial = count('.ac-ui-card.is-warning', view);
    cells.push({ label: '模块', value: String(total) });
    cells.push({ label: '已开通', value: String(open), tone: 'ok' });
    cells.push({ label: '部分开通', value: String(partial), tone: partial ? 'warn' : 'idle' });
    cells.push({ label: '未开通', value: String(Math.max(0, total - open - partial)) });
  } else if (id === 'permission-audit') {
    const rows = count('table tbody tr', view);
    cells.push({ label: '审计记录', value: String(rows) });
    cells.push({ label: '拒绝', value: String(count('[class*="denied"]', view) || count('[class*="deny"]', view)), tone: 'danger' });
    cells.push({ label: '当前筛选', value: text('.ac-pane-title span', view) || '全部' });
  } else if (id === 'database-maintenance') {
    cells.push({ label: '存储', value: text('#databaseStoreState', view) || '读取中', note: text('#databaseStoreMeta', view), tone: 'ok' });
    cells.push({ label: '备份策略', value: text('#databaseBackupPolicy', view) || '读取中', note: text('#databaseBackupPolicyMeta', view) });
    cells.push({ label: '最近任务', value: text('#databaseLatestTask', view) || '暂无', note: text('#databaseLatestTaskMeta', view) });
  } else if (id === 'logs') {
    const rows = count('tbody tr', view);
    cells.push({ label: '日志条目', value: String(rows) });
    cells.push({ label: '当前筛选', value: text('.lg-chip.is-active', view) || '全部' });
    cells.push({ label: '导出', value: '可用', tone: 'ok' });
  } else if (id === 'settings') {
    const switches = Array.from(view.querySelectorAll<HTMLInputElement>('.system-setting-switch input[type="checkbox"]'));
    const on = switches.filter((input) => input.checked).length;
    cells.push({ label: '设置项', value: String(count('.setting-row', view) || switches.length) });
    cells.push({ label: '已启用', value: String(on), tone: 'ok' });
    cells.push({ label: '未启用', value: String(Math.max(0, switches.length - on)), tone: 'idle' });
  } else if (id === 'ai-config') {
    cells.push({ label: 'AI 实例', value: String(count('.ai-instance-list > *', view)) });
    cells.push({ label: '配置项', value: String(count('.ai-config-card, .ac-ui-card', view)) });
  } else if (id === 'theme') {
    cells.push({ label: '预设主题', value: String(count('.th-preset', view)) });
    cells.push({ label: '当前', value: text('.th-preset.is-active .th-preset-meta b', view) || '默认' , tone: 'ok' });
  } else if (id === 'approval-workflows') {
    cells.push({ label: '流程', value: String(count('table tbody tr', view)) });
    cells.push({ label: '节点库', value: String(count('[data-approval-palette]', view)) });
  } else if (id === 'platform-operations') {
    cells.push({ label: '公司', value: String(count('[data-platform-company], tbody tr', view)) });
  }

  if (health) {
    cells.push({
      label: '服务',
      value: health.ok ? '正常' : '异常',
      note: `${health.store} · 队列${health.queue}`,
      tone: health.ok ? (health.degraded ? 'warn' : 'ok') : 'danger'
    });
  }
  return cells;
}

function buildRail(view: HTMLElement, health: HealthState | null): HTMLElement {
  const rail = document.createElement('div');
  rail.className = 'kd-rail';
  rail.dataset.kdRail = view.id;
  rail.setAttribute('role', 'group');
  rail.setAttribute('aria-label', '本页读数');
  const cells = pageCells(view, health);
  rail.innerHTML = cells.map((cell) => `
    <div class="kd-rail-cell" data-tone="${cell.tone || 'idle'}">
      <span class="kd-rail-dot" aria-hidden="true"></span>
      <span class="kd-rail-copy">
        <span class="kd-rail-label">${escapeHtml(cell.label)}</span>
        <span class="kd-rail-value">${escapeHtml(cell.value)}${cell.note ? ` <small>${escapeHtml(cell.note)}</small>` : ''}</span>
      </span>
    </div>`).join('');
  return rail;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

function headOf(view: HTMLElement): HTMLElement | null {
  // 权限类页面由 .ac-root 内部渲染页首，其余页面是视图直接子节点
  return view.querySelector<HTMLElement>(
    ':scope > .page-head, :scope > .th-page-head, :scope > .approval-head, :scope > .file-center-head, ' +
    '.ac-root > .ac-shell > .ac-page-head'
  );
}

function syncRail(view: HTMLElement): void {
  // 权限页的状态带在 .ac-shell 里，不能用 :scope > 查找，否则每次都会重复插入。
  const rails = Array.from(view.querySelectorAll<HTMLElement>('.kd-rail'));
  rails.slice(1).forEach((node) => node.remove());
  const existing = rails[0] || null;
  const head = headOf(view);
  if (!existing) {
    const rail = buildRail(view, healthCache);
    if (head && view.contains(head)) head.insertAdjacentElement('afterend', rail);
    else view.prepend(rail);
    return;
  }
  // 首次可能在权限页渲染完成前就挂过（页首还不存在）——位置不对就搬正
  if (head && view.contains(head) && head.nextElementSibling !== existing) {
    head.insertAdjacentElement('afterend', existing);
  }
  // 内容变了才重建，避免无意义的 DOM 抖动
  const next = buildRail(view, healthCache);
  if (existing.innerHTML !== next.innerHTML) existing.innerHTML = next.innerHTML;
}

const SCOPE_LEVELS: Record<string, number> = {
  none: 0,
  self: 1,
  org_unit: 2,
  org_subtree: 3,
  public_pool: 3,
  tenant: 5
};

const SCOPE_CAPTIONS: Record<number, string> = {
  0: '未授权',
  1: '仅本人',
  2: '本组',
  3: '本组及下级',
  4: '本级',
  5: '全公司'
};

function scopeLevel(value: string, optionCount: number): number {
  if (value in SCOPE_LEVELS) return SCOPE_LEVELS[value];
  // 未知范围值按"本级"处理，但仍要给出可读刻度
  return optionCount > 4 ? 4 : 3;
}

/** 把下拉框旁边的"授权范围"变成 5 段仪表；改选择即时更新。 */
function syncScopeMeters(view: HTMLElement): void {
  const selects = Array.from(view.querySelectorAll<HTMLSelectElement>('select[data-ac-role-scope]'));
  selects.forEach((select) => {
    const cell = select.parentElement;
    if (!cell) return;
    let meter = cell.querySelector<HTMLElement>('.kd-scope');
    let caption = cell.querySelector<HTMLElement>('.kd-scope-caption');
    if (!meter) {
      meter = document.createElement('span');
      meter.className = 'kd-scope';
      meter.setAttribute('aria-hidden', 'true');
      meter.innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
      select.insertAdjacentElement('afterend', meter);
    }
    if (!caption) {
      caption = document.createElement('span');
      caption.className = 'kd-scope-caption';
      meter.insertAdjacentElement('afterend', caption);
    }
    const apply = () => {
      const level = scopeLevel(select.value, select.options.length);
      meter!.dataset.level = String(level);
      caption!.textContent = SCOPE_CAPTIONS[level] || select.value;
      meter!.setAttribute('title', `授权范围：${caption!.textContent}`);
    };
    if (meter.dataset.kdBound !== '1') {
      meter.dataset.kdBound = '1';
      select.addEventListener('change', () => {
        apply();
        railRefreshers.get(view)?.();
      });
    }
    apply();
  });
}

function mount(view: HTMLElement): void {
  syncRail(view);
  scheduleRailRefresh(view);
  if (view.id === 'role-management') syncScopeMeters(view);
}

const railRefreshers = new WeakMap<HTMLElement, () => void>();

function scheduleRailRefresh(view: HTMLElement): void {
  let timer = 0;
  const run = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const existing = view.querySelector<HTMLElement>('.kd-rail');
      if (!existing) return;
      const next = buildRail(view, healthCache);
      if (existing.innerHTML !== next.innerHTML) existing.innerHTML = next.innerHTML;
    }, 60);
  };
  railRefreshers.set(view, run);
  run();
}

const observers = new Map<string, MutationObserver>();

function observe(view: HTMLElement): void {
  if (observers.has(view.id)) return;
  let timer = 0;
  const observer = new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (!view.classList.contains('active')) return;
      mount(view);
    }, 120);
  });
  observer.observe(view, { childList: true, subtree: true });
  observers.set(view.id, observer);
}

function activeAdminView(): HTMLElement | null {
  // 后台视图分布在两处：目录内的 .workspace > .view，以及 main 直挂的 .view
  const active = document.querySelector<HTMLElement>('.main > .workspace > .view.active, .main > .view.active');
  if (!active) return null;
  return (ADMIN_VIEW_IDS as readonly string[]).includes(active.id) ? active : null;
}

/** 视图切换时调用；无 admin 视图时静默。 */
export function refreshAdminDeck(): void {
  const view = activeAdminView();
  if (!view) return;
  observe(view);
  mount(view);
  // 服务状态首次拿到后回填一次
  if (!healthCache) {
    void readHealth().then((health) => {
      if (health && activeAdminView() === view) mount(view);
    });
  }
}

export function initAdminDeck(): void {
  refreshAdminDeck();
}
