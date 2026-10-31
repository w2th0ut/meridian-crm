import { randomUUID } from "node:crypto";
import type { ProspectNoteAuditEvent } from "./types.js";

type AuditStore = {
  prospectNoteAudits: ProspectNoteAuditEvent[];
};

/** 每次真正追加备注时记一条。未写、无权和参数错误不记。 */
export function appendProspectNoteAudit(
  store: AuditStore,
  input: {
    actorId: string;
    objectId: string;
    note: string;
    at?: string;
  }
) {
  const event: ProspectNoteAuditEvent = {
    id: `pna_${randomUUID()}`,
    actorId: input.actorId,
    at: input.at || new Date().toISOString(),
    objectType: "prospect_candidate",
    objectId: input.objectId,
    action: "append_note",
    note: input.note
  };
  store.prospectNoteAudits.unshift(event);
  return event;
}
