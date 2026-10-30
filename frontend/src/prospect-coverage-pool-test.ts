import assert from "node:assert/strict";
import {
  COVERAGE_POOL_IN_LABEL,
  COVERAGE_POOL_OUT_LABEL,
  COVERAGE_POOL_OUT_SUMMARY,
  coveragePoolNextAction,
  deriveCoveragePool
} from "./prospect-coverage-pool.js";

const missing = deriveCoveragePool({ tenantProspectId: "" });
assert.equal(missing.inPool, false);
assert.equal(missing.filter, "out");
assert.equal(missing.label, COVERAGE_POOL_OUT_LABEL);
assert.equal(missing.label, "未进正式企业覆盖池");
assert.match(missing.summary, /尚未进入正式企业覆盖池，不能转为线索/);
assert.match(missing.summary, /不会自动入池/);
assert.equal(missing.summary, COVERAGE_POOL_OUT_SUMMARY);

const blank = deriveCoveragePool({ tenantProspectId: "   " });
assert.equal(blank.inPool, false);
assert.equal(blank.label, "未进正式企业覆盖池");

const absent = deriveCoveragePool({});
assert.equal(absent.inPool, false);

const pooled = deriveCoveragePool({ tenantProspectId: "prospect-1" });
assert.equal(pooled.inPool, true);
assert.equal(pooled.filter, "in");
assert.equal(pooled.label, COVERAGE_POOL_IN_LABEL);
assert.equal(pooled.label, "已在正式企业覆盖池");
assert.match(pooled.summary, /不会自动转入/);
assert.equal(coveragePoolNextAction({
  inPool: true,
  convertReady: true,
  needsDevelopmentEmail: true,
  approvalPending: true
}), null);

const convert = coveragePoolNextAction({
  inPool: false,
  convertReady: true,
  needsDevelopmentEmail: true,
  approvalPending: true
});
assert.equal(convert?.kind, "convert");
assert.equal(convert?.label, "去确认转为线索");
assert.match(convert?.hint || "", /不会直接转入/);

const email = coveragePoolNextAction({
  inPool: false,
  convertReady: false,
  needsDevelopmentEmail: true,
  approvalPending: true
});
assert.equal(email?.kind, "write_email");
assert.equal(email?.label, "去写开发信");
assert.match(email?.hint || "", /不会发送/);

const approval = coveragePoolNextAction({
  inPool: false,
  convertReady: false,
  needsDevelopmentEmail: false,
  approvalPending: true
});
assert.equal(approval?.kind, "request_approval");
assert.equal(approval?.label, "去申请可联系批准");
assert.match(approval?.hint || "", /不会自动批准/);

const identity = coveragePoolNextAction({
  inPool: false,
  convertReady: false,
  needsDevelopmentEmail: false,
  approvalPending: false
});
assert.equal(identity?.kind, "resolve_identity");
assert.equal(identity?.label, "去补正式企业身份");
assert.match(identity?.hint || "", /不会自动开始/);
assert.match(identity?.hint || "", /不会自动入池/);

console.log("prospect-coverage-pool-test: ok");
