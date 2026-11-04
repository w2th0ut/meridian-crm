import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { CrmStore } from "./store.js";
import type { ContactPhone, Customer, Lead, PhoneValidity, PreferredPhone, SameDayCallSkip, SessionUser, WebsiteOpportunity } from "./types.js";
import {
  compareTodayFollow,
  listTodayFollowNext,
  parseTodayFollowAt,
  parseTodayFollowNextQuery,
  pickNextTodayFollow
} from "./today-follow-advance.js";

const NOW = new Date("2026-11-04T04:00:00.000Z");

function user(partial: Partial<SessionUser> & Pick<SessionUser, "id" | "role">): SessionUser {
  return {
    teamId: "europe",
    name: partial.id,
    email: `${partial.id}@example.com`,
    status: "active",
    iamPermissions: partial.role === "sales"
      ? {
        "communication.read": ["self"],
        "customer.read": ["self"],
        "lead.read": ["self"],
        "prospect.read": ["self"]
      }
      : {
        "communication.read": ["tenant"],
        "customer.read": ["tenant"],
        "lead.read": ["tenant"],
        "prospect.read": ["tenant"]
      },
    ...partial
  } as SessionUser;
}

function customer(partial: Partial<Customer> & Pick<Customer, "id">): Customer {
  return {
    company: partial.id,
    country: "",
    contact: "",
    ownerId: "u1",
    teamId: "europe",
    stage: "",
    amount: 0,
    health: 0,
    nextReminder: "",
    wecomBound: false,
    billingName: "",
    billingAddress: "",
    documentContact: "",
    phone: "+8613800138000",
    defaultPortDischarge: "",
    defaultIncoterm: "",
    defaultPaymentTerm: "",
    poolStatus: "owned",
    ...partial
  };
}

function lead(partial: Partial<Lead> & Pick<Lead, "id">): Lead {
  return {
    company: partial.id,
    contact: "",
    country: "",
    email: "",
    phone: "+8613700001111",
    wechat: "",
    source: "",
    intent: "",
    stage: "",
    status: "new",
    ownerId: "u1",
    teamId: "europe",
    estimatedAmount: 0,
    nextFollowAt: "",
    lastActivityAt: "",
    remark: "",
    convertedCustomerId: "",
    convertedDealId: "",
    sourceType: "manual",
    sourceChannel: "",
    sourceCampaign: "",
    externalId: "",
    sourceUrl: "",
    createdAt: "2026-11-01T00:00:00.000Z",
    ...partial
  } as Lead;
}

function storeFor(input: {
  customers?: Customer[];
  leads?: Lead[];
  prospects?: WebsiteOpportunity[];
  channels?: Array<Record<string, unknown>>;
  skips?: SameDayCallSkip[];
  invalid?: PhoneValidity[];
  preferred?: PreferredPhone[];
  extras?: ContactPhone[];
}) {
  const store = {
    customers: input.customers || [],
    leads: input.leads || [],
    websiteOpportunities: input.prospects || [],
    prospectContactChannels: input.channels || [],
    sameDayCallSkips: input.skips || [],
    phoneValidities: input.invalid || [],
    preferredPhones: input.preferred || [],
    contactPhones: input.extras || [],
    users: [
      { id: "u1", teamId: "europe", name: "Seat", status: "active" },
      { id: "u2", teamId: "europe", name: "Other", status: "active" }
    ],
    persist: async () => {
      throw new Error("打开下一位不能写入");
    }
  };
  return store as unknown as CrmStore;
}

try {
  setOutboundNowForTests(NOW);
  assert.equal(parseTodayFollowAt("2026-11-04 09:00", "2026-11-04"), "2026-11-04 09:00");
  assert.equal(parseTodayFollowAt("2026-11-04T15:30", "2026-11-04"), "2026-11-04 15:30");
  assert.equal(parseTodayFollowAt(" 2026-11-04 09:00 ", "2026-11-04"), "2026-11-04 09:00");
  assert.equal(parseTodayFollowAt("2026-11-03 09:00", "2026-11-04"), "");
  assert.equal(parseTodayFollowAt("明天 10:00", "2026-11-04"), "");
  assert.equal(parseTodayFollowAt("", "2026-11-04"), "");
  assert.equal(parseTodayFollowAt("2026-11-04 24:00", "2026-11-04"), "");

  const ordered = [
    { targetType: "lead" as const, targetId: "b", nextFollowAt: "2026-11-04 09:00" },
    { targetType: "customer" as const, targetId: "a", nextFollowAt: "2026-11-04 09:00" },
    { targetType: "prospect" as const, targetId: "c", nextFollowAt: "2026-11-04 10:00" }
  ].sort(compareTodayFollow);
  assert.deepEqual(ordered.map((item) => item.targetId), ["a", "b", "c"]);
  assert.equal(pickNextTodayFollow(ordered, { targetType: "customer", targetId: "a" })?.targetId, "b");
  assert.equal(pickNextTodayFollow(ordered, { targetType: "prospect", targetId: "c" }), null);
  assert.equal(pickNextTodayFollow(ordered, { targetType: "customer", targetId: "missing" })?.targetId, "a");
  assert.equal(pickNextTodayFollow(ordered, null)?.targetId, "a");
  assert.equal(parseTodayFollowNextQuery({ scope: "mine" }).ok, true);
  assert.equal(parseTodayFollowNextQuery({ scope: "team", afterType: "customer", afterId: "c1" }).ok, true);
  assert.equal(parseTodayFollowNextQuery({ scope: "all" }).ok, false);
  assert.equal(parseTodayFollowNextQuery({ scope: "mine", note: "x" }).ok, false);
  assert.equal(parseTodayFollowNextQuery({ scope: "mine", afterType: "customer" }).ok, false);
  assert.equal(parseTodayFollowNextQuery({ scope: ["mine"] }).ok, false);

  const seat = user({ id: "u1", role: "sales" });
  const other = user({ id: "u2", role: "sales" });
  const manager = user({ id: "mgr", role: "manager" });
  const noRead = user({
    id: "u1",
    role: "sales",
    iamPermissions: { "customer.read": ["self"] }
  });
  const store = storeFor({
    customers: [
      customer({ id: "c_early", company: "Early <Co>", nextReminder: "2026-11-04 09:00", phone: "+8613800138000" }),
      customer({ id: "c_late", company: "Late", nextReminder: "2026-11-04 15:00", phone: "+8613800138111" }),
      customer({ id: "c_paused", nextReminder: "2026-11-04 08:00", phone: "+8613800138222" }),
      customer({ id: "c_invalid", nextReminder: "2026-11-04 08:30", phone: "+8613800138333" }),
      customer({ id: "c_other_owner", ownerId: "u2", nextReminder: "2026-11-04 18:00", phone: "+8613800138444" }),
      customer({ id: "c_tomorrow", nextReminder: "2026-11-05 09:00", phone: "+8613800138555" }),
      customer({ id: "c_text", nextReminder: "明天 10:00", phone: "+8613800138666" }),
      customer({ id: "c_public", poolStatus: "public", nextReminder: "2026-11-04 07:00", phone: "+8613800138777" }),
      customer({ id: "c_nophone", nextReminder: "2026-11-04 07:30", phone: "" }),
      customer({ id: "c_asia", teamId: "asia", nextReminder: "2026-11-04 07:00", phone: "+8613800138888" })
    ],
    leads: [
      lead({ id: "l_today", company: "Lead", nextFollowAt: "2026-11-04 12:00", phone: "+8613700001111" }),
      lead({ id: "l_deleted", nextFollowAt: "2026-11-04 06:00", deletedAt: "2026-11-01T00:00:00.000Z" })
    ],
    prospects: [
      {
        id: "p_today",
        teamId: "europe",
        ownerId: "u1",
        company: "Prospect",
        nextFollowAt: "2026-11-04 11:00",
        tenantProspectId: "tp1"
      } as WebsiteOpportunity
    ],
    channels: [{
      id: "ch_p",
      teamId: "europe",
      ownerId: "u1",
      prospectId: "tp1",
      channelType: "phone",
      value: "+8613600009999"
    }],
    skips: [{
      id: "skip1",
      teamId: "europe",
      targetType: "customer",
      targetId: "c_paused",
      skipOn: "2026-11-04",
      resumeOn: "",
      reason: "asked_later",
      note: "不要出现在响应里",
      active: true,
      actorId: "u1",
      updatedAt: NOW.toISOString()
    }],
    invalid: [{
      id: "pv1",
      teamId: "europe",
      targetType: "customer",
      targetId: "c_invalid",
      phoneId: "customer-phone:c_invalid",
      updatedBy: "u1",
      updatedAt: NOW.toISOString()
    }],
    extras: [{
      id: "cp1",
      teamId: "europe",
      targetType: "customer",
      targetId: "c_late",
      phoneId: "extra-late",
      label: "",
      phone: "+8613900002222",
      phoneDigits: "8613900002222",
      origin: "extra",
      updatedBy: "u1",
      updatedAt: NOW.toISOString()
    }],
    preferred: [{
      id: "pp1",
      teamId: "europe",
      targetType: "customer",
      targetId: "c_late",
      phoneId: "extra-late",
      updatedBy: "u1",
      updatedAt: NOW.toISOString()
    }]
  });
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");

  const first = await listTodayFollowNext(store, seat, { scope: "mine" });
  assert.equal(first.status, 200);
  assert.equal(first.body.next?.targetId, "c_early");
  assert.equal(first.body.next?.preferred, false);
  assert.equal(first.body.next?.phoneId, "customer-phone:c_early");
  assert.match(String(first.body.next?.maskedNumber), /8000$/);
  assert.equal(String(first.body.next?.maskedNumber).includes("13800138000"), false);
  assert.equal(first.body.next?.name, "Early <Co>");
  assert.equal(first.body.date, "2026-11-04");
  assert.equal(JSON.stringify(first.body).includes("不要出现在响应里"), false);
  assert.equal(JSON.stringify(first.body).includes("8613800138000"), false);

  const next = await listTodayFollowNext(store, seat, { scope: "mine", afterType: "customer", afterId: "c_early" });
  assert.equal(next.body.next?.targetId, "p_today");
  const afterProspect = await listTodayFollowNext(store, seat, { scope: "mine", afterType: "prospect", afterId: "p_today" });
  assert.equal(afterProspect.body.next?.targetId, "l_today");
  const afterLead = await listTodayFollowNext(store, seat, { scope: "mine", afterType: "lead", afterId: "l_today" });
  assert.equal(afterLead.body.next?.targetId, "c_late");
  assert.equal(afterLead.body.next?.preferred, true);
  assert.equal(afterLead.body.next?.phoneId, "extra-late");
  assert.match(String(afterLead.body.next?.maskedNumber), /2222$/);
  assert.equal(String(afterLead.body.next?.maskedNumber).includes("13900002222"), false);
  const done = await listTodayFollowNext(store, seat, { scope: "mine", afterType: "customer", afterId: "c_late" });
  assert.equal(done.body.empty, true);
  assert.equal(done.body.next, null);
  assert.equal(done.body.message, "今天没有下一位待跟进");
  const ids = ["c_early", "p_today", "l_today", "c_late"];
  for (const skipped of ["c_paused", "c_invalid", "c_other_owner", "c_tomorrow", "c_text", "c_public", "c_nophone", "c_asia", "l_deleted"]) {
    assert.equal(ids.includes(skipped), false);
  }
  const mineBody = JSON.stringify([first.body, next.body, afterProspect.body, afterLead.body]);
  for (const skipped of ["c_paused", "c_invalid", "c_other_owner", "c_public", "c_asia", "l_deleted"]) {
    assert.equal(mineBody.includes(skipped), false);
  }

  const again = await listTodayFollowNext(store, seat, { scope: "mine", afterType: "customer", afterId: "c_early" });
  assert.equal(again.body.next?.targetId, "p_today");
  assert.equal(store.customers.find((item) => item.id === "c_early")?.nextReminder, "2026-11-04 09:00");

  const forbidden = await listTodayFollowNext(store, seat, { scope: "team" });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.reason, "forbidden");
  assert.equal("next" in forbidden.body, false);

  const denied = await listTodayFollowNext(store, noRead, { scope: "mine" });
  assert.equal(denied.status, 403);
  const bad = await listTodayFollowNext(store, seat, { scope: "mine", targets: ["c_early"] });
  assert.equal(bad.status, 400);
  const anon = await listTodayFollowNext(store, undefined, { scope: "mine" });
  assert.equal(anon.status, 401);

  const otherMine = await listTodayFollowNext(store, other, { scope: "mine" });
  assert.equal(otherMine.body.next?.targetId, "c_other_owner");

  setTenantTimezoneOverride(store, "europe", "America/New_York");
  const ny = await listTodayFollowNext(store, seat, { scope: "mine" });
  assert.equal(ny.body.date, "2026-11-03");
  assert.equal(ny.body.empty, true);
  store.customers.push(customer({ id: "c_ny", nextReminder: "2026-11-03 22:00", phone: "+8613800138999" }));
  const nyNext = await listTodayFollowNext(store, seat, { scope: "mine" });
  assert.equal(nyNext.body.next?.targetId, "c_ny");
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  const back = await listTodayFollowNext(store, seat, { scope: "mine", afterType: "customer", afterId: "missing" });
  assert.equal(back.body.next?.targetId, "c_early");
  assert.equal(back.body.next?.targetId === "c_ny", false);

  const team = await listTodayFollowNext(store, manager, { scope: "team" });
  assert.equal(team.status, 200);
  assert.equal(team.body.next?.targetId, "c_early");
  const teamOther = await listTodayFollowNext(store, manager, { scope: "team", afterType: "customer", afterId: "c_late" });
  assert.equal(teamOther.body.next?.targetId, "c_other_owner");

  const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
  assert.equal(schema.includes("today_follow_advance_audits"), false);
  assert.equal(schema.includes("advanced_to_ref"), false);
  assert.equal(schema.includes("today_follow_queue"), false);
  const source = readFileSync(new URL("./today-follow-advance.ts", import.meta.url), "utf8");
  assert.equal(source.includes("MakeCall"), false);
  assert.equal(source.includes("aliyuncs"), false);
  assert.equal(source.includes("convert_to_lead"), false);
  assert.equal(source.includes("approved_contactable"), false);
  assert.equal(source.includes("/api/outbound-calls"), false);
  assert.equal(source.includes("persist("), false);
  assert.equal(source.includes("ensureColumn"), false);
  assert.equal(source.includes("todayFollowAdvanceAudits"), false);

  console.log("today follow advance tests passed");
} finally {
  setOutboundNowForTests(undefined);
}
