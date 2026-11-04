import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setPhoneValidity } from "./phone-validity.js";
import { isPhoneMarkedInvalid } from "./phone-validity-state.js";
import {
  linkSameNumberInvalid,
  parseSameNumberInvalidRequest,
  readSameNumberInvalid
} from "./same-number-invalid.js";
import type { CrmStore } from "./store.js";
import type { ContactPhone, PhoneValidity, PreferredPhone, SessionUser } from "./types.js";

const PHONE = "+46 111-222-333";
const DIGITS_PLAIN = "46111222333";

function user(id: string, permissions: SessionUser["iamPermissions"]): SessionUser {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    role: "sales",
    teamId: "europe",
    avatar: "",
    authVersion: 1,
    iamPermissions: permissions
  };
}

const tenantPermissions: SessionUser["iamPermissions"] = {
  "customer.read": ["tenant"],
  "customer.update": ["tenant"],
  "lead.read": ["tenant"],
  "lead.update": ["tenant"],
  "prospect.read": ["tenant"],
  "prospect.execute": ["tenant"]
};

function customer(id: string, ownerId: string, phone: string, poolStatus = "private", teamId = "europe") {
  return { id, teamId, ownerId, phone, poolStatus, company: `${id} Co` };
}

function extra(targetId: string, phoneId: string, phone: string): ContactPhone {
  return {
    id: `cph_${phoneId}`,
    teamId: "europe",
    targetType: "customer",
    targetId,
    phoneId,
    label: "mobile",
    phone,
    phoneDigits: phone.replace(/\D/g, ""),
    origin: "extra",
    updatedBy: "u1",
    updatedAt: "2026-11-01T00:00:00.000Z"
  };
}

function preferred(targetType: PreferredPhone["targetType"], targetId: string, phoneId: string): PreferredPhone {
  return {
    id: `pph_${targetId}`,
    teamId: "europe",
    targetType,
    targetId,
    phoneId,
    updatedBy: "u1",
    updatedAt: "2026-11-01T00:00:00.000Z"
  };
}

function validity(targetType: PhoneValidity["targetType"], targetId: string, phoneId: string): PhoneValidity {
  return {
    id: `phv_${phoneId}`,
    teamId: "europe",
    targetType,
    targetId,
    phoneId,
    updatedBy: "u1",
    updatedAt: "2026-11-01T00:00:00.000Z"
  };
}

function fixture() {
  let persists = 0;
  const store = {
    customers: [
      customer("c_src", "u_self", PHONE),
      customer("c_only", "u1", DIGITS_PLAIN),
      customer("c_alt", "u1", "(46) 111 222 333"),
      customer("c_keep", "u1", "46-111-222-333"),
      customer("c_mine", "u_self", "46111222333"),
      customer("c_already", "u1", PHONE),
      customer("c_other", "u1", "+46119990000"),
      customer("c_pool", "u1", PHONE, "public"),
      customer("c_asia", "u_asia", PHONE, "private", "asia")
    ],
    leads: [
      { id: "l_same", teamId: "europe", ownerId: "u1", phone: "46 111 222 333", deletedAt: "" },
      { id: "l_deleted", teamId: "europe", ownerId: "u1", phone: PHONE, deletedAt: "2026-01-01T00:00:00.000Z" }
    ],
    websiteOpportunities: [
      { id: "cand_same", teamId: "europe", ownerId: "u1", tenantProspectId: "tp_same", company: "Same Prospect" },
      { id: "cand_dup", teamId: "europe", ownerId: "u1", tenantProspectId: "tp_dup", company: "Dup Prospect" }
    ],
    prospectContactChannels: [
      { id: "ch_same", teamId: "europe", ownerId: "u1", prospectId: "tp_same", channelType: "phone", value: "+46 111 222 333" },
      { id: "ch_dup_a", teamId: "europe", ownerId: "u1", prospectId: "tp_dup", channelType: "phone", value: "46111222333" },
      { id: "ch_dup_b", teamId: "europe", ownerId: "u1", prospectId: "tp_dup", channelType: "phone", value: "46-111-222-333" }
    ],
    contactPhones: [
      extra("c_alt", "c_alt_extra", "+46700001111"),
      extra("c_keep", "c_keep_extra", "+46800002222")
    ],
    phoneValidities: [
      validity("customer", "c_src", "customer-phone:c_src"),
      validity("customer", "c_already", "customer-phone:c_already")
    ],
    phoneValidityAudits: [],
    preferredPhones: [
      preferred("customer", "c_src", "customer-phone:c_src"),
      preferred("customer", "c_only", "customer-phone:c_only"),
      preferred("customer", "c_alt", "customer-phone:c_alt"),
      preferred("customer", "c_keep", "c_keep_extra"),
      preferred("prospect", "cand_dup", "ch_dup_a")
    ],
    preferredPhoneAudits: [],
    prospectSuppressionEvents: [{ id: "keep" }],
    users: [],
    async persist() {
      persists += 1;
    }
  };
  return { store: store as unknown as CrmStore, raw: store, persists: () => persists };
}

const tenant = user("u1", tenantPermissions);
const selfUser = user("u_self", {
  "customer.read": ["self"],
  "customer.update": ["self"],
  "lead.read": ["self"],
  "lead.update": ["self"],
  "prospect.read": ["self"],
  "prospect.execute": ["self"]
});

assert.equal(parseSameNumberInvalidRequest(null), null);
assert.equal(parseSameNumberInvalidRequest({ targetType: "customer", targetId: "c_src", phoneId: "customer-phone:c_src", targets: [] }), null);
assert.equal(parseSameNumberInvalidRequest({ targetType: "customer", targetId: "c_src", phoneId: "customer-phone:c_src", phones: [] }), null);
assert.equal(parseSameNumberInvalidRequest(["customer-phone:c_src"]), null);
assert.ok(parseSameNumberInvalidRequest({ targetType: "customer", targetId: "c_src", phoneId: "customer-phone:c_src" }));

{
  const { store, raw } = fixture();
  const marked = await setPhoneValidity(store, tenant, {
    targetType: "customer",
    targetId: "c_only",
    phoneId: "customer-phone:c_only",
    invalid: true
  });
  assert.equal(marked.status, 200);
  assert.equal(isPhoneMarkedInvalid(store, "europe", "customer-phone:c_alt"), false);
  assert.equal(isPhoneMarkedInvalid(store, "europe", "lead-phone:l_same"), false);
  assert.equal(raw.phoneValidityAudits.filter((item) => item.phoneId === "customer-phone:c_only").every((item) => !item.batchId), true);
  assert.equal(raw.phoneValidityAudits.some((item) => item.batchId), false);
}

{
  const { store, raw, persists } = fixture();
  const early = await linkSameNumberInvalid(store, tenant, {
    targetType: "customer",
    targetId: "c_alt",
    phoneId: "customer-phone:c_alt"
  });
  assert.equal(early.status, 400);
  if ("reason" in early.body) assert.equal(early.body.reason, "not_invalid");
  assert.equal(persists(), 0);
  assert.equal(raw.phoneValidityAudits.length, 0);
  assert.equal(isPhoneMarkedInvalid(store, "europe", "customer-phone:c_only"), false);
}

{
  const { store, raw, persists } = fixture();
  const denied = await linkSameNumberInvalid(store, user("u_read", { "customer.read": ["tenant"] }), {
    targetType: "customer",
    targetId: "c_src",
    phoneId: "customer-phone:c_src"
  });
  assert.equal(denied.status, 403);
  assert.equal(persists(), 1);
  assert.equal(raw.phoneValidityAudits.length, 1);
  assert.equal(raw.phoneValidityAudits[0]?.result, "rejected");
  assert.equal(raw.phoneValidityAudits[0]?.reason, "forbidden");
  assert.equal(raw.phoneValidityAudits[0]?.batchId, "");
  assert.equal(isPhoneMarkedInvalid(store, "europe", "customer-phone:c_only"), false);
  assert.equal(JSON.stringify(denied.body).includes(DIGITS_PLAIN), false);
}

{
  const { store, raw } = fixture();
  const pooled = await linkSameNumberInvalid(store, tenant, {
    targetType: "customer",
    targetId: "c_pool",
    phoneId: "customer-phone:c_pool"
  });
  assert.equal(pooled.status, 409);
  assert.equal(raw.phoneValidityAudits[0]?.reason, "public_pool");
  assert.equal(isPhoneMarkedInvalid(store, "europe", "customer-phone:c_pool"), false);
  assert.equal(isPhoneMarkedInvalid(store, "europe", "customer-phone:c_only"), false);
}

{
  const { store, raw, persists } = fixture();
  raw.phoneValidities.push(validity("customer", "c_only", "customer-phone:c_only"));
  const hidden = await linkSameNumberInvalid(store, selfUser, {
    targetType: "customer",
    targetId: "c_only",
    phoneId: "customer-phone:c_only"
  });
  assert.equal(hidden.status, 404);
  assert.equal(persists(), 0);
  assert.equal(raw.phoneValidityAudits.length, 0);
}

{
  const { store, raw } = fixture();
  const preview = await readSameNumberInvalid(store, selfUser, {
    targetType: "customer",
    targetId: "c_src",
    phoneId: "customer-phone:c_src"
  });
  assert.equal(preview.status, 200);
  if ("count" in preview.body) {
    assert.equal(preview.body.count, 1);
    assert.deepEqual(preview.body.targets.map((item) => item.targetId), ["c_mine"]);
    assert.equal(JSON.stringify(preview.body).includes("c_alt"), false);
    assert.equal(JSON.stringify(preview.body).includes("c_asia"), false);
    assert.equal(JSON.stringify(preview.body).includes("c_pool"), false);
    assert.equal(JSON.stringify(preview.body).includes(DIGITS_PLAIN), false);
    assert.equal(JSON.stringify(preview.body).includes(PHONE), false);
  }
  const linked = await linkSameNumberInvalid(store, selfUser, {
    targetType: "customer",
    targetId: "c_src",
    phoneId: "customer-phone:c_src"
  });
  assert.equal(linked.status, 200);
  if ("result" in linked.body) assert.equal(linked.body.result, "updated");
  assert.equal(isPhoneMarkedInvalid(store, "europe", "customer-phone:c_mine"), true);
  assert.equal(isPhoneMarkedInvalid(store, "europe", "customer-phone:c_only"), false);
  assert.equal(raw.preferredPhones.some((item) => item.targetId === "c_src" && item.phoneId === "customer-phone:c_src"), true);
  assert.equal(raw.phoneValidityAudits.every((item) => item.batchId?.startsWith("pvb_")), true);
}

{
  const { store, raw } = fixture();
  const beforePreferred = raw.preferredPhoneAudits.length;
  const preview = await readSameNumberInvalid(store, tenant, {
    targetType: "customer",
    targetId: "c_src",
    phoneId: "customer-phone:c_src"
  });
  assert.equal(preview.status, 200);
  if ("count" in preview.body) {
    assert.equal(preview.body.count, 7);
    const ids = preview.body.targets.map((item) => item.targetId);
    for (const id of ["c_only", "c_alt", "c_keep", "c_mine", "l_same", "cand_same", "cand_dup"]) {
      assert.equal(ids.includes(id), true, id);
    }
    for (const id of ["c_src", "c_already", "c_other", "c_pool", "c_asia", "l_deleted"]) {
      assert.equal(ids.includes(id), false, id);
    }
    assert.equal(JSON.stringify(preview.body).includes(PHONE), false);
    assert.equal(JSON.stringify(preview.body).includes(DIGITS_PLAIN), false);
  }
  assert.equal(raw.phoneValidityAudits.length, 0);
  const linked = await linkSameNumberInvalid(store, tenant, {
    targetType: "customer",
    targetId: "c_src",
    phoneId: "customer-phone:c_src"
  });
  assert.equal(linked.status, 200);
  if ("batchId" in linked.body) {
    assert.equal(linked.body.count, 7);
    assert.ok(linked.body.batchId.startsWith("pvb_"));
    const success = raw.phoneValidityAudits.filter((item) => item.result !== "rejected");
    assert.ok(success.length >= 7);
    assert.equal(success.every((item) => item.batchId === linked.body.batchId), true);
    assert.equal(success.every((item) => item.previousValue === "valid" && item.nextValue === "invalid"), true);
    assert.equal(success.some((item) => item.targetId === "c_src"), false);
    assert.equal(JSON.stringify(success).includes(PHONE), false);
    assert.equal(JSON.stringify(linked.body).includes(DIGITS_PLAIN), false);
  }
  assert.equal(isPhoneMarkedInvalid(store, "europe", "customer-phone:c_only"), true);
  assert.equal(isPhoneMarkedInvalid(store, "europe", "customer-phone:c_alt"), true);
  assert.equal(isPhoneMarkedInvalid(store, "europe", "customer-phone:c_keep"), true);
  assert.equal(isPhoneMarkedInvalid(store, "europe", "lead-phone:l_same"), true);
  assert.equal(isPhoneMarkedInvalid(store, "europe", "ch_same"), true);
  assert.equal(isPhoneMarkedInvalid(store, "europe", "ch_dup_a"), true);
  assert.equal(isPhoneMarkedInvalid(store, "europe", "ch_dup_b"), true);
  assert.equal(isPhoneMarkedInvalid(store, "europe", "customer-phone:c_pool"), false);
  assert.equal(isPhoneMarkedInvalid(store, "europe", "customer-phone:c_asia"), false);
  assert.equal(isPhoneMarkedInvalid(store, "europe", "customer-phone:c_other"), false);
  assert.equal(isPhoneMarkedInvalid(store, "asia", "customer-phone:c_asia"), false);
  assert.equal(raw.preferredPhones.find((item) => item.targetId === "c_only"), undefined);
  assert.equal(raw.preferredPhoneAudits.find((item) => item.targetId === "c_only")?.reason, "marked_invalid");
  assert.equal(raw.preferredPhoneAudits.find((item) => item.targetId === "c_only")?.action, "clear");
  const alt = raw.preferredPhoneAudits.find((item) => item.targetId === "c_alt");
  assert.equal(alt?.reason, "wrong_number_alternate");
  assert.equal(alt?.action, "update");
  assert.equal(alt?.previousPhoneId, "customer-phone:c_alt");
  assert.equal(alt?.nextPhoneId, "c_alt_extra");
  assert.equal(raw.preferredPhones.find((item) => item.targetId === "c_alt")?.phoneId, "c_alt_extra");
  assert.equal(raw.preferredPhoneAudits.some((item) => item.reason === "missed_alternate"), false);
  assert.equal(raw.preferredPhoneAudits.some((item) => item.targetId === "c_keep"), false);
  assert.equal(raw.preferredPhones.find((item) => item.targetId === "c_keep")?.phoneId, "c_keep_extra");
  assert.equal(raw.preferredPhones.find((item) => item.targetId === "cand_dup"), undefined);
  assert.equal(raw.preferredPhoneAudits.find((item) => item.targetId === "cand_dup")?.reason, "marked_invalid");
  assert.equal(raw.preferredPhones.some((item) => item.targetId === "c_src"), true);
  assert.equal(beforePreferred, 0);
  assert.equal(raw.prospectSuppressionEvents.length, 1);
  const again = await linkSameNumberInvalid(store, tenant, {
    targetType: "customer",
    targetId: "c_src",
    phoneId: "customer-phone:c_src"
  });
  assert.equal(again.status, 200);
  if ("result" in again.body) {
    assert.equal(again.body.result, "unchanged");
    assert.equal(again.body.batchId, "");
  }
  assert.equal(raw.phoneValidityAudits.filter((item) => item.result !== "rejected").length, 8);
}

{
  const leads = Array.from({ length: 101 }, (_, index) => ({
    id: `lcap_${String(index).padStart(3, "0")}`,
    teamId: "europe",
    ownerId: "u1",
    phone: "46000011122",
    deletedAt: ""
  }));
  const store = {
    customers: [customer("c_cap", "u1", "46000011122")],
    leads,
    websiteOpportunities: [],
    prospectContactChannels: [],
    contactPhones: [],
    phoneValidities: [validity("customer", "c_cap", "customer-phone:c_cap")],
    phoneValidityAudits: [],
    preferredPhones: [],
    preferredPhoneAudits: [],
    users: [],
    async persist() {}
  } as unknown as CrmStore;
  const first = await readSameNumberInvalid(store, tenant, {
    targetType: "customer",
    targetId: "c_cap",
    phoneId: "customer-phone:c_cap"
  });
  if ("count" in first.body) assert.equal(first.body.count, 100);
  const linked = await linkSameNumberInvalid(store, tenant, {
    targetType: "customer",
    targetId: "c_cap",
    phoneId: "customer-phone:c_cap"
  });
  if ("count" in linked.body) assert.equal(linked.body.count, 100);
  const stillValid = leads.filter((item) => !isPhoneMarkedInvalid(store, "europe", `lead-phone:${item.id}`));
  assert.equal(stillValid.length, 1);
  const second = await linkSameNumberInvalid(store, tenant, {
    targetType: "customer",
    targetId: "c_cap",
    phoneId: "customer-phone:c_cap"
  });
  if ("count" in second.body) assert.equal(second.body.count, 1);
  assert.equal(leads.every((item) => isPhoneMarkedInvalid(store, "europe", `lead-phone:${item.id}`)), true);
}

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /ensureColumn\(pool, "phone_validity_audits", "batch_id", "VARCHAR\(64\) NULL"\)/);
assert.match(schema, /batch_id VARCHAR\(64\) NULL/);
assert.equal(schema.includes("DROP COLUMN batch_id"), false);
assert.equal(schema.includes("DROP TABLE phone_validity"), false);
assert.equal(schema.includes("CREATE TABLE same_number"), false);

const source = readFileSync(new URL("./same-number-invalid.ts", import.meta.url), "utf8");
assert.match(source, /pickAlternatePhoneId/);
assert.match(source, /wrong_number_alternate/);
assert.match(source, /applyPhoneInvalidChange/);
assert.doesNotMatch(source, /makeCall|MakeCall|aliyuncs|convert_to_lead|approved_contactable|CREATE TABLE|DROP TABLE|DROP COLUMN|prospectSuppressionEvents|fetch\(/i);
const validitySource = readFileSync(new URL("./phone-validity.ts", import.meta.url), "utf8");
assert.equal(validitySource.includes("linkSameNumberInvalid"), false);
const wrongNumber = readFileSync(new URL("./call-outcome-wrong-number.ts", import.meta.url), "utf8");
assert.equal(wrongNumber.includes("same-number-invalid"), false);

console.log("same number invalid tests passed");
