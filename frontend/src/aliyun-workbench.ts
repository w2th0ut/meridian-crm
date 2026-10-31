/**
 * 云联络中心软电话。版本号取 2026-10-31 打开的官方 3.x 文档：workbench 3.8.1。
 * 不用 IM 插件，所以不加载 cc-im-sdk。测试不插入 g.alicdn.com 的脚本。
 * OAuth2 与 STS 端点待核实，会话接口不下发 AK/SK。
 */

export const CCC_WORKBENCH_VERSION = "3.8.1";

export interface CccWorkbenchSession {
  load?: boolean;
  enabled?: boolean;
  mapped?: boolean;
  permitted?: boolean;
  instanceId?: string;
  regionId?: string;
  ajaxPath?: string;
  domId?: string;
  workbenchVersion?: string;
}

export interface CccCallEvent {
  caller?: string;
  callee?: string;
  jobId?: string;
  callType?: string;
}

export interface CccBeforeDialPayload {
  callee?: string;
  userId?: string;
  callback: (callee?: string) => void;
}

export function shouldLoadCccWorkbench(session: CccWorkbenchSession | null | undefined) {
  return session?.load === true && Boolean(session.instanceId) && Boolean(session.regionId);
}

export function cccWorkbenchAssetUrls(version = CCC_WORKBENCH_VERSION) {
  return {
    styleHref: `//g.alicdn.com/cloudcallcenter/web-workbench-sdk/${version}/ui.min.css`,
    scriptSrc: `//g.alicdn.com/cloudcallcenter/web-workbench-sdk/${version}/ui.min.js`
  };
}

export function buildCccWorkbenchOptions(input: {
  instanceId: string;
  regionId: string;
  ajaxPath: string;
  onCallComing: (event: CccCallEvent) => void;
  onBeforeCallDialing: (payload: CccBeforeDialPayload) => void;
}) {
  return {
    dom: "ccc-workbench-container",
    instanceId: input.instanceId,
    regionId: input.regionId,
    ajaxPath: input.ajaxPath,
    ajaxMethod: "post" as const,
    width: "320px",
    height: "560px",
    header: false,
    exportErrorOfApi: false,
    logger: { builtinEnabled: false },
    functionSwitch: {
      allowMonitoring: false,
      allowCreateTicket: false,
      allowCreateSessionSummary: false,
      closeable: false
    },
    onCallComing: input.onCallComing,
    onBeforeCallDialing: input.onBeforeCallDialing,
    onErrorNotify() {
      return undefined;
    }
  };
}

/** 服务端拒绝时不调用 callback，电话不会拨出。 */
export async function gateBeforeCallDialing(
  payload: CccBeforeDialPayload,
  ask: (callee: string) => Promise<{ allowed?: boolean }>
) {
  const result = await ask(payload.callee || "");
  if (result.allowed === true) payload.callback();
}

export function workbenchPanelCollapsed(expanded: boolean) {
  return !expanded;
}

declare global {
  interface Window {
    CCCWorkbenchSDK?: new (config: object) => unknown;
    workbench?: unknown;
  }
}
