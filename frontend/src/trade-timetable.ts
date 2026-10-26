/**
 * 客多多 · 跟进船期表
 *
 * 外贸的日课是"排期"：什么时候联系谁、哪票货哪天走。
 * 所以工作台首屏不做卡片堆，做一张横向排期板：
 * 左边一条"已逾期"闸口，右边是今天起七天的航期，今天那一列反白为墨底。
 *
 * 数据只取真实的待办到期日（todos[].dueAt），不推断、不编造：
 * 没有到期日的进"未排期"，过期未完成的进"已逾期"。
 */

export interface TimetableTodo {
  id: string;
  title: string;
  dueAt?: string;
  priority?: string;
  done?: boolean;
  related?: string;
  type?: string;
}

const DAYS = 7;
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDue(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function timeLabel(date: Date): string {
  if (date.getHours() === 0 && date.getMinutes() === 0) return '全天';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

interface Bucket {
  key: string;
  items: TimetableTodo[];
}

function eventMarkup(todo: TimetableTodo, due: Date | null): string {
  const tone = todo.priority === 'high' ? 'high' : todo.priority === 'low' ? 'low' : 'normal';
  const label = todo.related ? `${todo.title} · ${todo.related}` : todo.title;
  return `<button type="button" class="kd-event" data-priority="${tone}" data-todo-id="${esc(todo.id)}" title="${esc(label)}${due ? ` · ${timeLabel(due)}` : ''}">
    <time>${due ? timeLabel(due) : '—'}</time>
    <span>${esc(todo.title)}</span>
  </button>`;
}

/** 跳转到待办中心并高亮这条待办（真实动作，不是装饰）。 */
function openTodo(id: string): void {
  const navButton = document.querySelector<HTMLButtonElement>('.sidebar button[data-view="todo"]');
  if (navButton) {
    const section = navButton.closest('details');
    if (section) section.open = true;
    navButton.click();
  }
  const highlight = (attempt: number) => {
    const row = document.querySelector<HTMLElement>(`.todo-row[data-todo-id="${CSS.escape(id)}"]`);
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.classList.add('kd-flash');
      window.setTimeout(() => row.classList.remove('kd-flash'), 1600);
      return;
    }
    if (attempt < 12) window.setTimeout(() => highlight(attempt + 1), 160);
  };
  highlight(0);
}

function bindEvents(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>('.kd-event[data-todo-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.todoId;
      if (id) openTodo(id);
    });
  });
}

export function publishTimetable(todos: TimetableTodo[]): void {
  const host = document.querySelector<HTMLElement>('#kdBoardTrack');
  const summaryNode = document.querySelector<HTMLElement>('#kdBoardSummary');
  if (!host) return;

  const today = startOfDay(new Date());
  const pending = todos.filter((todo) => !todo.done);

  const overdue: Array<{ todo: TimetableTodo; due: Date }> = [];
  const days: Bucket[] = Array.from({ length: DAYS }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    return { key: dayKey(date), items: [] };
  });
  const undated: TimetableTodo[] = [];

  pending.forEach((todo) => {
    const due = parseDue(todo.dueAt);
    if (!due) {
      undated.push(todo);
      return;
    }
    const dueDay = startOfDay(due);
    if (dueDay.getTime() < today.getTime()) {
      overdue.push({ todo, due });
      return;
    }
    const target = days.find((day) => day.key === dayKey(dueDay));
    if (target) target.items.push(todo);
    else undated.push(todo);
  });

  overdue.sort((left, right) => left.due.getTime() - right.due.getTime());
  days.forEach((day) => {
    day.items.sort((left, right) => (parseDue(left.dueAt)?.getTime() || 0) - (parseDue(right.dueAt)?.getTime() || 0));
  });

  const todayKey = dayKey(today);

  const overdueCell = overdue.length
    ? `<div class="kd-day kd-day-gate" data-gate="overdue">
        <div class="kd-day-head"><b class="kd-day-num">${overdue.length}</b><span class="kd-day-wd">已逾期</span></div>
        <div class="kd-day-body">${overdue.slice(0, 6).map(({ todo, due }) => eventMarkup(todo, due)).join('')}${overdue.length > 6 ? `<p class="kd-more">另有 ${overdue.length - 6} 条</p>` : ''}</div>
      </div>`
    : `<div class="kd-day kd-day-gate kd-day-gate-empty" data-gate="overdue">
        <div class="kd-day-head"><b class="kd-day-num">0</b><span class="kd-day-wd">已逾期</span></div>
        <div class="kd-day-body"><p class="kd-day-none">没有逾期事项</p></div>
      </div>`;

  const dayCells = days.map((day, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    const isToday = day.key === todayKey;
    const body = day.items.length
      ? day.items.slice(0, 6).map((todo) => eventMarkup(todo, parseDue(todo.dueAt))).join('')
        + (day.items.length > 6 ? `<p class="kd-more">另有 ${day.items.length - 6} 条</p>` : '')
      : `<p class="kd-day-none">${isToday ? '今天没有排跟进' : '无排期'}</p>`;
    return `<div class="kd-day${isToday ? ' is-today' : ''}"${isToday ? ' data-today="1"' : ''}>
      <div class="kd-day-head">
        <b class="kd-day-num">${date.getDate()}</b>
        <span class="kd-day-wd">${isToday ? '今天' : WEEKDAYS[date.getDay()]}</span>
        ${day.items.length ? `<span class="kd-day-count">${day.items.length}</span>` : ''}
      </div>
      <div class="kd-day-body">${body}</div>
    </div>`;
  }).join('');

  const undatedCell = undated.length
    ? `<div class="kd-day kd-day-tail">
        <div class="kd-day-head"><b class="kd-day-num">${undated.length}</b><span class="kd-day-wd">未排期</span></div>
        <div class="kd-day-body">${undated.slice(0, 4).map((todo) => eventMarkup(todo, null)).join('')}${undated.length > 4 ? `<p class="kd-more">另有 ${undated.length - 4} 条</p>` : ''}</div>
      </div>`
    : '';

  host.innerHTML = `${overdueCell}${dayCells}${undatedCell}`;
  bindEvents(host);

  if (summaryNode) {
    const weekLoad = days.reduce((sum, day) => sum + day.items.length, 0);
    summaryNode.textContent = pending.length
      ? `${pending.length} 条未完成 · 未来七天 ${weekLoad} 条${overdue.length ? ` · 逾期 ${overdue.length} 条` : ''}`
      : '当前没有未完成的跟进';
  }
}
