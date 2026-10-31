import { randomUUID } from "node:crypto";
import type { FollowUpAuditEvent } from "./types.js";

type AuditStore = {
  followUpAudits: FollowUpAuditEvent[];
};

/** 每次成功写入一条跟进记录时记一条。失败、空内容和无权不记。 */
export function appendFollowUpAudit(
  store: AuditStore,
  input: {
    actorId: string;
    objectType: FollowUpAuditEvent["objectType"];
    objectId: string;
    activityId: string;
    at?: string;
  }
) {
  const event: FollowUpAuditEvent = {
    id: `fua_${randomUUID()}`,
    actorId: input.actorId,
    at: input.at || new Date().toISOString(),
    objectType: input.objectType,
    objectId: input.objectId,
    action: "record_follow_up",
    activityId: input.activityId
  };
  store.followUpAudits.unshift(event);
  return event;
}
