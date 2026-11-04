import { randomUUID } from "node:crypto";
import { canSeeOwner, hasIamPermission, type IamActor } from "./auth.js";
import { CALL_NOTE_TAGS, recordHasCallNote, splitCallNoteTags } from "./call-note.js";
import { displayMaskedNumber } from "./call-wrapup-queue.js";
import { outboundInstant } from "./outbound-call.js";
import {
  outboundCallRecordVisible,
  resolveOutboundCallRecordAccess
} from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type { OutboundCallRecord, ProspectCallNoteViewAudit, SessionUser } from "./types.js";

/**
 * 搜客跟进旁边只读已经写下的通话纪要。
 * 客户和线索的时间线在 §65 已经带上纪要。搜客对象当时没有这条时间线。
 * 这里不按通话结果分类，不改下次跟进，也不新写跟进。
 * 查看写入 prospect_call_note_view_audits。不拨号，不发信，不调用外部接口。
 */

const CANDIDATE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface ProspectCallNoteItem {
  callRecordId: string;
  note: string;
  tags: string[];
  at: string;
  maskedNumber: string;
}

export function parseProspectCallNoteQuery(query: Record<string, unknown>): { candidateId: string } | null {
  if (Object.keys(query).some((key) => key !== "candidateId")) return null;
  if (Object.values(query).some((value) => Array.isArray(value))) return null;
  const raw = query.candidateId;
  if (typeof raw !== "string") return null;
  const candidateId = raw.trim();
  if (!CANDIDATE_ID.test(candidateId)) return null;
  return { candidateId };
}

export function prospectCallNotesForCandidate(input: {
  teamId: string;
  candidateId: string;
  records: readonly OutboundCallRecord[];
  visible: (record: OutboundCallRecord) => boolean;
}): ProspectCallNoteItem[] {
  return input.records
    .filter((record) => (
      record.teamId === input.teamId
      && record.targetType === "prospect"
      && record.targetId === input.candidateId
      && recordHasCallNote(record)
      && input.visible(record)
    ))
    .map((record) => {
      const picked = new Set(splitCallNoteTags(record.callNoteTags || ""));
      return {
        callRecordId: record.id,
        note: (record.callNote || "").trim(),
        tags: CALL_NOTE_TAGS.filter((tag) => picked.has(tag)),
        at: (record.callNoteUpdatedAt || "").trim(),
        maskedNumber: displayMaskedNumber(record.maskedNumber || "")
      };
    })
    .filter((item) => item.note || item.tags.length > 0)
    .sort((left, right) => {
      if (left.at !== right.at) return left.at < right.at ? 1 : -1;
      return left.callRecordId < right.callRecordId ? 1 : -1;
    });
}

function clipId(value: string) {
  return value.slice(0, 64);
}

async function assignReadScope(store: CrmStore, user: SessionUser, permissionCode: string) {
  if (store.resolveIamDataScope) {
    user.iamDataScope = {
      permissionCode,
      ...await store.resolveIamDataScope(user, permissionCode)
    };
    return;
  }
  const scopes = (user.iamPermissions?.[permissionCode] || []) as Array<"self" | "org_unit" | "org_subtree" | "tenant" | "public_pool">;
  const organizationWide = scopes.includes("org_unit") || scopes.includes("org_subtree");
  user.iamDataScope = {
    permissionCode,
    tenantWide: scopes.includes("tenant"),
    ownerIds: organizationWide
      ? store.users.filter((item) => item.teamId === user.teamId && item.status === "active").map((item) => item.id)
      : scopes.includes("self") ? [user.id] : []
  };
}

async function writeAudit(store: CrmStore, input: Omit<ProspectCallNoteViewAudit, "id" | "at">) {
  const audit: ProspectCallNoteViewAudit = {
    id: `pcna_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input,
    candidateId: clipId(input.candidateId),
    rowCount: Number.isFinite(input.rowCount) ? input.rowCount : 0
  };
  store.prospectCallNoteViewAudits.unshift(audit);
  await store.persist();
  return audit;
}

async function deny(store: CrmStore, user: SessionUser, candidateId: string) {
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "read",
    candidateId,
    rowCount: 0,
    result: "rejected",
    reason: "forbidden"
  });
  return {
    status: 403,
    body: {
      result: "rejected" as const,
      reason: "forbidden",
      message: "没有查看这个搜客对象通话纪要的权限"
    }
  };
}

export async function listProspectCallNotes(
  store: CrmStore,
  user: SessionUser | undefined,
  query: Record<string, unknown>
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseProspectCallNoteQuery(query);
  if (!parsed) {
    return {
      status: 400,
      body: {
        result: "rejected" as const,
        reason: "invalid_request",
        message: "一次只能查看一个搜客对象的通话纪要"
      }
    };
  }
  if (!hasIamPermission(user as IamActor, "communication.read") || !hasIamPermission(user as IamActor, "prospect.read")) {
    return deny(store, user, parsed.candidateId);
  }
  const scopeBefore = user.iamDataScope;
  await assignReadScope(store, user, "prospect.read");
  const candidate = store.websiteOpportunities.find((item) => item.id === parsed.candidateId && item.teamId === user.teamId);
  const visible = Boolean(candidate && canSeeOwner(user, candidate.ownerId, candidate.teamId));
  user.iamDataScope = scopeBefore;
  if (!visible) return deny(store, user, parsed.candidateId);
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  user.iamDataScope = scopeBefore;
  if (!resolved.ok) return deny(store, user, parsed.candidateId);
  const items = prospectCallNotesForCandidate({
    teamId: user.teamId,
    candidateId: parsed.candidateId,
    records: store.outboundCallRecords,
    visible: (record) => outboundCallRecordVisible(record, user.teamId, resolved.access)
  });
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "read",
    candidateId: parsed.candidateId,
    rowCount: items.length,
    result: "read",
    reason: ""
  });
  return {
    status: 200,
    body: {
      candidateId: parsed.candidateId,
      empty: items.length === 0,
      items
    }
  };
}
