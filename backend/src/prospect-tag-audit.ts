import { randomUUID } from "node:crypto";
import type { ProspectTagAuditEvent } from "./types.js";

type AuditStore = {
  prospectTagAudits: ProspectTagAuditEvent[];
};

/** 每次真正改掉标签时记一条。未改、无权和参数错误不记。 */
export function appendProspectTagAudit(
  store: AuditStore,
  input: {
    actorId: string;
    objectId: string;
    action: ProspectTagAuditEvent["action"];
    tags: string[];
    at?: string;
  }
) {
  const event: ProspectTagAuditEvent = {
    id: `pta_${randomUUID()}`,
    actorId: input.actorId,
    at: input.at || new Date().toISOString(),
    objectType: "prospect_candidate",
    objectId: input.objectId,
    action: input.action,
    tags: [...input.tags]
  };
  store.prospectTagAudits.unshift(event);
  return event;
}
