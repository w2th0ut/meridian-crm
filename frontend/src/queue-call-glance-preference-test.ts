import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  QUEUE_CALL_GLANCE_DEFAULT_PREFERENCE,
  QUEUE_CALL_GLANCE_LISTS,
  appendQueueCallGlanceQuery,
  clearQueueCallGlancePreference,
  parseQueueCallGlancePreference,
  queueCallGlancePreferenceKey,
  queueCallGlancePreferenceQuery,
  readQueueCallGlancePreference,
  writeQueueCallGlancePreference,
  type QueueCallGlancePreference,
  type QueueCallGlancePreferenceStore
} from "./queue-call-glance.js";

function memoryStore(fail = false): QueueCallGlancePreferenceStore & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem(key) {
      return raw.has(key) ? raw.get(key) || "" : null;
    },
    setItem(key, value) {
      if (fail) throw new Error("full");
      raw.set(key, value);
    },
    removeItem(key) {
      if (fail) throw new Error("full");
      raw.delete(key);
    }
  };
}

const older: QueueCallGlancePreference = {
  todayCalls: "0",
  lastOutcome: "未标注",
  sort: "older",
  lastCallWithin: "1h"
};
const originalOrder: QueueCallGlancePreference = {
  todayCalls: "",
  lastOutcome: "",
  sort: "",
  lastCallWithin: ""
};
const store = memoryStore();
assert.equal(writeQueueCallGlancePreference(store, "acct-a", "intentFollowup", older), true);
assert.equal(writeQueueCallGlancePreference(store, "acct-a", "dashboardUnansweredPending", originalOrder), true);
assert.deepEqual(readQueueCallGlancePreference(store, "acct-a", "intentFollowup"), older);
assert.deepEqual(readQueueCallGlancePreference(store, "acct-b", "intentFollowup"), null);
assert.deepEqual(readQueueCallGlancePreference(store, "acct-a", "dashboardTodayFollowNext"), null);
assert.deepEqual(readQueueCallGlancePreference(store, "acct-a", "dashboardUnansweredPending"), {
  todayCalls: "",
  lastOutcome: "",
  sort: "",
  lastCallWithin: ""
});

const saved = JSON.parse(store.raw.get(queueCallGlancePreferenceKey("acct-a", "intentFollowup")) || "{}") as Record<string, unknown>;
assert.deepEqual(Object.keys(saved).sort(), ["lastCallWithin", "lastOutcome", "sort", "todayCalls"]);
assert.equal(JSON.stringify(saved).includes("targetId"), false);
assert.equal(JSON.stringify(saved).includes("phone"), false);

const params = new URLSearchParams();
appendQueueCallGlanceQuery(params, queueCallGlancePreferenceQuery(QUEUE_CALL_GLANCE_DEFAULT_PREFERENCE));
assert.equal(params.toString(), "todayCallSort=uncalled");
const original = new URLSearchParams();
appendQueueCallGlanceQuery(original, queueCallGlancePreferenceQuery(originalOrder));
assert.equal(original.toString(), "");
const avoided = new URLSearchParams();
appendQueueCallGlanceQuery(avoided, queueCallGlancePreferenceQuery(older));
assert.equal(avoided.get("todayCalls"), "0");
assert.equal(avoided.get("lastOutcome"), "未标注");
assert.equal(avoided.get("lastCallWithin"), "1h");
assert.equal(avoided.get("lastCallSort"), "older");
assert.equal(avoided.has("todayCallSort"), false);

assert.equal(parseQueueCallGlancePreference({
  todayCalls: "0",
  lastOutcome: "未标注",
  sort: "older",
  lastCallWithin: "1h",
  targetId: "customer-1",
  phone: "13800000000"
}), null);
assert.equal(parseQueueCallGlancePreference({
  todayCalls: "9",
  lastOutcome: "未标注",
  sort: "older",
  lastCallWithin: "2h"
}), null);
assert.equal(readQueueCallGlancePreference(store, "acct-a", "not-a-list"), null);
assert.equal(writeQueueCallGlancePreference(store, " ", "intentFollowup", older), false);
assert.equal(writeQueueCallGlancePreference(store, "acct-a", "callbackDue", older), false);
assert.equal(clearQueueCallGlancePreference(store, "acct-a", "intentFollowup"), true);
assert.equal(readQueueCallGlancePreference(store, "acct-a", "intentFollowup"), null);
assert.deepEqual(readQueueCallGlancePreference(store, "acct-a", "dashboardUnansweredPending")?.sort, "");
assert.equal(clearQueueCallGlancePreference(memoryStore(true), "acct-a", "intentFollowup"), false);
assert.equal(writeQueueCallGlancePreference(memoryStore(true), "acct-a", "intentFollowup", older), false);
assert.equal(QUEUE_CALL_GLANCE_LISTS.length, 6);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
for (const id of QUEUE_CALL_GLANCE_LISTS) {
  assert.match(page, new RegExp(`id="${id}GlancePrefReset" data-queue-call-glance-reset="${id}"`));
  assert.match(page, new RegExp(`id="${id}GlancePrefReset"[^>]*type="button"|type="button"[^>]*id="${id}GlancePrefReset"`));
}
assert.equal(page.split("记在这台浏览器里").length - 1, 6);
const batch = page.slice(page.indexOf('id="dashboardCallOutcomeBatchNote"'), page.indexOf('id="dashboardTodayFollowNext"'));
assert.equal(batch.includes("记在这台浏览器里"), false);
assert.equal(page.includes("queue-call-glance-dial"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /function canRememberQueueCallGlance\(\) \{\s*return Boolean\(queueCallGlanceAccountId\(\) && state\.iamCapabilities && hasIamCapability\("communication\.read"\)\);/);
assert.match(api, /restoreQueueCallGlancePreferences\(\);/);
assert.match(api, /syncQueueCallGlancePreferenceAccount\(user\.id\)/);
assert.match(api, /syncQueueCallGlancePreferenceAccount\(""\)/);
assert.match(api, /function queueCallGlanceControls/);
for (const id of QUEUE_CALL_GLANCE_LISTS) {
  assert.match(api, new RegExp(`queueCallGlanceControls\\("${id}"\\)`));
}

function sliceFunction(source: string, name: string) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, name);
  const next = source.indexOf("\nfunction ", start + 1);
  const nextAsync = source.indexOf("\nasync function ", start + 1);
  const candidates = [next, nextAsync].filter((index) => index >= 0);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

for (const name of [
  "restoreQueueCallGlancePreferences",
  "rememberQueueCallGlancePreference",
  "resetQueueCallGlancePreference"
]) {
  const body = sliceFunction(api, name);
  assert.equal(body.includes("fetch("), false, name);
  assert.equal(body.includes("api("), false, name);
  assert.equal(body.includes("/api/"), false, name);
  assert.equal(body.includes("openNextTodayFollow"), false, name);
  assert.equal(body.includes("loadIntentFollowupQueue"), false, name);
  assert.equal(body.includes("loadUnansweredPendingQueue"), false, name);
}
assert.match(sliceFunction(api, "resetQueueCallGlancePreference"), /QUEUE_CALL_GLANCE_DEFAULT_PREFERENCE/);
assert.equal(api.includes("gj_queue_call_glance_pref"), false);
assert.equal(readFileSync(new URL("./queue-call-glance.ts", import.meta.url), "utf8").includes("CREATE TABLE"), false);

console.log("queue call glance preference tests passed");
