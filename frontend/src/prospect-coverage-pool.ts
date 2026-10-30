/**
 * 正式企业覆盖池只看候选是否已关联 TenantProspect（tenantProspectId）。
 * 与 convert_to_lead 在缺少该字段时的拒绝原因是同一句，不另建池表，也不写入。
 */

export type CoveragePoolListFilter = "all" | "in" | "out";

export type CoveragePoolSide = "in" | "out";

export type CoverageNextActionKind =
  | "convert"
  | "write_email"
  | "request_approval"
  | "resolve_identity";

export interface CoveragePoolInput {
  tenantProspectId?: string | null;
}

export interface CoveragePoolView {
  inPool: boolean;
  filter: CoveragePoolSide;
  label: string;
  tone: "green" | "amber";
  summary: string;
}

export interface CoverageNextActionInput {
  inPool: boolean;
  /** 与当前账号的 convert_to_lead 资格一致。未进池时现有门禁不会为真。 */
  convertReady: boolean;
  /** 已在搜客清单、可联系、有邮箱、开发信还没发出。 */
  needsDevelopmentEmail: boolean;
  /** 缺项里是当前业务员的人工可联系批准。 */
  approvalPending: boolean;
}

export interface CoverageNextAction {
  kind: CoverageNextActionKind;
  label: string;
  hint: string;
}

export const COVERAGE_POOL_IN_LABEL = "已在正式企业覆盖池";
export const COVERAGE_POOL_OUT_LABEL = "未进正式企业覆盖池";
export const COVERAGE_POOL_OUT_SUMMARY =
  "候选尚未进入正式企业覆盖池，不能转为线索。这里只标出缺口，不会自动入池。";

export function deriveCoveragePool(input: CoveragePoolInput): CoveragePoolView {
  const inPool = Boolean((input.tenantProspectId || "").trim());
  if (inPool) {
    return {
      inPool: true,
      filter: "in",
      label: COVERAGE_POOL_IN_LABEL,
      tone: "green",
      summary: "已在正式企业覆盖池。转为线索仍要再确认，这里不会自动转入。"
    };
  }
  return {
    inPool: false,
    filter: "out",
    label: COVERAGE_POOL_OUT_LABEL,
    tone: "amber",
    summary: COVERAGE_POOL_OUT_SUMMARY
  };
}

/**
 * 未进池时的下一步只指向现有入口。
 * 转线索优先；否则缺开发信或可联系批准时去对应待办；都没有时才打开正式企业身份。
 * 不提交核验、不批准、不发信、不转入。
 */
export function coveragePoolNextAction(input: CoverageNextActionInput): CoverageNextAction | null {
  if (input.inPool) return null;
  if (input.convertReady) {
    return {
      kind: "convert",
      label: "去确认转为线索",
      hint: "已具备转线索资格。这里只打开现有确认，不会直接转入。"
    };
  }
  if (input.needsDevelopmentEmail) {
    return {
      kind: "write_email",
      label: "去写开发信",
      hint: "还缺开发信。这里只打开现有草稿，不会发送。"
    };
  }
  if (input.approvalPending) {
    return {
      kind: "request_approval",
      label: "去申请可联系批准",
      hint: "还缺当前业务员的人工可联系批准。这里只打开现有检查，不会自动批准。"
    };
  }
  return {
    kind: "resolve_identity",
    label: "去补正式企业身份",
    hint: "尚未进入正式企业覆盖池。这里只打开现有身份核验，不会自动开始，也不会自动入池。"
  };
}
