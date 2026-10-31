import { randomUUID } from "node:crypto";
import type { ProspectPriorityAuditEvent } from "./types.js";
import type { ProspectPriority } from "./prospect-priority.js";

type AuditStore = {
  prospectPriorityAudits: ProspectPriorityAuditEvent[];
};

/** 每次真正改掉优先级时记一条。未改、无权和参数错误不记。 */
export function appendProspectPriorityAudit(
  store: AuditStore,
  input: {
    actorId: string;
    objectId: string;
    action: ProspectPriorityAuditEvent["action"];
    oldValue: ProspectPriority | null;
    newValue: ProspectPriority | null;
    at?: string;
  }
) {
  const event: ProspectPriorityAuditEvent = {
    id: `ppa_${randomUUID()}`,
    actorId: input.actorId,
    at: input.at || new Date().toISOString(),
    objectType: "prospect_candidate",
    objectId: input.objectId,
    action: input.action,
    oldValue: input.oldValue,
    newValue: input.newValue
  };
  store.prospectPriorityAudits.unshift(event);
  return event;
}
