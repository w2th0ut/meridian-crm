import { randomUUID } from "node:crypto";
import type { OwnerReassignAuditEvent } from "./types.js";

type AuditStore = {
  ownerReassignAudits: OwnerReassignAuditEvent[];
};

/** 每次成功改掉负责人时记一条。未改、无权和参数错误不记。 */
export function appendOwnerReassignAudit(
  store: AuditStore,
  input: {
    actorId: string;
    objectId: string;
    previousOwnerId: string;
    nextOwnerId: string;
    at?: string;
  }
) {
  const event: OwnerReassignAuditEvent = {
    id: `ora_${randomUUID()}`,
    actorId: input.actorId,
    at: input.at || new Date().toISOString(),
    objectType: "prospect_candidate",
    objectId: input.objectId,
    action: "reassign_owner",
    previousOwnerId: input.previousOwnerId,
    nextOwnerId: input.nextOwnerId
  };
  store.ownerReassignAudits.unshift(event);
  return event;
}
