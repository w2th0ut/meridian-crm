import { randomUUID } from "node:crypto";
import type { ProspectIndustryAuditEvent } from "./types.js";

type AuditStore = {
  prospectIndustryAudits: ProspectIndustryAuditEvent[];
};

/** 每次真正改掉行业时记一条。未改、无权和参数错误不记。 */
export function appendProspectIndustryAudit(
  store: AuditStore,
  input: {
    actorId: string;
    objectId: string;
    action: ProspectIndustryAuditEvent["action"];
    oldValue: string | null;
    newValue: string | null;
    at?: string;
  }
) {
  const event: ProspectIndustryAuditEvent = {
    id: `pia_${randomUUID()}`,
    actorId: input.actorId,
    at: input.at || new Date().toISOString(),
    objectType: "prospect_candidate",
    objectId: input.objectId,
    action: input.action,
    oldValue: input.oldValue,
    newValue: input.newValue
  };
  store.prospectIndustryAudits.unshift(event);
  return event;
}
