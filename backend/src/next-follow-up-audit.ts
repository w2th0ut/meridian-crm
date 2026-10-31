import { randomUUID } from "node:crypto";
import type { NextFollowUpAuditEvent } from "./types.js";

type AuditStore = {
  nextFollowUpAudits: NextFollowUpAuditEvent[];
};

/** 每次真正改掉下次跟进时记一条。未改、无权和参数错误不记。 */
export function appendNextFollowUpAudit(
  store: AuditStore,
  input: {
    actorId: string;
    objectId: string;
    action: NextFollowUpAuditEvent["action"];
    oldValue: string;
    newValue: string;
    at?: string;
  }
) {
  const event: NextFollowUpAuditEvent = {
    id: `nfu_${randomUUID()}`,
    actorId: input.actorId,
    at: input.at || new Date().toISOString(),
    objectType: "prospect_candidate",
    objectId: input.objectId,
    action: input.action,
    oldValue: input.oldValue,
    newValue: input.newValue
  };
  store.nextFollowUpAudits.unshift(event);
  return event;
}
