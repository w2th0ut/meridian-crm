import { randomUUID } from "node:crypto";
import type { OwnerReassignAuditEvent } from "./types.js";

type AuditStore = {
  ownerReassignAudits: OwnerReassignAuditEvent[];
};

/** 成功改掉负责人时记一条。通话结果里的拒绝也记在这张表。参数错误不记。 */
export function appendOwnerReassignAudit(
  store: AuditStore,
  input: {
    actorId: string;
    objectId: string;
    previousOwnerId: string;
    nextOwnerId: string;
    at?: string;
    objectType?: OwnerReassignAuditEvent["objectType"];
    action?: OwnerReassignAuditEvent["action"];
    callRecordId?: string;
    batchId?: string;
  }
) {
  const event: OwnerReassignAuditEvent = {
    id: `ora_${randomUUID()}`,
    actorId: input.actorId,
    at: input.at || new Date().toISOString(),
    objectType: input.objectType || "prospect_candidate",
    objectId: input.objectId,
    action: input.action || "reassign_owner",
    previousOwnerId: input.previousOwnerId,
    nextOwnerId: input.nextOwnerId,
    callRecordId: input.callRecordId || "",
    batchId: input.batchId || ""
  };
  store.ownerReassignAudits.unshift(event);
  return event;
}
