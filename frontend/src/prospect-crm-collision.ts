/**
 * 客户/线索撞库只读展示。
 * 判定来自清单接口带回的既有匹配，以及候选上已经写着的 customerId / leadId。
 * 不是正式企业覆盖池，不合并，不改归属。
 */

export type CrmCollisionStatus = "customer" | "lead" | "none";

export type CrmCollisionListFilter = "all" | "hit" | "clear";

export interface CrmCollisionView {
  status: CrmCollisionStatus;
  label: "已有客户" | "已有线索" | "未撞库";
  reason: string;
  recordId: string;
  name: string;
  at: string;
  linkable: boolean;
}

export interface CrmCollisionDirectLink {
  id: string;
  name: string;
  at: string;
}

const LABELS: Record<CrmCollisionStatus, CrmCollisionView["label"]> = {
  customer: "已有客户",
  lead: "已有线索",
  none: "未撞库"
};

export function emptyCrmCollision(): CrmCollisionView {
  return {
    status: "none",
    label: "未撞库",
    reason: "",
    recordId: "",
    name: "",
    at: "",
    linkable: false
  };
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** 只接受接口带回的三种状态。看不见的命中丢掉名称、时间和 id。 */
export function parseCrmCollision(raw: unknown): CrmCollisionView | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const status = record.status;
  if (status !== "customer" && status !== "lead" && status !== "none") return null;
  if (status === "none") return emptyCrmCollision();
  const linkable = record.linkable === true && Boolean(text(record.recordId));
  return {
    status,
    label: LABELS[status],
    reason: text(record.reason),
    recordId: linkable ? text(record.recordId) : "",
    name: linkable ? text(record.name) : "",
    at: linkable ? text(record.at) : "",
    linkable
  };
}

function linkedView(
  status: "customer" | "lead",
  link: CrmCollisionDirectLink,
  reason: string,
  at: string
): CrmCollisionView {
  return {
    status,
    label: LABELS[status],
    reason: reason || (status === "customer" ? "已关联客户" : "已关联线索"),
    recordId: link.id,
    name: link.name.trim(),
    at: at || link.at,
    linkable: true
  };
}

/**
 * 看得见的客户优先，其次是接口上的客户命中，再是看得见的线索。
 * 接口已经写明未撞库时，不再把打不开的 id 说成命中。
 */
export function presentCrmCollision(
  remote: unknown,
  links: { customer: CrmCollisionDirectLink | null; lead: CrmCollisionDirectLink | null }
): CrmCollisionView {
  const parsed = parseCrmCollision(remote);
  const customer = links.customer;
  if (customer && customer.id) {
    const same = parsed?.status === "customer" && (!parsed.recordId || parsed.recordId === customer.id);
    return linkedView(
      "customer",
      customer,
      same ? parsed?.reason || "已关联客户" : "已关联客户",
      customer.at || (same ? parsed?.at || "" : "")
    );
  }
  if (parsed?.status === "customer") return parsed;
  const lead = links.lead;
  if (lead && lead.id) {
    const same = parsed?.status === "lead" && (!parsed.recordId || parsed.recordId === lead.id);
    return linkedView(
      "lead",
      lead,
      same ? parsed?.reason || "已关联线索" : "已关联线索",
      lead.at || (same ? parsed?.at || "" : "")
    );
  }
  return parsed || emptyCrmCollision();
}

export function crmCollisionMatchesFilter(view: CrmCollisionView, filter: CrmCollisionListFilter) {
  if (filter === "hit") return view.status !== "none";
  if (filter === "clear") return view.status === "none";
  return true;
}

export function crmCollisionDisplayName(view: CrmCollisionView) {
  if (view.status === "none") return "";
  return view.name || "名称不展示";
}

export function crmCollisionLinkLabel(view: CrmCollisionView) {
  if (!view.linkable || !view.recordId) return "";
  if (view.status === "customer") return "查看已有客户";
  if (view.status === "lead") return "查看已有线索";
  return "";
}

export function crmCollisionSummary(view: CrmCollisionView, formattedAt = "") {
  if (view.status === "none") {
    return "未撞库。这里只对照已有客户和线索，不是正式企业覆盖池，也不会自动合并或改归属。";
  }
  const when = formattedAt ? `关键时间 ${formattedAt}。` : "";
  if (!view.linkable) {
    return `${view.label}。名称不展示。${view.reason ? `${view.reason}。` : ""}当前账号打不开这条记录。不会自动合并，也不会改归属。`;
  }
  const name = view.name || "名称未回传";
  return `${view.label}：${name}。${view.reason ? `${view.reason}。` : ""}${when}可以打开现有详情。不会自动合并，也不会改归属。`;
}
