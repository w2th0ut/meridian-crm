/**
 * 工作台现有名单每一行上的今日已拨次数、最近一次通话结果和最近一次通话开始时间。
 * 接口没有这几格时不画，也不把次数写成 0，也不把时间写成「—」。
 * 筛选和排序只把已经带出的次数、结果和通话时间交给原来的名单。没有外呼按钮。
 */

export type QueueCallTodayCalls = "" | "0" | "1" | "2+";
export type QueueCallTodaySort = "" | "uncalled" | "called";
export type QueueCallLastWithin = "" | "30m" | "1h" | "today";
export type QueueCallLastSort = "" | "older" | "newer";

export interface QueueCallGlanceQuery {
  todayCalls?: QueueCallTodayCalls;
  lastOutcome?: string;
  todayCallSort?: QueueCallTodaySort;
  lastCallWithin?: QueueCallLastWithin;
  lastCallSort?: QueueCallLastSort;
}

const TODAY_CALLS = new Set(["0", "1", "2+"]);
const LAST_OUTCOMES = new Set(["有意向", "需回访", "无意向", "号码错误", "其他", "未标注"]);
const TODAY_SORTS = new Set(["uncalled", "called"]);
const LAST_WITHIN = new Set(["30m", "1h", "today"]);
const LAST_SORTS = new Set(["older", "newer"]);

export function queueCallGlanceQueryFromValues(
  todayCalls: string,
  lastOutcome: string,
  todayCallSort: string,
  lastCallWithin = ""
): QueueCallGlanceQuery {
  const callSort = LAST_SORTS.has(todayCallSort) ? todayCallSort as QueueCallLastSort : "";
  return {
    todayCalls: TODAY_CALLS.has(todayCalls) ? todayCalls as QueueCallTodayCalls : "",
    lastOutcome: LAST_OUTCOMES.has(lastOutcome) ? lastOutcome : "",
    todayCallSort: callSort ? "" : TODAY_SORTS.has(todayCallSort) ? todayCallSort as QueueCallTodaySort : "",
    lastCallWithin: LAST_WITHIN.has(lastCallWithin) ? lastCallWithin as QueueCallLastWithin : "",
    lastCallSort: callSort
  };
}

export function appendQueueCallGlanceQuery(params: URLSearchParams, input: QueueCallGlanceQuery | undefined) {
  if (!input) return;
  if (input.todayCalls) params.set("todayCalls", input.todayCalls);
  if (input.lastOutcome) params.set("lastOutcome", input.lastOutcome);
  if (input.todayCallSort) params.set("todayCallSort", input.todayCallSort);
  if (input.lastCallWithin) params.set("lastCallWithin", input.lastCallWithin);
  if (input.lastCallSort) params.set("lastCallSort", input.lastCallSort);
}

export function queueCallGlanceFilterActive(data: { todayCalls?: string; lastOutcome?: string; lastCallWithin?: string } | null | undefined) {
  return Boolean((data?.todayCalls || "").trim() || (data?.lastOutcome || "").trim() || (data?.lastCallWithin || "").trim());
}

export function queueCallGlanceFilterEmpty(attr: string) {
  return `<p ${attr} data-queue-call-filter-empty="1">这个筛选下没有对得上今日已拨、最近一次通话结果或最近一次通话时间的对象。</p>`;
}

export function queueCallGlanceMarkup(row: { todayCallCount?: number; lastCallOutcome?: string; lastCallAt?: string } | null | undefined) {
  if (!row || typeof row.todayCallCount !== "number" || !Number.isInteger(row.todayCallCount) || row.todayCallCount < 0) return "";
  const outcome = (row.lastCallOutcome || "").trim() || "未标注";
  const when = (row.lastCallAt || "").trim() || "—";
  return `<span data-queue-call-glance="1">今日已拨 ${escapeHtml(String(row.todayCallCount))} 次</span><span data-queue-call-last-outcome="1">${escapeHtml(outcome)}</span><span data-queue-call-last-at="1">最近一次通话 ${escapeHtml(when)}</span>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 当前账号在六份名单上的今日已拨、最近结果、最近通话和排序。
 * 只记这四个下拉的取值，按账号和名单分开。不记行、对象或号码，也不建表、不加列。
 * 没有记下的选择时，排序仍是今日未拨在前，不带次数、结果和时间筛选。
 */

export const QUEUE_CALL_GLANCE_LISTS = [
  "intentFollowup",
  "dashboardUnansweredPending",
  "dashboardNegativeOutcomeFollowup",
  "dashboardOtherOutcomeFollowup",
  "dashboardUnlabeledConnectedFollowup",
  "dashboardTodayFollowNext"
] as const;

export type QueueCallGlanceListId = typeof QUEUE_CALL_GLANCE_LISTS[number];
export type QueueCallGlanceSort = "" | "uncalled" | "called" | "older" | "newer";

export interface QueueCallGlancePreference {
  todayCalls: QueueCallTodayCalls;
  lastOutcome: string;
  sort: QueueCallGlanceSort;
  lastCallWithin: QueueCallLastWithin;
}

export const QUEUE_CALL_GLANCE_DEFAULT_PREFERENCE: QueueCallGlancePreference = {
  todayCalls: "",
  lastOutcome: "",
  sort: "uncalled",
  lastCallWithin: ""
};

const QUEUE_CALL_GLANCE_LIST_SET = new Set<string>(QUEUE_CALL_GLANCE_LISTS);
const QUEUE_CALL_GLANCE_PREFERENCE_FIELDS = ["todayCalls", "lastOutcome", "sort", "lastCallWithin"] as const;
const QUEUE_CALL_GLANCE_PREFERENCE_PREFIX = "gj_queue_call_glance_pref";
const QUEUE_CALL_GLANCE_SORTS = new Set(["", "uncalled", "called", "older", "newer"]);

export interface QueueCallGlancePreferenceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function isQueueCallGlanceList(listId: string): listId is QueueCallGlanceListId {
  return QUEUE_CALL_GLANCE_LIST_SET.has(listId);
}

export function queueCallGlancePreferenceAccountId(accountId: string) {
  const id = accountId.trim();
  if (!id || id.length > 128 || /[\u0000-\u001f\u007f]/.test(id)) return "";
  return id;
}

export function queueCallGlancePreferenceKey(accountId: string, listId: string) {
  const id = queueCallGlancePreferenceAccountId(accountId);
  if (!id || !isQueueCallGlanceList(listId)) return "";
  return `${QUEUE_CALL_GLANCE_PREFERENCE_PREFIX}:${id}:${listId}`;
}

export function normalizeQueueCallGlancePreference(input: {
  todayCalls?: string;
  lastOutcome?: string;
  sort?: string;
  lastCallWithin?: string;
}): QueueCallGlancePreference {
  const query = queueCallGlanceQueryFromValues(
    input.todayCalls || "",
    input.lastOutcome || "",
    input.sort || "",
    input.lastCallWithin || ""
  );
  const sort = query.lastCallSort || query.todayCallSort || "";
  return {
    todayCalls: query.todayCalls || "",
    lastOutcome: query.lastOutcome || "",
    sort: QUEUE_CALL_GLANCE_SORTS.has(sort) ? sort as QueueCallGlanceSort : "",
    lastCallWithin: query.lastCallWithin || ""
  };
}

export function parseQueueCallGlancePreference(value: unknown): QueueCallGlancePreference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== QUEUE_CALL_GLANCE_PREFERENCE_FIELDS.length) return null;
  if (keys.some((key) => !QUEUE_CALL_GLANCE_PREFERENCE_FIELDS.includes(key as typeof QUEUE_CALL_GLANCE_PREFERENCE_FIELDS[number]))) return null;
  const todayCalls = record.todayCalls;
  const lastOutcome = record.lastOutcome;
  const sort = record.sort;
  const lastCallWithin = record.lastCallWithin;
  if (typeof todayCalls !== "string" || typeof lastOutcome !== "string" || typeof sort !== "string" || typeof lastCallWithin !== "string") return null;
  const normalized = normalizeQueueCallGlancePreference({ todayCalls, lastOutcome, sort, lastCallWithin });
  if (normalized.todayCalls !== todayCalls || normalized.lastOutcome !== lastOutcome || normalized.sort !== sort || normalized.lastCallWithin !== lastCallWithin) return null;
  return normalized;
}

export function queueCallGlancePreferenceQuery(preference: QueueCallGlancePreference): QueueCallGlanceQuery {
  return queueCallGlanceQueryFromValues(
    preference.todayCalls,
    preference.lastOutcome,
    preference.sort,
    preference.lastCallWithin
  );
}

export function readQueueCallGlancePreference(
  store: Pick<QueueCallGlancePreferenceStore, "getItem">,
  accountId: string,
  listId: string
): QueueCallGlancePreference | null {
  const key = queueCallGlancePreferenceKey(accountId, listId);
  if (!key) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    return parseQueueCallGlancePreference(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeQueueCallGlancePreference(
  store: Pick<QueueCallGlancePreferenceStore, "setItem">,
  accountId: string,
  listId: string,
  preference: {
    todayCalls?: string;
    lastOutcome?: string;
    sort?: string;
    lastCallWithin?: string;
  }
) {
  const key = queueCallGlancePreferenceKey(accountId, listId);
  if (!key) return false;
  try {
    store.setItem(key, JSON.stringify(normalizeQueueCallGlancePreference(preference)));
    return true;
  } catch {
    return false;
  }
}

export function clearQueueCallGlancePreference(
  store: Pick<QueueCallGlancePreferenceStore, "removeItem">,
  accountId: string,
  listId: string
) {
  const key = queueCallGlancePreferenceKey(accountId, listId);
  if (!key) return false;
  try {
    store.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
