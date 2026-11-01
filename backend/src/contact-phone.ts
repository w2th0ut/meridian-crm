import { createHash, randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import { customerPhoneId, leadPhoneId, maskOutboundNumber } from "./outbound-call.js";
import { listObjectPhones, phoneDigits } from "./phone-validity-state.js";
import type { CrmStore } from "./store.js";
import type { ContactPhone, ContactPhoneAudit, SessionUser } from "./types.js";

/**
 * 给客户或线索添加、修改或删除附加电话。
 * 主号仍留在 Customer.phone / Lead.phone，这里不改那两列。
 * 附加号码走原来的号码 ID，因此无效标记、首选和一键外呼门禁同样适用。
 * 不拨号，不发信，不推进序列，不改抑制，不转线索。
 */

export const CONTACT_PHONE_LABELS = ["手机", "座机", "总机"] as const;
export type ContactPhoneLabel = (typeof CONTACT_PHONE_LABELS)[number];

const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes", "phones", "phoneIds", "numbers", "labels"] as const;
const TARGET_TYPES = ["customer", "lead"] as const;
const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PHONE_CHARS = /^\+?[0-9][0-9\s().-]*$/;

type TargetType = (typeof TARGET_TYPES)[number];

const WRITE_PERMISSION: Record<TargetType, string> = {
  customer: "customer.update",
  lead: "lead.update"
};

const READ_PERMISSION: Record<TargetType, string> = {
  customer: "customer.read",
  lead: "lead.read"
};

const SEPARATOR_CHARS = [" ", "-", "+", "(", ")", "."] as const;

function sqlDigits(column: string) {
  return SEPARATOR_CHARS.reduce((expr, char) => `REPLACE(${expr}, '${char}', '')`, `TRIM(${column})`);
}

/**
 * 只插入还不存在的主号副本。用号码 ID 和数字同时判断，重复执行不会再插一行。
 * 不 UPDATE、不 DELETE 客户表或线索表。
 */
export const CONTACT_PHONE_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS contact_phones (
  id VARCHAR(64) PRIMARY KEY,
  team_id VARCHAR(64) NOT NULL,
  target_type VARCHAR(20) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  phone_id VARCHAR(128) NOT NULL,
  label VARCHAR(16) NOT NULL DEFAULT '',
  phone VARCHAR(64) NOT NULL,
  phone_digits VARCHAR(32) NOT NULL,
  origin VARCHAR(16) NOT NULL DEFAULT 'extra',
  updated_by VARCHAR(64) NOT NULL DEFAULT '',
  updated_at DATETIME NULL,
  UNIQUE KEY uniq_contact_phone_id(team_id, target_type, target_id, phone_id),
  UNIQUE KEY uniq_contact_phone_digits(team_id, target_type, target_id, phone_digits),
  INDEX idx_contact_phones_target(team_id, target_type, target_id)
)`;

export const CONTACT_PHONE_AUDIT_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS contact_phone_audits (
  id VARCHAR(64) PRIMARY KEY,
  team_id VARCHAR(64) NOT NULL,
  actor_id VARCHAR(64) NOT NULL,
  occurred_at DATETIME NULL,
  action_code VARCHAR(20) NOT NULL,
  target_type VARCHAR(20) NOT NULL DEFAULT '',
  target_id VARCHAR(64) NOT NULL DEFAULT '',
  phone_id VARCHAR(128) NOT NULL DEFAULT '',
  previous_value VARCHAR(160) NOT NULL DEFAULT '',
  next_value VARCHAR(160) NOT NULL DEFAULT '',
  result_code VARCHAR(20) NOT NULL,
  reason_code VARCHAR(64) NOT NULL DEFAULT '',
  INDEX idx_contact_phone_audits_team(team_id, occurred_at),
  INDEX idx_contact_phone_audits_target(team_id, target_type, target_id),
  INDEX idx_contact_phone_audits_actor(actor_id, occurred_at)
)`;

export const CONTACT_PHONE_LEGACY_CUSTOMER_SQL = `INSERT INTO contact_phones
  (id, team_id, target_type, target_id, phone_id, label, phone, phone_digits, origin, updated_by, updated_at)
SELECT
  LEFT(CONCAT('cph_legacy_c_', c.team_id, '_', c.id), 64),
  c.team_id,
  'customer',
  c.id,
  LEFT(CONCAT('customer-phone:', c.id), 128),
  '',
  TRIM(c.phone),
  ${sqlDigits("c.phone")},
  'legacy',
  '',
  UTC_TIMESTAMP()
FROM customers c
WHERE c.phone IS NOT NULL
  AND CHAR_LENGTH(TRIM(c.phone)) > 0
  AND CHAR_LENGTH(${sqlDigits("c.phone")}) > 0
  AND NOT EXISTS (
    SELECT 1 FROM contact_phones cp
    WHERE cp.team_id = c.team_id
      AND cp.target_type = 'customer'
      AND cp.target_id = c.id
      AND (
        cp.phone_id = LEFT(CONCAT('customer-phone:', c.id), 128)
        OR cp.phone_digits = ${sqlDigits("c.phone")}
      )
  )`;

export const CONTACT_PHONE_LEGACY_LEAD_SQL = `INSERT INTO contact_phones
  (id, team_id, target_type, target_id, phone_id, label, phone, phone_digits, origin, updated_by, updated_at)
SELECT
  LEFT(CONCAT('cph_legacy_l_', l.team_id, '_', l.id), 64),
  l.team_id,
  'lead',
  l.id,
  LEFT(CONCAT('lead-phone:', l.id), 128),
  '',
  TRIM(l.phone),
  ${sqlDigits("l.phone")},
  'legacy',
  '',
  UTC_TIMESTAMP()
FROM leads l
WHERE l.deleted_at IS NULL
  AND l.phone IS NOT NULL
  AND CHAR_LENGTH(TRIM(l.phone)) > 0
  AND CHAR_LENGTH(${sqlDigits("l.phone")}) > 0
  AND NOT EXISTS (
    SELECT 1 FROM contact_phones cp
    WHERE cp.team_id = l.team_id
      AND cp.target_type = 'lead'
      AND cp.target_id = l.id
      AND (
        cp.phone_id = LEFT(CONCAT('lead-phone:', l.id), 128)
        OR cp.phone_digits = ${sqlDigits("l.phone")}
      )
  )`;

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function isTargetType(value: string): value is TargetType {
  return (TARGET_TYPES as readonly string[]).includes(value);
}

function hasBatchKey(record: Record<string, unknown>) {
  return BATCH_KEYS.some((key) => key in record);
}

function isLabel(value: string): value is ContactPhoneLabel {
  return (CONTACT_PHONE_LABELS as readonly string[]).includes(value);
}

export function contactPhoneDigitKey(phone: string, phoneId = "") {
  const digits = phoneDigits(phone);
  return digits || (phoneId ? `id:${phoneId}` : "");
}

export function legacyContactPhoneId(targetType: TargetType, targetId: string) {
  return targetType === "customer" ? customerPhoneId(targetId) : leadPhoneId(targetId);
}

export function legacyContactPhoneRowId(teamId: string, targetType: TargetType, targetId: string) {
  const raw = `cph_legacy_${targetType}_${teamId}_${targetId}`;
  if (raw.length <= 64) return raw;
  return `cph_legacy_${createHash("sha256").update(raw).digest("hex").slice(0, 40)}`;
}

/** 旧值和新值只留标签和脱敏号码。 */
export function contactPhoneAuditValue(label: string, phone: string) {
  const masked = phone ? maskOutboundNumber(phone) : "";
  if (!label && !masked) return "";
  return label ? `${label}|${masked}` : masked;
}

export function normalizeContactPhone(value: unknown):
  | { ok: true; phone: string; digits: string }
  | { ok: false; reason: "invalid_phone" } {
  if (typeof value !== "string") return { ok: false, reason: "invalid_phone" };
  const phone = value.trim();
  if (!phone || phone.length > 32 || !PHONE_CHARS.test(phone)) return { ok: false, reason: "invalid_phone" };
  const digits = phoneDigits(phone);
  if (digits.length < 6 || digits.length > 20) return { ok: false, reason: "invalid_phone" };
  return { ok: true, phone, digits };
}

export function normalizeContactPhoneLabel(value: unknown):
  | { ok: true; label: ContactPhoneLabel }
  | { ok: false; reason: "invalid_label" } {
  if (typeof value !== "string" || !isLabel(value)) return { ok: false, reason: "invalid_label" };
  return { ok: true, label: value };
}

function parseTarget(record: Record<string, unknown>):
  | { ok: true; targetType: TargetType; targetId: string }
  | { ok: false; reason: "invalid_request" } {
  if (typeof record.targetType !== "string" || !isTargetType(record.targetType)) {
    return { ok: false, reason: "invalid_request" };
  }
  if (typeof record.targetId !== "string" || !TARGET_ID_PATTERN.test(record.targetId.trim())) {
    return { ok: false, reason: "invalid_request" };
  }
  return { ok: true, targetType: record.targetType, targetId: record.targetId.trim() };
}

export function parseContactPhoneCreateRequest(body: unknown):
  | { ok: true; targetType: TargetType; targetId: string; label: ContactPhoneLabel; phone: string; digits: string }
  | { ok: false; reason: "invalid_request" | "invalid_label" | "invalid_phone" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (hasBatchKey(record)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(record).some((key) => !["targetType", "targetId", "label", "phone"].includes(key))) {
    return { ok: false, reason: "invalid_request" };
  }
  const target = parseTarget(record);
  if (!target.ok) return target;
  const label = normalizeContactPhoneLabel(record.label);
  if (!label.ok) return label;
  const phone = normalizeContactPhone(record.phone);
  if (!phone.ok) return phone;
  return { ...target, label: label.label, phone: phone.phone, digits: phone.digits };
}

export function parseContactPhoneUpdateRequest(body: unknown):
  | { ok: true; targetType: TargetType; targetId: string; phoneId: string; label: ContactPhoneLabel; phone: string; digits: string }
  | { ok: false; reason: "invalid_request" | "invalid_label" | "invalid_phone" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (hasBatchKey(record)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(record).some((key) => !["targetType", "targetId", "phoneId", "label", "phone"].includes(key))) {
    return { ok: false, reason: "invalid_request" };
  }
  const target = parseTarget(record);
  if (!target.ok) return target;
  if (typeof record.phoneId !== "string" || !record.phoneId.trim() || record.phoneId.trim().length > 128) {
    return { ok: false, reason: "invalid_request" };
  }
  const label = normalizeContactPhoneLabel(record.label);
  if (!label.ok) return label;
  const phone = normalizeContactPhone(record.phone);
  if (!phone.ok) return phone;
  return {
    ...target,
    phoneId: record.phoneId.trim(),
    label: label.label,
    phone: phone.phone,
    digits: phone.digits
  };
}

export function parseContactPhoneDeleteRequest(body: unknown):
  | { ok: true; targetType: TargetType; targetId: string; phoneId: string }
  | { ok: false; reason: "invalid_request" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (hasBatchKey(record)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(record).some((key) => !["targetType", "targetId", "phoneId"].includes(key))) {
    return { ok: false, reason: "invalid_request" };
  }
  const target = parseTarget(record);
  if (!target.ok) return target;
  if (typeof record.phoneId !== "string" || !record.phoneId.trim() || record.phoneId.trim().length > 128) {
    return { ok: false, reason: "invalid_request" };
  }
  return { ...target, phoneId: record.phoneId.trim() };
}

export interface LegacyPhoneSource {
  customers: ReadonlyArray<{ id: string; teamId: string; phone?: string }>;
  leads: ReadonlyArray<{ id: string; teamId: string; phone?: string; deletedAt?: string }>;
}

/**
 * 把已有主号规划成 contact_phones 行。不修改传入的客户、线索或已有行。
 * 同一对象上已经有这个号码 ID，或数字已经相同，就不再规划。
 */
export function planLegacyContactPhones(existing: readonly ContactPhone[], sources: LegacyPhoneSource) {
  const seenIds = new Set(existing.map((item) => `${item.teamId}|${item.targetType}|${item.targetId}|${item.phoneId}`));
  const seenDigits = new Set(existing.map((item) => `${item.teamId}|${item.targetType}|${item.targetId}|${item.phoneDigits || contactPhoneDigitKey(item.phone, item.phoneId)}`));
  const planned: ContactPhone[] = [];
  const consider = (targetType: TargetType, item: { id: string; teamId: string; phone?: string; deletedAt?: string }) => {
    if (!item.id || !item.teamId) return;
    if (targetType === "lead" && item.deletedAt) return;
    const phone = (item.phone || "").trim();
    if (!phone) return;
    const phoneId = legacyContactPhoneId(targetType, item.id);
    const digits = contactPhoneDigitKey(phone, phoneId);
    const idKey = `${item.teamId}|${targetType}|${item.id}|${phoneId}`;
    const digitKey = `${item.teamId}|${targetType}|${item.id}|${digits}`;
    if (seenIds.has(idKey) || seenDigits.has(digitKey)) return;
    const row: ContactPhone = {
      id: legacyContactPhoneRowId(item.teamId, targetType, item.id),
      teamId: item.teamId,
      targetType,
      targetId: item.id,
      phoneId,
      label: "",
      phone,
      phoneDigits: digits,
      origin: "legacy",
      updatedBy: "",
      updatedAt: new Date().toISOString()
    };
    planned.push(row);
    seenIds.add(idKey);
    seenDigits.add(digitKey);
  };
  for (const customer of sources.customers) consider("customer", customer);
  for (const lead of sources.leads) consider("lead", lead);
  return planned;
}

/** 把规划出来的主号副本追加进 store。重复调用不会再追加，也不改原来的电话列。 */
export function applyLegacyContactPhoneMigration(store: {
  contactPhones: ContactPhone[];
  customers: LegacyPhoneSource["customers"];
  leads: LegacyPhoneSource["leads"];
}) {
  const planned = planLegacyContactPhones(store.contactPhones, store);
  if (!planned.length) return 0;
  store.contactPhones.push(...planned);
  return planned.length;
}

export interface ContactPhoneEntry {
  phoneId: string;
  label: string;
  phone: string;
  origin: "primary" | "legacy" | "extra";
  editable: boolean;
}

/** 多号码视图。主号列有值时以列为准，复制行不重复出现。 */
export function listContactPhoneEntries(
  store: Parameters<typeof listObjectPhones>[0] & { contactPhones?: readonly ContactPhone[] },
  teamId: string,
  targetType: string,
  targetId: string
): ContactPhoneEntry[] {
  const phones = listObjectPhones(store, teamId, targetType, targetId);
  const rows = (store.contactPhones || []) as readonly ContactPhone[];
  return phones.map((item) => {
    const primaryId = item.targetType === "customer"
      ? customerPhoneId(item.targetId)
      : item.targetType === "lead"
        ? leadPhoneId(item.targetId)
        : "";
    const row = rows.find((entry) =>
      entry.teamId === teamId
      && entry.targetType === item.targetType
      && entry.targetId === item.targetId
      && entry.phoneId === item.phoneId
    );
    const primary = Boolean(primaryId) && item.phoneId === primaryId;
    const origin: ContactPhoneEntry["origin"] = primary ? "primary" : row?.origin === "legacy" ? "legacy" : "extra";
    return {
      phoneId: item.phoneId,
      phone: item.phone,
      label: primary ? "主号" : (row?.label || ""),
      origin,
      editable: origin === "extra"
    };
  });
}

function isPrimaryPhoneId(targetType: TargetType, targetId: string, phoneId: string) {
  return phoneId === legacyContactPhoneId(targetType, targetId);
}

function findStoredPhone(store: CrmStore, teamId: string, targetType: TargetType, targetId: string, phoneId: string) {
  return store.contactPhones.find((item) =>
    item.teamId === teamId
    && item.targetType === targetType
    && item.targetId === targetId
    && item.phoneId === phoneId
  );
}

async function ownerVisible(store: CrmStore, user: SessionUser, permission: string, ownerId: string, teamId: string) {
  if (!hasIamPermission(user, permission)) return false;
  if (store.resolveIamDataScope) {
    const scope = await store.resolveIamDataScope(user, permission);
    return teamId === user.teamId && (scope.tenantWide || scope.ownerIds.includes(ownerId));
  }
  const scopes = user.iamPermissions?.[permission] || [];
  if (scopes.includes("tenant")) return teamId === user.teamId;
  const organizationWide = scopes.includes("org_unit") || scopes.includes("org_subtree");
  const ownerIds = organizationWide
    ? store.users.filter((item) => item.teamId === user.teamId && item.status === "active").map((item) => item.id)
    : scopes.includes("self") ? [user.id] : [];
  return teamId === user.teamId && ownerIds.includes(ownerId);
}

function locate(store: CrmStore, teamId: string, targetType: TargetType, targetId: string) {
  if (targetType === "customer") {
    const customer = store.customers.find((item) => item.id === targetId && item.teamId === teamId);
    if (!customer) return { ok: false as const, status: 404, reason: "not_found", message: "客户不存在" };
    return {
      ok: true as const,
      targetType,
      targetId: customer.id,
      ownerId: customer.ownerId,
      publicPool: isPublicCustomer(customer)
    };
  }
  const lead = store.leads.find((item) => item.id === targetId && item.teamId === teamId && !item.deletedAt);
  if (!lead) return { ok: false as const, status: 404, reason: "not_found", message: "线索不存在或已删除" };
  return { ok: true as const, targetType, targetId: lead.id, ownerId: lead.ownerId, publicPool: false };
}

async function accessFailure(
  store: CrmStore,
  user: SessionUser,
  located: { targetType: TargetType; ownerId: string; publicPool: boolean }
) {
  const permission = WRITE_PERMISSION[located.targetType];
  if (!hasIamPermission(user, permission) || !await ownerVisible(store, user, permission, located.ownerId, user.teamId)) {
    return { status: 403, reason: "forbidden", message: "没有操作该记录的权限" };
  }
  if (located.publicPool) {
    return { status: 409, reason: "public_pool", message: "公池客户为只读，请先领取后再操作" };
  }
  return null;
}

async function canReadTarget(store: CrmStore, user: SessionUser, targetType: TargetType, ownerId: string) {
  if (await ownerVisible(store, user, READ_PERMISSION[targetType], ownerId, user.teamId)) return true;
  return ownerVisible(store, user, WRITE_PERMISSION[targetType], ownerId, user.teamId);
}

async function ensureLegacy(store: CrmStore) {
  const inserted = applyLegacyContactPhoneMigration(store);
  if (inserted) await store.persist();
  return inserted;
}

async function writeAudit(store: CrmStore, input: Omit<ContactPhoneAudit, "id" | "at">) {
  const audit: ContactPhoneAudit = {
    id: `cpa_${randomUUID()}`,
    at: new Date().toISOString(),
    ...input
  };
  store.contactPhoneAudits.unshift(audit);
  await store.persist();
  return audit;
}

async function rejectWithAudit(
  store: CrmStore,
  user: SessionUser,
  input: {
    action: ContactPhoneAudit["action"];
    targetType: TargetType | "";
    targetId: string;
    phoneId: string;
    previousValue: string;
    nextValue: string;
    reason: string;
    status: number;
    message: string;
  }
) {
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    phoneId: input.phoneId,
    previousValue: input.previousValue,
    nextValue: input.nextValue,
    result: "rejected",
    reason: input.reason
  });
  return reject(input.reason, input.message, input.status);
}

function validationMessage(reason: string) {
  if (reason === "invalid_label") return "标签只能是手机、座机或总机";
  if (reason === "invalid_phone") return "电话号码格式不正确";
  return "一次只能为一个对象操作一个附加号码";
}

function digitsTaken(store: CrmStore, teamId: string, targetType: TargetType, targetId: string, exceptPhoneId: string) {
  const taken = new Set<string>();
  for (const item of listObjectPhones(store, teamId, targetType, targetId)) {
    if (exceptPhoneId && item.phoneId === exceptPhoneId) continue;
    const digits = phoneDigits(item.phone);
    if (digits) taken.add(digits);
  }
  return taken;
}

function successBody(input: {
  action: "create" | "update" | "delete";
  message: string;
  targetType: TargetType;
  targetId: string;
  phoneId: string;
  label: string;
  phone: string;
  previousValue: string;
  nextValue: string;
  auditId?: string;
  result?: "updated" | "unchanged";
}) {
  return {
    status: 200,
    body: {
      result: input.result || "updated" as const,
      action: input.action,
      message: input.message,
      targetType: input.targetType,
      targetId: input.targetId,
      phoneId: input.phoneId,
      label: input.label,
      maskedNumber: input.phone ? maskOutboundNumber(input.phone) : "",
      previousValue: input.previousValue,
      nextValue: input.nextValue,
      ...(input.auditId ? { auditId: input.auditId } : {})
    }
  };
}

export async function readContactPhones(
  store: CrmStore,
  user: SessionUser | undefined,
  query: { targetType?: unknown; targetId?: unknown }
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const rawType = typeof query.targetType === "string" ? query.targetType : "";
  const rawId = typeof query.targetId === "string" ? query.targetId.trim() : "";
  if (!isTargetType(rawType) || !TARGET_ID_PATTERN.test(rawId) || Array.isArray(query.targetType) || Array.isArray(query.targetId)) {
    return reject("invalid_request", "一次只能查看一个客户或线索的号码");
  }
  await ensureLegacy(store);
  const owner = locate(store, user.teamId, rawType, rawId);
  if (!owner.ok || !await canReadTarget(store, user, rawType, owner.ownerId)) {
    return reject("not_found", "对象不存在", 404);
  }
  const canWrite = !owner.publicPool && await ownerVisible(store, user, WRITE_PERMISSION[rawType], owner.ownerId, user.teamId);
  const phones = listContactPhoneEntries(store, user.teamId, rawType, rawId);
  return { status: 200, body: { targetType: rawType, targetId: rawId, canWrite, phones } };
}

export async function createContactPhone(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseContactPhoneCreateRequest(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  await ensureLegacy(store);
  const located = locate(store, user.teamId, parsed.targetType, parsed.targetId);
  const nextValue = contactPhoneAuditValue(parsed.label, parsed.phone);
  if (!located.ok) {
    return rejectWithAudit(store, user, {
      action: "create",
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      phoneId: "",
      previousValue: "",
      nextValue,
      reason: located.reason,
      status: located.status,
      message: located.message
    });
  }
  const denied = await accessFailure(store, user, located);
  if (denied) {
    return rejectWithAudit(store, user, {
      action: "create",
      targetType: located.targetType,
      targetId: located.targetId,
      phoneId: "",
      previousValue: "",
      nextValue,
      reason: denied.reason,
      status: denied.status,
      message: denied.message
    });
  }
  if (digitsTaken(store, user.teamId, located.targetType, located.targetId, "").has(parsed.digits)) {
    return reject("duplicate_phone", "这个号码已经在该对象上");
  }
  const phoneId = `contact-phone:${randomUUID()}`;
  const row: ContactPhone = {
    id: `cph_${randomUUID()}`,
    teamId: user.teamId,
    targetType: located.targetType,
    targetId: located.targetId,
    phoneId,
    label: parsed.label,
    phone: parsed.phone,
    phoneDigits: contactPhoneDigitKey(parsed.phone, phoneId),
    origin: "extra",
    updatedBy: user.id,
    updatedAt: new Date().toISOString()
  };
  store.contactPhones.unshift(row);
  const audit = await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "create",
    targetType: located.targetType,
    targetId: located.targetId,
    phoneId,
    previousValue: "",
    nextValue,
    result: "updated",
    reason: "create"
  });
  return successBody({
    action: "create",
    message: "已添加附加号码",
    targetType: located.targetType,
    targetId: located.targetId,
    phoneId,
    label: parsed.label,
    phone: parsed.phone,
    previousValue: "",
    nextValue,
    auditId: audit.id
  });
}

export async function updateContactPhone(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseContactPhoneUpdateRequest(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  await ensureLegacy(store);
  const located = locate(store, user.teamId, parsed.targetType, parsed.targetId);
  const nextValue = contactPhoneAuditValue(parsed.label, parsed.phone);
  if (!located.ok) {
    return rejectWithAudit(store, user, {
      action: "update",
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      phoneId: parsed.phoneId,
      previousValue: "",
      nextValue,
      reason: located.reason,
      status: located.status,
      message: located.message
    });
  }
  const existing = findStoredPhone(store, user.teamId, located.targetType, located.targetId, parsed.phoneId);
  const previousValue = existing ? contactPhoneAuditValue(existing.label, existing.phone) : "";
  const denied = await accessFailure(store, user, located);
  if (denied) {
    return rejectWithAudit(store, user, {
      action: "update",
      targetType: located.targetType,
      targetId: located.targetId,
      phoneId: parsed.phoneId,
      previousValue,
      nextValue,
      reason: denied.reason,
      status: denied.status,
      message: denied.message
    });
  }
  if (isPrimaryPhoneId(located.targetType, located.targetId, parsed.phoneId) || existing?.origin === "legacy") {
    return rejectWithAudit(store, user, {
      action: "update",
      targetType: located.targetType,
      targetId: located.targetId,
      phoneId: parsed.phoneId,
      previousValue,
      nextValue,
      reason: "primary_phone",
      status: 400,
      message: "主号仍在原来的电话栏里，不能从附加号码这里修改"
    });
  }
  if (!existing || existing.origin !== "extra") {
    return rejectWithAudit(store, user, {
      action: "update",
      targetType: located.targetType,
      targetId: located.targetId,
      phoneId: parsed.phoneId,
      previousValue: "",
      nextValue,
      reason: "unknown_phone",
      status: 400,
      message: "这个附加号码不在该对象上"
    });
  }
  if (existing.label === parsed.label && existing.phone === parsed.phone) {
    return successBody({
      result: "unchanged",
      action: "update",
      message: "附加号码没有变化",
      targetType: located.targetType,
      targetId: located.targetId,
      phoneId: existing.phoneId,
      label: existing.label,
      phone: existing.phone,
      previousValue,
      nextValue: previousValue
    });
  }
  if (digitsTaken(store, user.teamId, located.targetType, located.targetId, existing.phoneId).has(parsed.digits)) {
    return reject("duplicate_phone", "这个号码已经在该对象上");
  }
  existing.label = parsed.label;
  existing.phone = parsed.phone;
  existing.phoneDigits = contactPhoneDigitKey(parsed.phone, existing.phoneId);
  existing.updatedBy = user.id;
  existing.updatedAt = new Date().toISOString();
  const audit = await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "update",
    targetType: located.targetType,
    targetId: located.targetId,
    phoneId: existing.phoneId,
    previousValue,
    nextValue,
    result: "updated",
    reason: "update"
  });
  return successBody({
    action: "update",
    message: "已修改附加号码",
    targetType: located.targetType,
    targetId: located.targetId,
    phoneId: existing.phoneId,
    label: parsed.label,
    phone: parsed.phone,
    previousValue,
    nextValue,
    auditId: audit.id
  });
}

export async function deleteContactPhone(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseContactPhoneDeleteRequest(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  await ensureLegacy(store);
  const located = locate(store, user.teamId, parsed.targetType, parsed.targetId);
  if (!located.ok) {
    return rejectWithAudit(store, user, {
      action: "delete",
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      phoneId: parsed.phoneId,
      previousValue: "",
      nextValue: "",
      reason: located.reason,
      status: located.status,
      message: located.message
    });
  }
  const existing = findStoredPhone(store, user.teamId, located.targetType, located.targetId, parsed.phoneId);
  const previousValue = existing ? contactPhoneAuditValue(existing.label, existing.phone) : "";
  const denied = await accessFailure(store, user, located);
  if (denied) {
    return rejectWithAudit(store, user, {
      action: "delete",
      targetType: located.targetType,
      targetId: located.targetId,
      phoneId: parsed.phoneId,
      previousValue,
      nextValue: "",
      reason: denied.reason,
      status: denied.status,
      message: denied.message
    });
  }
  if (isPrimaryPhoneId(located.targetType, located.targetId, parsed.phoneId) || existing?.origin === "legacy") {
    return rejectWithAudit(store, user, {
      action: "delete",
      targetType: located.targetType,
      targetId: located.targetId,
      phoneId: parsed.phoneId,
      previousValue,
      nextValue: "",
      reason: "primary_phone",
      status: 400,
      message: "主号仍在原来的电话栏里，不能从附加号码这里删除"
    });
  }
  if (!existing || existing.origin !== "extra") {
    return rejectWithAudit(store, user, {
      action: "delete",
      targetType: located.targetType,
      targetId: located.targetId,
      phoneId: parsed.phoneId,
      previousValue: "",
      nextValue: "",
      reason: "unknown_phone",
      status: 400,
      message: "这个附加号码不在该对象上"
    });
  }
  const kept = store.contactPhones.filter((item) => item !== existing);
  store.contactPhones.splice(0, store.contactPhones.length, ...kept);
  const audit = await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "delete",
    targetType: located.targetType,
    targetId: located.targetId,
    phoneId: existing.phoneId,
    previousValue,
    nextValue: "",
    result: "updated",
    reason: "delete"
  });
  return successBody({
    action: "delete",
    message: "已删除附加号码",
    targetType: located.targetType,
    targetId: located.targetId,
    phoneId: existing.phoneId,
    label: "",
    phone: "",
    previousValue,
    nextValue: "",
    auditId: audit.id
  });
}
