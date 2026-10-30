/**
 * 主路径阶段只从已有字段推导，不落库，也不推进状态。
 *
 * 开发信草稿不落库，所以没有单独的「草稿待发」。
 * 清单状态已是可联系、有邮箱、还没发出的，标签写成「待写开发信」，筛选仍归在待触达。
 */

export type AcquisitionStageFilter =
  | "pending"
  | "reached"
  | "contactable"
  | "following"
  | "converted"
  | "held"
  | "excluded";

export type AcquisitionStageKey =
  | "pending_touch"
  | "ready_to_write"
  | "reached_unapproved"
  | "contactable"
  | "following"
  | "converted"
  | "held"
  | "excluded";

export interface AcquisitionStageNotice {
  kind: "suppressed" | "opted_out" | "bounced" | "invalid";
  label: string;
}

export interface AcquisitionStageInput {
  status: "preview" | "contactable" | "contacted" | "synced" | "excluded";
  leadId?: string;
  shortlistedAt?: string;
  createdAt?: string;
  statusChangedAt?: string;
  lastDevelopmentEmailAt?: string;
  lastTouchpointAt?: string;
  nextFollowAt?: string;
  outreachState?: "uncontacted" | "awaiting_reply" | "replied" | "suppressed" | "contact_invalid" | "";
  lastReplyClassification?: string;
  latestFollowUpAt?: string;
  complianceNotices?: AcquisitionStageNotice[];
  /** 与当前账号的 convert_to_lead 资格一致：ready 才算已可联系批准。 */
  approvedContactable?: boolean;
  alreadyLead?: boolean;
  /** 候选上已经有可发邮箱，且发信资格没有被抑制挡住。 */
  hasSendableEmail?: boolean;
}

export interface AcquisitionStage {
  key: AcquisitionStageKey;
  filter: AcquisitionStageFilter;
  label: string;
  tone: "amber" | "green" | "blue" | "red" | "gray";
  summary: string;
  enteredAt: string;
  enteredLabel: string;
  enteredKind: "iso" | "follow" | "";
  holdFocusable: boolean;
}

export const ACQUISITION_STAGE_FILTERS: Array<{ key: AcquisitionStageFilter; label: string }> = [
  { key: "pending", label: "待触达" },
  { key: "reached", label: "已触达" },
  { key: "contactable", label: "可联系" },
  { key: "following", label: "跟进中" },
  { key: "converted", label: "已转线索" },
  { key: "held", label: "抑制" },
  { key: "excluded", label: "已排除" }
];

const HOLD_KIND_LABEL: Record<AcquisitionStageNotice["kind"], string> = {
  suppressed: "已抑制",
  opted_out: "已退订",
  bounced: "已退信",
  invalid: "联系方式无效"
};

function text(value: string | undefined) {
  return (value || "").trim();
}

function stamp(value: string | undefined, label: string, kind: "iso" | "follow" = "iso"): Pick<AcquisitionStage, "enteredAt" | "enteredLabel" | "enteredKind"> {
  const enteredAt = text(value);
  if (!enteredAt) return { enteredAt: "", enteredLabel: "", enteredKind: "" };
  return { enteredAt, enteredLabel: label, enteredKind: kind };
}

function isConverted(input: AcquisitionStageInput) {
  return input.status === "synced" || Boolean(text(input.leadId)) || input.alreadyLead === true;
}

function isReached(input: AcquisitionStageInput) {
  return Boolean(
    text(input.lastDevelopmentEmailAt)
    || text(input.lastTouchpointAt)
    || input.status === "contacted"
    || input.outreachState === "awaiting_reply"
    || input.outreachState === "replied"
  );
}

function inferHold(input: AcquisitionStageInput): { label: string; focusable: boolean } | null {
  const notices = input.complianceNotices || [];
  const first = notices.find((notice) => notice.kind);
  if (first) {
    return {
      label: text(first.label) || HOLD_KIND_LABEL[first.kind] || "已抑制",
      focusable: true
    };
  }
  if (input.lastReplyClassification === "unsubscribed") return { label: "已退订", focusable: false };
  if (input.lastReplyClassification === "bounced") return { label: "已退信", focusable: false };
  if (input.outreachState === "contact_invalid") return { label: "联系方式无效", focusable: false };
  if (input.outreachState === "suppressed") return { label: "已抑制", focusable: false };
  return null;
}

function stage(
  partial: Omit<AcquisitionStage, "enteredAt" | "enteredLabel" | "enteredKind" | "holdFocusable"> & Partial<Pick<AcquisitionStage, "enteredAt" | "enteredLabel" | "enteredKind" | "holdFocusable">>
): AcquisitionStage {
  return {
    enteredAt: "",
    enteredLabel: "",
    enteredKind: "",
    holdFocusable: false,
    ...partial
  };
}

/**
 * 一条候选只落在一个阶段。抑制优先于已转线索；
 * 已触达但未批准时，发信带上的下次跟进仍算已触达，不算跟进中。
 */
export function deriveAcquisitionStage(input: AcquisitionStageInput): AcquisitionStage {
  const hold = inferHold(input);
  if (hold) {
    const leadNote = isConverted(input) ? "这条已经转入线索，阶段仍按抑制或退订显示。" : "";
    const reasonNote = hold.focusable
      ? "点「查看抑制原因」可看到原来的原因和来源。"
      : "原因未回传。";
    return stage({
      key: "held",
      filter: "held",
      label: hold.label,
      tone: "red",
      summary: `${hold.label}。${reasonNote}${leadNote}这里不能解除，也不会自动推进。`,
      holdFocusable: hold.focusable
    });
  }

  if (isConverted(input)) {
    return stage({
      key: "converted",
      filter: "converted",
      label: "已转线索",
      tone: "green",
      summary: "已经转为线索，不能再转一次。",
      ...stamp(input.statusChangedAt, "状态变更")
    });
  }

  if (input.status === "excluded") {
    return stage({
      key: "excluded",
      filter: "excluded",
      label: "已排除",
      tone: "gray",
      summary: "已从处理中排除。这不是抑制或退订。",
      ...stamp(input.statusChangedAt, "状态变更")
    });
  }

  const approved = input.approvedContactable === true;
  const humanFollowUp = Boolean(text(input.latestFollowUpAt));
  const scheduled = Boolean(text(input.nextFollowAt));
  const reached = isReached(input);
  const awaitingApproval = reached && !approved && !humanFollowUp;
  const followStarted = !awaitingApproval && (
    humanFollowUp
    || (scheduled && (approved || (input.status === "contactable" && !reached)))
  );

  if (followStarted) {
    const when = humanFollowUp
      ? stamp(input.latestFollowUpAt, "最近跟进")
      : stamp(input.nextFollowAt, "下次跟进", "follow");
    return stage({
      key: "following",
      filter: "following",
      label: "跟进中",
      tone: "blue",
      summary: "已在跟进。最近跟进和下次跟进仍按原来的记录显示。这里不会自动推进，也不会发送。",
      ...when
    });
  }

  if (approved) {
    return stage({
      key: "contactable",
      filter: "contactable",
      label: "可联系",
      tone: "green",
      summary: "已有当前账号的人工可联系批准，还没有跟进记录。转为线索仍要再确认。"
    });
  }

  if (reached) {
    const replied = input.outreachState === "replied";
    const when = text(input.lastDevelopmentEmailAt)
      ? stamp(input.lastDevelopmentEmailAt, "发出开发信")
      : text(input.lastTouchpointAt)
        ? stamp(input.lastTouchpointAt, "最近触达")
        : stamp(input.statusChangedAt, "状态变更");
    return stage({
      key: "reached_unapproved",
      filter: "reached",
      label: "已触达待批准",
      tone: "amber",
      summary: replied
        ? "已经有回复，当前账号还没有可用于转换的人工可联系批准。不会自动批准。"
        : "已经触达，当前账号还没有可用于转换的人工可联系批准。不会自动批准。",
      ...when
    });
  }

  if (input.status === "contactable" && !text(input.lastDevelopmentEmailAt) && input.hasSendableEmail) {
    return stage({
      key: "ready_to_write",
      filter: "pending",
      label: "待写开发信",
      tone: "amber",
      summary: "清单状态已是可联系，邮箱已有，开发信还没发出。草稿不落库，发送前仍要确认。",
      ...stamp(input.shortlistedAt || input.createdAt, text(input.shortlistedAt) ? "加入搜客清单" : "创建时间")
    });
  }

  return stage({
    key: "pending_touch",
    filter: "pending",
    label: "待触达",
    tone: "amber",
    summary: text(input.shortlistedAt)
      ? "还没有发出开发信，也没有触达记录。"
      : "还没加入搜客清单，也还没有触达记录。",
    ...stamp(input.shortlistedAt || input.createdAt, text(input.shortlistedAt) ? "加入搜客清单" : "创建时间")
  });
}
