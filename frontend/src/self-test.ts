import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { resolveLeadAiSearchDraft } from "./lead-ai-search.js";
import {
  isLeadSourceAutoSelected,
  isLeadSourceExecutable,
  resolveLeadSearchSources
} from "./lead-source-selection.js";

const prototype = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const apiLayer = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const prospectRadar = readFileSync(new URL("./prospect-radar.ts", import.meta.url), "utf8");
const tradeMotion = readFileSync(new URL("./trade-motion.ts", import.meta.url), "utf8");
const themeCss = readFileSync(new URL("./theme-keduoduo.css", import.meta.url), "utf8");
const adminDeck = readFileSync(new URL("./admin-deck.ts", import.meta.url), "utf8");
const adminCss = readFileSync(new URL("./theme-keduoduo-admin.css", import.meta.url), "utf8");
const timetable = readFileSync(new URL("./trade-timetable.ts", import.meta.url), "utf8");
const integrationCenter = readFileSync(new URL("./integrations/integration-center.ts", import.meta.url), "utf8");
const productConfig = JSON.parse(readFileSync(new URL("../public/product-config.json", import.meta.url), "utf8")) as {
  productName?: string;
  version?: string;
};

const required = [
  "login-screen",
  "loginProductVersion",
  "previewCustomsButton",
  "customsPreviewPage",
  "customs-pack-preview-page",
  "customsDocumentValidation",
  "is-missing",
  "todo-board",
  "report-deck",
  "id=\"knowledge\"",
  "id=\"exam\"",
  "id=\"tools\"",
  "id=\"settings\"",
  "id=\"database-maintenance\"",
  "data-view=\"database-maintenance\"",
  "MYSQL_LOCAL_BACKUP_ENABLED=true",
  "/api/system/database-maintenance/status",
  "/api/system/database-backups/jobs",
  "databaseStreamLog",
  "databaseTableProgressMeta",
  "暂停滚动",
  "下载日志",
  "prototype-api.ts",
  "/api/auth/login",
  "/api/dashboard/summary",
  "DASHBOARD_LIVE_REFRESH_MS",
  "EXCHANGE_RATE_REFRESH_MS",
  "refreshVisibleDashboard",
  "requestDashboardRefresh",
  "/api/exchange-rates/today",
  "dashboardExchangeTicker",
  "dashboardCurrentDate",
  "仅提供最近一个交易日",
  "/api/knowledge/assets",
  "/api/exams",
  "/api/tools/ocr/jobs/current/image",
  "}/recognize-image",
  "}/sync-lead",
  "ocrFileInput",
  "/api/lead-finder/providers",
  "/api/lead-finder/launch",
  "/api/lead-finder/source-config",
  "retryAfterAt",
  "后可重试",
  "errorCode",
  "可稍后重试",
  "incrementalStats",
  "净新增 / 命中",
  "历史未变化",
  "已结束",
  "事实事件同步",
  "lead-job-source-list",
  "搜客任务失败",
  "加入搜客清单失败",
  "/conversion-preview",
  "转为客户",
  "createDeal",
  "pipelineAmount",
  "/api/leads?trash=true",
  "sourceEvents",
  "leadPermanentConfirmInput",
  "data-problem-delete",
  "deleteSelectedProblem",
  "problemSearchInput",
  "problemStatusFilter",
  "problemSeverityFilter",
  "problemCategoryFilter",
  "data-problem-edit",
  "data-problem-open",
  "problemDrawer",
  "resolvedAt",
  "problem-solution-highlight",
  "problem-solution-field",
  "closeOnBackdrop: false",
  "prospectEnrichContactsButton",
  "No qualification review is required first",
  "leadSourceCenterButton",
  "leadSourceChips",
  "openLeadSourceCenter",
  "data-ls-import",
  "返回并导入链接",
  "leadFinderDetailSaveButton",
  "leadFinderDetailShortlistButton",
  "leadFinderLookupDiagnosis",
  "查看原因详情",
  "本次未找到候选的原因",
  "advanced-excel-types",
  "is-current",
  "stageCurrency",
  "来源证据",
  "sourceEvidence",
  "ai_search",
  "data-view=\"commission\"",
  "id=\"commission\"",
  "commissionSyncDealsButton",
  "commissionRecalculateButton",
  "/api/commission/products",
  "/api/commission/sales-records",
  "/api/commission/calculations/recalculate",
  "renderCommission",
  "notificationBellButton",
  "notificationBellBadge",
  "消息通知",
  "navigateFromInternalMessage",
  "查看日报",
  "quoteHistoryViewButton",
  "quoteHistoryWorkspace",
  "quoteHistoryProduct",
  "quoteHistoryCountry",
  "quoteHistoryProductModeButton",
  "quoteHistoryProductRows",
  "quoteHistoryProductOverview",
  "productAnalysis",
  "openQuoteHistoryForDeal",
  "查看报价变化",
  "/api/quote-history",
  "agentPendingGoal",
  "agentPendingProgress",
  "/api/agent/plan/stream",
  "正在理解你的目标和当前业务上下文",
  "agent-live-execution",
  "agent-action-chain",
  "可审计动作链",
  "最近执行记录",
  "agentFailureDiagnosis",
  "data-view=\"integration-center\"",
  "aria-label=\"权限管理\"",
  "data-admin-only",
  "id=\"integration-center\"",
  "data-integration-tab=\"catalog\"",
  "data-integration-tab=\"mail-calendar\"",
  "data-integration-tab=\"connected\"",
  "data-integration-tab=\"permissions\"",
  "data-integration-tab=\"approvals\"",
  "data-integration-tab=\"activity\"",
  "installIntegrationCenterInteractions",
  "integrationPrototypeConnect",
  "entry.type === \"assistant\"",
  "data-agent-chat-approve",
  "确认写入",
  "agentKnowledgeStatus",
  "/api/agent/knowledge/overview",
  "/api/agent/knowledge/search",
  "Agent 学习中心",
  "leadSuperWebSearch",
  "leadSuperMapSearch",
  "leadSuperAiDiscovery",
  "webSearchMode: superWebSearchMode()",
  "mapSearchMode: superMapSearchMode()",
  "aiDiscoveryMode: superAiDiscoveryMode()",
  "google_places",
  "leadTaskCandidates",
  "leadTaskSyncCandidates",
  "纳入候选池",
  "可加入搜客清单的候选",
  "leadFinderLiveOverview",
  "leadFinderCleaningRows",
  "最近一次执行",
  "最多展示 100 条管线处置记录",
  "来源解析阶段的数据无效与页内重复仅提供汇总",
  "record.sourceRecordId",
  "record.sourceCompany",
  "record.sourceDomain",
  "data-prospect-date-filter=\"today\"",
  "prospectJoinedFrom",
  "prospectSortSelect",
  "加入搜客清单时间",
  "prospect-mobile-detail-open",
  "prospectRadarDialog",
  "data-lead-live-radar",
  "buildProspectRadarModel",
  "buildProspectPoolRadarModel",
  "data-lead-pool-radar",
  "关系连线仅来自已记录证据",
  "leadFinderProgressBoard",
  "dashboardProspectRuns",
  "dashboardPendingEmails",
  "dashboardRecentOutreach",
  "待写开发信",
  "最近触达",
  "进行中的搜客",
  "刷新进度",
  "尚未结束",
  "尚未回传"
];

assert.match(apiLayer, /"email-return-flow": "开发信回流"/u, "开发信回流工作区标签必须使用中文名称");
assert.match(apiLayer, /deckTicker\.innerHTML = logs\.length \? seq \+ seq : seq/u, "空回流状态不得重复渲染滚动提示");
assert.match(apiLayer, /const captureHeight = Math\.max\(capture\.scrollHeight/u, "PDF 导出必须捕获完整预览高度");
assert.match(apiLayer, /const captureWidth = 794[\s\S]*captureHost = document\.createElement\("div"\)/u, "PDF 导出必须使用独立的 A4 宽度画布");
assert.match(apiLayer, /height: captureHeight/u, "PDF 导出必须把完整预览高度传给截图引擎");
assert.match(apiLayer, /capture\.style[\s\S]*maxWidth: "none"[\s\S]*margin: "0"/u, "PDF 导出画布不得继承屏幕预览的居中偏移");
assert.match(prototype, /\.print-only-document\.doc-paper \{[\s\S]*max-height: none !important;[\s\S]*overflow: visible !important;/u, "打印降级不能裁切多页单据");

for (const token of required) {
  if (!prototype.includes(token) && !apiLayer.includes(token)) throw new Error(`missing ${token}`);
}

assert.equal(prototype.includes("data-view=\"inbox\""), false, "消息通知不应出现在左侧导航");
assert.equal(prototype.includes("写站内信"), false, "通知中心不应提供人工写信入口");
assert.equal(apiLayer.includes("openInternalMessageComposeModal"), false, "不应保留旧写信交互");
const systemNavigation = prototype.slice(
  prototype.indexOf('<details class="nav-section" aria-label="系统配置">'),
  prototype.indexOf("</nav>")
);
assert.equal(systemNavigation.includes('data-view="member-management"'), false, "权限模块不得继续混在系统配置导航中");
assert.match(prototype, /aria-label="权限管理"[\s\S]*data-view="member-management"[\s\S]*data-view="permission-audit"/, "权限页面必须集中在独立权限管理分组");
assert.match(apiLayer, /isAccessControlView\(view\) && !isSystemAdministrator\(user\)/, "权限页面必须额外校验管理员或超级管理员身份");
assert.match(apiLayer, /function isPlatformOperator[\s\S]*user\.role === "super_admin"/, "超级管理员必须被识别为平台运维身份");
assert.match(apiLayer, /if \(isPlatformOperator\(user\)\) \{[\s\S]*return view === "platform-operations"/, "平台运维账号只能进入运维中心");
assert.match(apiLayer, /view = platformOperator \? "platform-operations" : "dashboard"/, "平台运维账号非法跳转时必须返回运维中心");
assert.match(prototype, /运维专用账号[\s\S]*业务模块，请登录其他账号/, "运维中心必须明确提示业务模块使用其他账号");
assert.match(apiLayer, /if \(isPlatformOperator\(\)\) \{[\s\S]*openWorkspaceTabs = \["platform-operations"\][\s\S]*wrap\.innerHTML = ""/, "超级管理员顶部不得残留工作台标签");
assert.match(prototype, /body\.platform-mode #topOpenTabs,[\s\S]*body\.platform-mode \.top-status,[\s\S]*body\.platform-mode #notificationBellButton/, "运维模式必须隐藏业务工作台状态栏");
assert.match(apiLayer, /node\.hidden = !isSystemAdministrator\(user\)/, "权限管理导航只按管理员身份显示");
assert.match(apiLayer, /class="ac-workbench ac-role-layout"[\s\S]*class="ac-role-list"[\s\S]*class="ac-permission-table"/, "角色管理必须使用角色目录与当前角色权限双栏结构");
assert.match(apiLayer, /class="ac-role-checks" id="iamMemberRoleIds"[\s\S]*type="checkbox"/, "成员授权必须使用清晰的角色复选项，不能退回原生多选框");
assert.match(apiLayer, /data-ac-guide aria-label="权限使用说明"/, "权限模块必须提供独立的使用说明入口");
assert.match(apiLayer, /仅超级管理员和管理员可以设置[\s\S]*建立组织架构[\s\S]*创建角色并配置权限[\s\S]*给成员分配角色[\s\S]*通过审计复核/, "权限使用说明必须覆盖访问限制与完整配置顺序");
assert.match(apiLayer, /function bindAccessControlInteractions[\s\S]*const root = activeAccessControlRoot\(\)[\s\S]*root\.querySelector<T>/, "权限页面交互必须绑定在当前页面，不能误绑到隐藏的成员管理页面");
assert.doesNotMatch(apiLayer, /class="ac-metrics"|class="ac-loading-metrics"/, "权限页面和加载态都不得继续显示顶部五项统计条");
const systemSettingsView = prototype.slice(
  prototype.indexOf('<div class="view" id="settings"'),
  prototype.indexOf('<section class="view" id="products">')
);
assert.match(systemSettingsView, /<h1>系统设置<\/h1>/, "系统设置页面必须使用正确标题");
assert.doesNotMatch(systemSettingsView, /账号列表|新增账号|权限模板|角色权限/, "人员与权限配置不得在系统设置中重复出现");
assert.match(systemSettingsView, /公司资料[\s\S]*单据设置[\s\S]*系统更新/, "系统设置必须保留公司资料、单据设置与系统更新");
assert.equal(apiLayer.includes("leadFinderDetailMarkButton"), false, "自动获客不应保留标记可联系的授权语义");
assert.match(apiLayer, /function prospectLookupDiagnosis[\s\S]*This does not mean the company is inactive/, "联系人缺失必须提供业务可理解的原因说明");
assert.match(apiLayer, /data-lead-lookup-reason/, "联系人和联系方式未找到状态必须可以点击查看原因");
assert.match(apiLayer, /function leadFinderNoResultReasons[\s\S]*清洗规则/, "整次搜索无结果时必须汇总来源和清洗原因");
assert.match(
  apiLayer,
  /async function openAdvancedExcelPanel\(\)[\s\S]*const editorType = currentDocumentType\(\)[\s\S]*if \(current\.type !== editorType\)[\s\S]*await saveTradeDocument\(\)[\s\S]*type === current\.type \? "is-current"/,
  "高级 Excel 必须先同步当前编辑器单据类型，并高亮当前类型模板"
);
const standardRunStatusContract = apiLayer.slice(
  apiLayer.indexOf("function prospectRunStatusLabel"),
  apiLayer.indexOf("function prospectRunActivityLabel")
);
for (const status of ["cancelled", "succeeded", "succeeded_empty", "partial_success", "failed"]) {
  assert.match(
    standardRunStatusContract,
    new RegExp(`${status}: \\"已结束\\"`),
    `标准搜客终态 ${status} 的任务卡必须统一显示已结束`
  );
}
const superSearchStatusContract = apiLayer.slice(
  apiLayer.indexOf("function superSearchStatusLabel"),
  apiLayer.indexOf("function superSearchThemeLabel")
);
for (const status of ["cancelled", "succeeded", "partial_success", "failed"]) {
  assert.match(
    superSearchStatusContract,
    new RegExp(`${status}: \\"已结束\\"`),
    `超级搜客终态 ${status} 的任务卡必须统一显示已结束`
  );
}
assert.match(apiLayer, /来源返回 \/ 候选池 \/ 待审核 \/ 审核通过/, "标准和超级搜客详情必须展示统一四段漏斗");
assert.match(apiLayer, /partial_success: "部分成功"/, "部分成功只能保留在任务详情验收结论中");
assert.match(apiLayer, /failed: "失败"/, "失败只能保留在任务详情验收结论中");
assert.equal(apiLayer.includes("部分完成"), false, "任务与来源状态不得使用容易误解的“部分完成”提示");
assert.match(
  apiLayer,
  /function leadFinderDisplayedProgress[\s\S]*isLeadFinderJobTerminal\(job\)[\s\S]*return Math\.min\(99, raw\)/,
  "未结束的搜客任务进度不得超过 99，避免看起来已经完成"
);
assert.match(
  apiLayer,
  /function renderDashboardProspectRuns[\s\S]*data-dashboard-prospect-open[\s\S]*尚未结束/,
  "工作台进行中的搜客必须使用真实任务并标明尚未结束"
);
assert.match(
  apiLayer,
  /data-dashboard-prospect-open[\s\S]*openLeadTaskDetail\(job\)/,
  "工作台进行中的搜客必须打开真实任务详情"
);
assert.match(apiLayer, /function localDateInputBoundary[\s\S]*new Date\(Number\(match\[1\]\), Number\(match\[2\]\) - 1, Number\(match\[3\]\)\)/, "加入时间必须按本地日期构造，不能把日期输入误解析为 UTC");
assert.match(apiLayer, /localDateInputBoundary\(state\.prospectJoinedTo, 1\)/, "自定义结束日期必须使用次日零点作为排他边界");
assert.match(apiLayer, /function syncLeadFinderLiveTransport[\s\S]*startLeadTaskEventStream/, "自动搜客主界面与详情必须共用实时任务传输入口");
assert.match(
  apiLayer,
  /function scheduleLeadTaskEventRefresh[\s\S]*leadFinderOpportunityRefreshPending = true[\s\S]*const refreshOpportunities = leadFinderOpportunityRefreshPending[\s\S]*if \(refreshOpportunities\) await refreshLeadFinderOpportunities\(\)/,
  "候选事件被合并时仍必须触发候选池和地图实时刷新"
);
assert.match(
  apiLayer,
  /function scheduleLeadTaskEventRefresh[\s\S]*event\.type === "candidate\.persisted"[\s\S]*job\.resultIds = \[\.\.\.new Set/,
  "候选落库事件必须立即并入当前任务，不能等待下一轮任务轮询"
);
assert.match(
  apiLayer,
  /async function refreshLeadFinderOpportunities[\s\S]*renderLeadFinderJobs\(\)[\s\S]*renderLeadTaskDetail\(\)/,
  "候选池刷新后必须重绘实时任务区和已打开的任务详情"
);
assert.match(apiLayer, /function leadFinderSourceWaitText[\s\S]*AI 模型正在生成候选/, "AI 来源等待时必须显示真实等待原因");
assert.match(apiLayer, /已有 \$\{candidateCount\} 个候选先展示/, "已有候选不得被未结束的来源阻塞展示");
assert.match(
  apiLayer,
  /\["running", "done", "partial", "failed"\]\.includes\(job\.status\)[\s\S]*Boolean\(job\.resultIds\?\.length\)[\s\S]*refreshLeadFinderOpportunities\(\)/,
  "运行中的搜客任务也必须刷新候选池，不能只在任务结束后刷新"
);
assert.match(apiLayer, /function applySuperSearchMission[\s\S]*const rounds = Array\.isArray\(mission\.rounds\)/, "超级搜索首屏缺少轮次快照时不能因 undefined 崩溃");
assert.match(apiLayer, /if \(result\.superSearch\) \{[\s\S]*applySuperSearchMission\(backendJob, result\.superSearch\)[\s\S]*超级搜索已进入队列，详细轮次正在同步/, "超级搜索快照增强失败时任务也必须先显示在队列");
assert.equal(apiLayer.includes("parseGoalToBrief"), false, "AI 解析失败后不得使用本地规则伪装成成功结果");
assert.match(apiLayer, /async function runLeadAiParse\(\): Promise<boolean>[\s\S]*catch \(err\)[\s\S]*clearLeadAiPreview\(true\)[\s\S]*未生成解析结果[\s\S]*return false;/, "AI 解析失败必须清空预览、明确报错并返回失败");
const leadFinderLaunchFlow = apiLayer.slice(
  apiLayer.indexOf("async function runLeadFinder"),
  apiLayer.indexOf("async function shortlistLeadFinderRows")
);
assert.ok(
  leadFinderLaunchFlow.indexOf("const parsed = await runLeadAiParse()") < leadFinderLaunchFlow.indexOf("launchProspectRunFromLeadFinder"),
  "直接输入自然语言后搜索时必须先完成 AI 解析，再创建搜索任务"
);
assert.match(leadFinderLaunchFlow, /const parsed = await runLeadAiParse\(\);[\s\S]*if \(!parsed\) return;/, "AI 解析失败时不得继续启动搜索");
const parsedLeadFinderInputFlow = apiLayer.slice(
  apiLayer.indexOf("async function launchProspectRunFromLeadFinder"),
  apiLayer.indexOf("async function runLeadFinder")
);
for (const selector of ["#leadAiProducts", "#leadAiMarkets", "#leadAiIndustries", "#leadAiExclusions", "#leadAiCustomerType", "#leadAiName"]) {
  assert.ok(parsedLeadFinderInputFlow.includes(selector), `启动搜索必须读取用户修改后的解析字段 ${selector}`);
}
assert.match(parsedLeadFinderInputFlow, /const resolved = resolveLeadAiSearchDraft\(/, "启动搜索必须通过无降级的解析结果校验器读取预览字段");
assert.equal(parsedLeadFinderInputFlow.includes("products = [goalInput]"), false, "启动搜索不得偷偷回退为原始中文句子");
assert.match(parsedLeadFinderInputFlow, /parsedName = resolved\.parsedName;[\s\S]*goalInput = "";/, "解析成功后原始自然语言不得继续作为隐藏搜索约束");
assert.match(parsedLeadFinderInputFlow, /const goal = \[[\s\S]*Products:[\s\S]*Markets:[\s\S]*Industries:[\s\S]*Customer type:[\s\S]*Exclusions:/, "活动搜索目标必须由当前解析预览字段重新生成");
assert.equal(parsedLeadFinderInputFlow.includes("icpRules: goalInput"), false, "修改解析结果后不得继续写入旧自然语言 ICP 规则");
assert.match(parsedLeadFinderInputFlow, /\/api\/lead-finder\/launch/, "自动搜客必须通过单次聚合请求创建并启动任务");
for (const legacyPath of ["/api/prospect-campaigns", "/api/prospect-strategies/"]) {
  assert.equal(parsedLeadFinderInputFlow.includes(legacyPath), false, `自动搜客启动不得继续串行调用 ${legacyPath}`);
}
assert.match(leadFinderLaunchFlow, /正在解析搜索目标[\s\S]*搜索已进入队列/, "创建按钮必须反馈真实的解析和入队阶段");
assert.match(
  leadFinderLaunchFlow,
  /if \(!sources\.length\) \{[\s\S]*超级搜索当前没有可执行的数据源/,
  "超级搜索来源二次过滤为空时必须在创建任务前阻断"
);
assert.match(parsedLeadFinderInputFlow, /onStage\?\.\("正在提交策略并启动搜索"\)/, "聚合启动请求必须反馈正在提交策略的真实阶段");
assert.deepEqual(resolveLeadAiSearchDraft({
  name: "Edited Mexico Filling Equipment",
  products: ["edited liquid filling machines"],
  markets: ["Mexico"],
  industries: ["coatings manufacturing"],
  exclusions: ["trading companies"],
  customerType: "终端工厂"
}), {
  parsedName: "Edited Mexico Filling Equipment",
  products: ["edited liquid filling machines"],
  markets: ["Mexico"],
  industries: ["coatings manufacturing"],
  exclusions: ["trading companies"],
  customerType: "终端工厂",
  marketOpen: false
}, "启动搜索必须完整采用用户修改后的 AI 解析字段");
assert.throws(() => resolveLeadAiSearchDraft({
  name: "",
  products: [],
  markets: ["China"],
  industries: [],
  exclusions: [],
  customerType: "*"
}), /产品关键词不能为空/, "修改后的必填搜索词为空时必须停止，不能降级");
assert.match(apiLayer, /const relations: ProspectRadarRelation\[\] = \(job\.deepMining\?\.edges \|\| \[\]\)\.map/, "演示模式关系线必须只读取深挖关系证据");
assert.match(apiLayer, /function syncProspectRadar[\s\S]*prospectRadarController\.update\(model\)/, "运行中的演示模式必须跟随真实任务事件增量更新");
assert.match(apiLayer, /id: "pool:ready"[\s\S]*等待首个候选/, "候选池为空时仍必须保留可打开的雷达待命帧");
assert.match(apiLayer, /data-lead-pool-radar[\s\S]*打开全球雷达/, "没有任务和候选时仍必须显示全球雷达入口");
assert.match(prospectRadar, /\.arcsData\(relationRows\)/, "3D 地球只能渲染模型提供的真实关系数据");
assert.match(prospectRadar, /\.htmlElementsData\(focusedPoint \? \[focusedPoint\] : \[\]\)/, "公司名称必须使用浏览器原生文字层以完整支持中文");
assert.match(prospectRadar, /function companyMarker[\s\S]*company\.textContent = item\.company/, "中文公司名称必须通过 textContent 安全渲染");
assert.equal(prospectRadar.includes(".labelText("), false, "公司名称不能继续使用缺少中文字形的 3D 纹理文字");
assert.match(prospectRadar, /function createCaptureFeed[\s\S]*role\", \"log\"[\s\S]*aria-live\", \"polite\"/, "回放必须提供可访问的实时企业捕获流");
assert.match(prospectRadar, /frame\.kind === \"candidate\" && focusedPoint[\s\S]*captureFeed\.addCandidate/, "捕获流只能从真实候选事件追加企业");
assert.match(prospectRadar, /function captureMilestone[\s\S]*count === 5[\s\S]*count === 10[\s\S]*count === 20/, "捕获流必须按真实企业数量插入阶段反馈");
assert.match(prospectRadar, /replay\(\)[\s\S]*captureFeed\.reset\(\)/, "重播必须清空旧捕获流后重新按事件打印");
assert.match(prototype, /\.prospect-radar-capture-list[\s\S]*mask-image: linear-gradient/, "捕获流顶部和底部必须渐隐，避免旧结果硬切消失");
assert.match(prospectRadar, /prefers-reduced-motion: reduce/, "演示模式必须支持低动态偏好");
assert.match(prospectRadar, /destroy\(\)[\s\S]*resizeObserver\.disconnect\(\)[\s\S]*globe\._destructor\(\)/, "关闭演示必须完整释放 WebGL 和尺寸监听器");
assert.match(apiLayer, /\["merged", "suppressed", "rejected"\]\.includes\(record\.outcome\)/, "清洗去除视图只能显示真实的归并、抑制与拒绝记录");
assert.match(apiLayer, /function leadFinderRemovedTotal[\s\S]*providerInvalidCount[\s\S]*providerDuplicateCount[\s\S]*rejectedCount[\s\S]*suppressedCount[\s\S]*mergedCount/, "清洗去除总数必须覆盖来源预处理与候选管线的全部分流结果");
assert.match(apiLayer, /data-lead-open-cleaning[\s\S]*leadFinderResultView = "cleaning"/, "候选结果必须提供可直达处理原因的入口");
assert.match(apiLayer, /PROVIDER_INVALID_RECORD[\s\S]*PROVIDER_DUPLICATE_RECORD[\s\S]*未保存无效或重复记录的公司名称/, "来源预处理原因必须如实按数量汇总，不能伪造公司名称");
assert.match(apiLayer, /source\.outcome === "timed_out"[\s\S]*Timed out/, "联系人来源超时必须在搜客清单明确显示");
assert.match(apiLayer, /Next step: \$\{escapeHtml\(source\.suggestion\)\}/, "联系人来源失败或未配置时必须展示调整建议");
assert.match(apiLayer, /waitedMs >= 130_000[\s\S]*响应超时[\s\S]*调整建议/, "自动搜索长时间无返回时必须展示超时原因和调整建议");
assert.match(prototype, /data-view="settings" data-scope="manager"/, "业务员导航中必须隐藏系统设置");
assert.match(prototype, /id="settings" data-scope="manager"/, "业务员视图中必须隐藏系统设置页面");
assert.match(prototype, /data-view="database-maintenance" data-scope="admin"/, "数据库维护导航必须只向管理员显示");
assert.match(prototype, /id="database-maintenance" data-scope="admin"/, "数据库维护必须使用独立页面");
assert.equal(prototype.includes("id=\"mysqlImportPanel\""), false, "数据库迁移不能继续嵌在账号管理页");
assert.match(apiLayer, /"database-maintenance": "database\.maintain"/, "数据库维护页面必须绑定数据库维护能力");
assert.match(apiLayer, /"member-management": "member\.read"/, "成员管理页面必须绑定成员查看能力");
assert.match(apiLayer, /"role-management": "role\.read"/, "角色管理页面必须绑定角色查看能力");
assert.match(apiLayer, /"ui-access": "role\.read"/, "界面开通页面必须绑定角色查看能力");
assert.match(prototype, /data-view="ui-access" title="界面开通"/, "权限管理导航必须提供界面开通入口");
assert.match(prototype, /id="ui-access" data-scope="admin" data-iam-page="ui"/, "界面开通必须使用独立权限页面");
assert.match(apiLayer, /interface AccessControlUiModule[\s\S]*edition: string/, "界面开通必须把界面模块和版本说明结构化");
assert.match(apiLayer, /function renderAccessControlUiAccess[\s\S]*界面会按角色权限自动出现[\s\S]*data-ac-module-enable[\s\S]*data-ac-module-disable/, "界面开通必须支持按角色查看并开通或关闭模块");
assert.match(apiLayer, /function mutateAccessControlModule/, "界面模块开通必须有独立的批量发布函数");
assert.match(apiLayer, /\/api\/v1\/roles\/\$\{encodeURIComponent\(role\.id\)\}\/permissions/, "界面模块开通必须复用角色权限发布接口");
assert.match(apiLayer, /开通界面模块：\$\{module\.name\}/, "界面模块开通必须留下审计原因");
assert.match(apiLayer, /introducedVersion\?: string/, "权限项必须携带引入版本，方便按界面版本解释权限");
assert.match(apiLayer, /连接中断，正在重连/, "数据库任务断流必须进入重连状态而非误报失败");
assert.match(apiLayer, /if \(!canAccessWorkspaceView\(view\)\) \{[\s\S]*view = platformOperator \? "platform-operations" : "dashboard";/, "页面切换必须阻止越权访问，并按账号身份回到正确首页");
assert.match(apiLayer, /workspaceView: "gj_workspace_view"/, "工作区必须记录当前活动模块，避免刷新后退回主页");
assert.match(apiLayer, /sessionStorage\.setItem\(workspaceViewStorageKey\(\), view\)/, "导航切换必须按当前账号记住活动模块");
assert.match(apiLayer, /restoreSession\(\)[\s\S]*activateNavView\(state\.iamCapabilities\?\.source === "platform" \? "platform-operations" : rememberedWorkspaceView\(user\)\)/, "会话恢复后必须按身份回到刷新前的模块");
assert.match(apiLayer, /selectedDailyReportId = message\.relatedId;[\s\S]*activateNavView\("daily-reports"\)/);
assert.match(apiLayer, /if \(view === "ai-agent"\) \{[\s\S]*renderAgent\(state\.agentRun\);[\s\S]*void loadAgentRuns\(\);[\s\S]*\}/, "进入 Agent 页面必须刷新蒸馏打法与后台任务状态");
assert.match(apiLayer, /void loadAgentKnowledge\(false\)/, "进入 Agent 页面必须加载系统知识状态");
assert.match(prototype, /\.agent-chat-bubble,[\s\S]*\.agent-chat-answer > p[\s\S]*user-select: text;/, "Agent 对话正文必须允许选择复制");
assert.match(apiLayer, /copyableText \|\| window\.getSelection\(\)\?\.toString\(\)\.trim\(\)/, "选择 Agent 对话文字时不得触发整轮重新渲染");
assert.match(apiLayer, /agentPendingProgress\.push\(progress\)/, "Agent 规划流必须保留同阶段的细粒度动作，不能互相覆盖");
assert.match(apiLayer, /权限校验未通过：[\s\S]*接口参数或契约校验失败：[\s\S]*网络或上游服务调用失败：/, "Agent 失败链必须给出可读诊断");
assert.equal(productConfig.productName, "Keduoduo CRM");
assert.match(productConfig.version || "", /^\d+\.\d+(?:\.\d+)?$/);

assert.equal(isLeadSourceExecutable({ id: "ready", ready: true, enabled: true, accessMode: "api" }), true);
assert.equal(isLeadSourceExecutable({ id: "disabled", ready: true, enabled: false, accessMode: "api" }), false);
assert.equal(isLeadSourceExecutable({ id: "manual", ready: true, enabled: true, accessMode: "manual_assisted" }), false);
assert.equal(
  isLeadSourceAutoSelected({ id: "free", tier: "free", ready: true, enabled: true, accessMode: "api", recommended: true }),
  false
);
assert.equal(
  isLeadSourceAutoSelected({ id: "byok-free", tier: "byok_free", ready: true, enabled: true, accessMode: "api", recommended: true }),
  false
);
assert.equal(
  isLeadSourceAutoSelected({ id: "serper", tier: "byok_free", category: "web", capabilities: ["web"], hasApiKey: true, ready: true, enabled: true, accessMode: "api" }),
  true,
  "已配置的搜索 API 必须自动进入默认来源，不能被 AI 搜索绑架"
);
assert.equal(
  isLeadSourceAutoSelected({ id: "paid", tier: "paid", ready: true, enabled: true, accessMode: "api", recommended: true }),
  true
);
assert.deepEqual(
  resolveLeadSearchSources([
    { id: "ai_search", ready: true, enabled: true, accessMode: "api" },
    { id: "gleif", ready: true, enabled: true, accessMode: "api", recommended: true },
    { id: "wikidata", ready: true, enabled: false, accessMode: "api", recommended: true }
  ], [], false),
  { sources: ["ai_search", "gleif"], blocked: [], requiresSelection: false }
);
assert.deepEqual(
  resolveLeadSearchSources([
    { id: "free", tier: "free", ready: true, enabled: true, accessMode: "api", recommended: true },
    { id: "byok-free", tier: "byok_free", ready: true, enabled: true, accessMode: "api", recommended: true },
    { id: "serper", tier: "byok_free", category: "web", capabilities: ["web"], hasApiKey: true, ready: true, enabled: true, accessMode: "api", recommended: false },
    { id: "paid", tier: "paid", ready: true, enabled: true, accessMode: "api", recommended: true }
  ], [], false),
  { sources: ["serper", "paid"], blocked: [], requiresSelection: false }
);
assert.deepEqual(
  resolveLeadSearchSources([
    { id: "ai_search", ready: false, enabled: false, accessMode: "api" },
    { id: "gleif", ready: true, enabled: true, accessMode: "api", recommended: true }
  ], ["ai_search"], true),
  {
    sources: [],
    blocked: [{ id: "ai_search", reason: "not_ready" }],
    requiresSelection: false
  }
);
assert.deepEqual(
  resolveLeadSearchSources([
    { id: "serper", ready: true, enabled: false, accessMode: "api" },
    { id: "gleif", ready: true, enabled: true, accessMode: "api", recommended: true }
  ], ["serper"], true),
  {
    sources: [],
    blocked: [{ id: "serper", reason: "disabled" }],
    requiresSelection: false
  }
);
assert.deepEqual(
  resolveLeadSearchSources([{ id: "gleif", ready: true, enabled: true, accessMode: "api", recommended: true }], [], true),
  { sources: [], blocked: [], requiresSelection: true }
);
assert.deepEqual(
  resolveLeadSearchSources([
    { id: "importyeti", ready: true, enabled: true, accessMode: "manual_assisted" }
  ], ["importyeti"], true),
  {
    sources: [],
    blocked: [{ id: "importyeti", reason: "not_executable" }],
    requiresSelection: false
  }
);

if (!prototype.includes(".report-hero") || !prototype.includes(".ocr-workbench") || !prototype.includes(".account-grid")) {
  throw new Error("missing high fidelity prototype styles");
}

assert.equal(prototype.includes("collab-inbox-nav"), false, "message center must not remain in sidebar navigation");
assert.match(prototype, /class="lead-settings-summary"/, "来源与执行设置必须有醒目的标题样式");
assert.match(prototype, /免费源效果可能不佳，默认不勾选/, "来源设置必须提示免费源默认不勾选及质量风险");
assert.match(prototype, /lead-settings-summary::before/, "来源设置必须显示可展开的箭头 affordance");
assert.match(prototype, /content: "展开"/, "来源设置必须显示展开状态提示");
assert.match(apiLayer, /function renderLeadSourceChips[\s\S]*更多免费来源（效果可能不佳，默认不勾选）/, "免费来源必须集中展示并带质量提示");
assert.equal(prototype.includes("id=\"composeMessageButton\""), false, "notification center must not present direct-message composition as its primary workflow");
assert.match(apiLayer, /data-pending-hit-id/, "待清洗结果必须支持逐条选择");
assert.match(apiLayer, /selectedPendingHitIds/, "待清洗导入必须保留明确选择状态");
assert.match(apiLayer, /prospect-super-search\/\$\{encodeURIComponent\(job\.superSearchMissionId\)\}\/pending-candidates/, "超级搜索必须汇总全部轮次待清洗结果");
assert.match(apiLayer, /body: JSON\.stringify\(\{ hitIds \}\)/, "手动导入只能提交已选择的原始记录");
assert.equal(apiLayer.includes("lead-job-card is-openable"), false, "任务卡片不能整卡点击进入详情");
assert.equal(apiLayer.includes("同步本任务结果"), false, "任务结果操作必须使用明确的候选与线索语义");
assert.match(apiLayer, /data-lead-job-open[\s\S]*查看详情/, "只有查看详情按钮可以进入任务详情页");
const customerSectionIndex = prototype.indexOf('aria-label="客户管理"');
const customerOpenNavIndex = prototype.indexOf('data-view="customers" data-customer-outcome="open" title="未成交客户"');
const customerWonNavIndex = prototype.indexOf('data-view="customers" data-customer-outcome="won" title="已成交客户"');
const customerPoolNavIndex = prototype.indexOf('data-view="customer-pool" title="客户公池"');
assert.ok(customerSectionIndex >= 0 && customerSectionIndex < customerOpenNavIndex && customerOpenNavIndex < customerWonNavIndex && customerWonNavIndex < customerPoolNavIndex, "customers and customer pool must share one navigation group");
assert.match(prototype, /id="customerPageTitle">未成交客户/, "customer page must expose the default outcome context");
assert.match(apiLayer, /customerOutcomeFilter: "open" \| "won"/, "customer outcome filter must be explicit in app state");
assert.match(apiLayer, /state\.customerOutcomeFilter === "won" \? customer\.hasWonDeal === true : customer\.hasWonDeal !== true/, "customer navigation must filter won and open customers from real data");
assert.match(apiLayer, /if \(view === "customers"\) \{\s*renderCustomers\(state\.customers\);\s*\}/, "switching customer outcome navigation must redraw the shared customer page");
assert.match(apiLayer, /\["成交状态", "客户状态", "状态", "Lifecycle Status", "lifecycleStatus"\]/, "customer import must accept an explicit lifecycle status");
assert.match(apiLayer, /成交状态: customer\.hasWonDeal \? "已成交" : "未成交"/, "customer export must preserve lifecycle status");
assert.doesNotMatch(apiLayer, /由关联商机自动判断/, "customer status must not be described as a live deal-derived value");
assert.match(apiLayer, /customer\.wonDealCount \? `已成交 \$\{customer\.wonDealCount\} 次` : "已成交客户"/, "imported won customers without deals must not invent a transaction count");
assert.doesNotMatch(apiLayer, /wonDealCount \|\| 1/, "customer UI must not fabricate one won deal for imported customers");
assert.match(apiLayer, /class="deal-items-list" id="dealItemsList"/, "deal editor must support multiple product rows");
assert.match(apiLayer, /items\.reduce\(\(sum, item\) => sum \+ item\.quantity \* item\.unitPrice/, "deal amount must be calculated from all product rows");
assert.match(apiLayer, /items: documentItems/, "PI and CI generation must carry every deal product row");
assert.match(prototype, /id="instantCommunicationState"/, "即刻沟通必须有明确的服务加载状态");
assert.match(apiLayer, /function ensureInstantCommunicationLoaded/, "即刻沟通必须在进入页面时检查服务状态");
assert.match(apiLayer, /联系方式备注 \/ 其它渠道/, "客户表单必须支持登记其它渠道联系方式");
assert.match(apiLayer, /contactRemark/, "客户联系方式备注必须进入前端数据链路");
assert.match(apiLayer, /closeOnBackdrop: false/, "客户新增弹窗点击背景不能自动关闭");
assert.match(apiLayer, /let modalCloseOnBackdrop = false;/, "通用居中弹窗必须默认禁止点击背景关闭");
assert.match(apiLayer, /modalCloseOnBackdrop = options\.closeOnBackdrop \?\? false;/, "未显式配置时不得允许背景点击关闭弹窗");
assert.doesNotMatch(apiLayer, /#productModal[\s\S]{0,160}event\.target ===/, "产品编辑弹窗点击背景不得关闭");
assert.doesNotMatch(apiLayer, /#shipmentModal[\s\S]{0,160}event\.target ===/, "发货单编辑弹窗点击背景不得关闭");
assert.match(apiLayer, /联系方式备注（其它渠道）/, "客户导入导出必须包含联系方式备注列");
assert.match(apiLayer, /id="customerSourceInput"/, "客户新增编辑表单必须支持登记客户来源");
assert.match(apiLayer, /客户来源: customer\.source/, "客户导出必须包含客户来源");
assert.match(apiLayer, /\["客户来源", "来源", "获客渠道"/, "客户导入必须识别客户来源列及常用别名");
assert.match(prototype, /<th>客户来源<\/th>/, "客户列表必须使用客户来源替换健康度列");
assert.match(apiLayer, /<span>客户来源<\/span><b>\$\{escapeHtml\(current\.source/, "客户全景必须展示客户来源");
assert.match(apiLayer, /<span>客户来源<\/span><b>\$\{escapeHtml\(customer\.source/, "客户侧边详情必须展示客户来源");
assert.match(apiLayer, /customerFullNameInput|customerCompanyFullNameInput/, "客户表单必须支持公司全名");
assert.match(apiLayer, /客户ID: customer\.id/, "客户导出必须包含稳定客户 ID");
assert.doesNotMatch(apiLayer, /· ID \$\{escapeHtml\(customer(?:\?|\.)\.id/, "客户和商机日常界面不得显示内置客户 ID");
assert.doesNotMatch(apiLayer, /客户编号 \$\{escapeHtml\(current\.id\)/, "客户全景不得显示内置客户编号");
assert.doesNotMatch(apiLayer, /<label>客户 ID<\/label>/, "客户编辑弹窗不得显示系统主键");
assert.match(apiLayer, /公司简称: customer\.company/, "客户导出必须区分客户简称");
assert.match(apiLayer, /customerDocumentName\(customer\)/, "单据生成必须优先使用公司全名");
assert.match(prototype, /公司全名/, "客户界面必须提供公司全名字段");
assert.equal(prototype.includes("topReminderCount"), false, "全局顶部栏不应继续显示提醒计数");
assert.equal(prototype.includes("主库 <b>MySQL<\/b>"), false, "全局顶部栏不应显示数据库实现信息");
assert.equal(prototype.includes("topImportButton"), false, "客户导入不能继续占用全局顶部栏");
assert.equal(prototype.includes("topExportButton"), false, "客户导出不能继续占用全局顶部栏");
assert.match(prototype, /class="customer-head-actions"[\s\S]*id="customerImportButton"[\s\S]*id="customerExportButton"/, "客户导入导出必须位于客户页右上角");
assert.match(prototype, /id="customerPagination"[\s\S]*id="customerPageSize"[\s\S]*id="customerPrevPage"[\s\S]*id="customerNextPage"/, "客户列表必须保留分页和每页数量控制");
assert.match(apiLayer, /function customerPageRows[\s\S]*customers\.slice\(start, start \+ state\.customerPageSize\)/, "客户列表必须只渲染当前页数据");
assert.match(apiLayer, /state\.customerPage = Math\.min\(Math\.max\(1, state\.customerPage\), pageCount\)/, "客户数据减少后必须自动校正页码");
assert.match(apiLayer, /customerSearchInput[\s\S]*state\.customerPage = 1[\s\S]*customerQueueFilter[\s\S]*state\.customerPage = 1/, "客户搜索和队列筛选必须回到第一页");
assert.match(prototype, /id="agentSkillsGrid"/, "Skill 管理必须使用卡片目录");
assert.match(prototype, /class="integration-launcher"/, "集成中心必须使用卡片入口页");
assert.equal((prototype.match(/data-integration-launch-tab=/gu) || []).length, 10, "集成中心必须保留全部十个功能入口");
assert.match(prototype, /class="integration-tabs"[^>]*hidden/, "集成中心旧横向标签必须保持隐藏");
assert.doesNotMatch(prototype, /Stage 6/, "集成中心不得显示内部开发阶段字样");
assert.match(integrationCenter, /data-integration-home/, "每个集成工作区必须提供返回入口");
assert.match(integrationCenter, /showHome\(\)/, "集成中心首次进入必须显示卡片入口页");
assert.match(prototype, /id="agentSkillsCategoryFilter"/, "Skill 管理必须支持分类筛选");
assert.match(prototype, /id="agentSkillsStatusFilter"/, "Skill 管理必须支持状态筛选");
assert.match(prototype, /id="agentSkillsSourceFilter"/, "Skill 管理必须支持获取方式筛选");
assert.match(prototype, /id="agentSkillDrawerBackdrop"/, "Skill 详情必须有独立抽屉");
assert.match(apiLayer, /skill\.acquisitionInstructions/, "Skill 搜索与详情必须覆盖获取说明");
assert.match(apiLayer, /function isHttpsUrl/, "Skill 外部链接必须进行 HTTPS 二次校验");
assert.match(apiLayer, /data-agent-skill-copy/, "Skill 提取码、链接和安装命令必须支持复制");
assert.doesNotMatch(apiLayer, /exec\(skill\.installCommand|eval\(skill\.installCommand/, "Skill 安装命令只能展示和复制，不能在浏览器执行");
assert.match(prototype, /id="agentSkillAddButton"/, "Skill 资源中心必须提供权限控制的上架入口");
assert.match(apiLayer, /skillResourceTraining/, "Skill 资源必须支持训练教程维护");
assert.match(apiLayer, /skillResourceOptimization/, "Skill 资源必须支持优化方向维护");
assert.match(apiLayer, /\/api\/agent\/skill-resources/, "Skill 资源必须通过持久化 API 管理");
assert.match(apiLayer, /accessSkillResource/, "Skill 下载必须通过受控访问接口获取链接");
assert.match(apiLayer, /type DevelopmentEmailScenario = "first_touch" \| "daily_contact" \| "holiday_greeting" \| "new_product" \| "custom_goal"/, "开发信必须提供五种明确写作场景");
assert.match(apiLayer, /正在加载开发信工作区/, "开发信进入时必须表达为加载工作区而非自动生成");
assert.doesNotMatch(apiLayer, /正在生成开发信/, "开发信进入时不得暗示已自动调用 AI");
assert.match(apiLayer, /scenario: developmentEmailScenario,[\s\S]*goal: developmentEmailGoal,[\s\S]*requireAi/, "开发信 AI 请求必须携带场景、自然语言目标和明确生成开关");
assert.match(apiLayer, /developmentEmailScenario === "custom_goal" && !developmentEmailGoal/, "自然语言目标场景调用 AI 前必须校验目标");
assert.match(apiLayer, /activateNavView\("development-email", \(\) => void generateDevelopmentEmailDraftPage\(\)\)/, "进入开发信页面只能加载基础模板");
assert.match(apiLayer, /return state\.user\?\.theme \|\| getStoredTheme\(\) \|\| THEME_DEFAULT;/, "系统无已保存主题时必须回落到系统默认主题（晨白 Paper）");
assert.match(apiLayer, /templateStyle: profile\?\.templateStyle \|\| "rose" as const/, "新建单据必须默认使用团队玫红主题");
assert.match(apiLayer, /document\.type === "PI" && document\.templateStyle === "longtec"/, "PI 必须支持 Longtec 专用模板预览");
assert.match(prototype, /id="docTemplateInput">[\s\S]*value="longtec"/, "单据编辑器必须提供 Longtec 可选模板");
assert.match(prototype, /id="docThemeInput">[\s\S]*value="longtec"/, "单据主题选择必须同步提供 Longtec");
assert.match(prototype, /id="documentDefaultTemplateStyle"><option value="rose">Rose<\/option>/, "单据默认配置必须优先显示玫红主题");
assert.match(prototype, /id="documentSellerProfilesList"/, "单据默认配置必须展示全部卖方公司档案");
assert.match(prototype, /id="documentSellerProfilesManage"/, "管理员必须能从默认配置进入卖方公司管理");
assert.match(prototype, /id="docSellerProfileInput"/, "单据编辑器必须允许人工切换卖方公司");
assert.match(prototype, /id="docBrandMarkTextInput"[^>]*maxlength="8"/, "单据编辑器必须允许单据级配置左上色块文字");
assert.match(prototype, /id="documentDefaultBrandMarkText"[^>]*maxlength="8"/, "团队单据默认配置必须支持色块文字");
assert.match(prototype, /id="docShippingCostInput"[^>]*type="number"/, "单据编辑器必须提供可选的运费输入");
assert.match(apiLayer, /lineType: "shipping_cost"/, "填写运费后必须生成独立的 shipping_cost 明细");
assert.match(apiLayer, /items = items\.filter\(\(item\) => item\.lineType !== "shipping_cost"\)/, "运费明细不能重复出现在产品编辑行中");
assert.match(apiLayer, /function matchedSellerProfile[\s\S]*sellerProfileMatchScore/, "新建单据必须通过统一规则自动匹配卖方公司");
assert.match(apiLayer, /function renderSellerProfilesInDefaults/, "默认配置必须渲染卖方公司及其匹配规则");
assert.match(apiLayer, /letterheadId: qs<HTMLSelectElement>\("#docSellerProfileInput"\)/, "单据保存必须持久化人工选择的卖方公司");
assert.match(apiLayer, /applyDocumentCustomerDefaults[\s\S]*applyMatchedSellerToEditor/, "客户或商机变化后必须重新匹配卖方公司");
assert.match(apiLayer, /function applyFallbackSellerToEditor/, "人工切回或规则未命中时必须真正恢复兜底卖方资料");
assert.match(apiLayer, /brandMarkText: documentDefaultValue\("documentDefaultBrandMarkText"\)/, "团队色块文字必须通过默认配置 API 持久化");
assert.match(apiLayer, /brandMarkText: qs<HTMLInputElement>\("#docBrandMarkTextInput"\)/, "单据级色块文字必须随单据保存");
assert.match(prototype, /id="leadFinderLfindButton"[\s\S]*Lfind 深入查询/, "自动获客页必须提供 Lfind 深入查询入口");
assert.match(prototype, /id="leadFinderLfindInlineButton"[\s\S]*Lfind 深入查询/, "来源与执行设置中必须提供 Lfind 深入查询入口");
assert.match(apiLayer, /\/api\/lead-finder\/lfind-tasks/, "前端必须通过 Lfind 任务接口启动和轮询本地 Skill");
assert.match(apiLayer, /function runLfindLeadSearch/, "前端必须有独立的 Lfind 启动流程");
assert.match(apiLayer, /syncLfindTaskPolling/, "Lfind 必须异步轮询任务并同步结果");
assert.match(apiLayer, /searchReport/, "搜客候选必须接收每行搜索报告");
assert.match(apiLayer, /renderLeadSearchReportCell/, "自动搜客表格必须展示每行搜索报告摘要");
assert.match(apiLayer, /renderLeadSearchReportPanel/, "候选详情必须展示完整搜索报告和验证来源");
const primaryNav = prototype.slice(
  prototype.indexOf('<div class="nav-primary"'),
  prototype.indexOf('<details class="nav-section" aria-label="客户管理"')
);
assert.match(primaryNav, /data-view="dashboard"[\s\S]*data-view="lead-finder"[\s\S]*data-view="prospect-list"[\s\S]*data-view="whatsapp"[\s\S]*data-view="development-email"/, "主导航必须把获客、客户沟通和开发信放在前面");
assert.doesNotMatch(primaryNav, /data-view="phone-workspace"/, "话机工作台不得留在主导航第一组");
assert.match(prototype, /aria-label="话机（可选）"[\s\S]*data-view="phone-workspace"[\s\S]*data-view="phone-config"/, "话机入口必须保留在可选分组");
assert.match(apiLayer, /id="prospectDraftEmailButton"/, "可联系候选必须能打开开发信草稿");
assert.match(apiLayer, /function prospectOutreachDraftPrefill/, "开发信草稿必须按候选已知资料预填");
assert.match(apiLayer, /applyProspectOutreachDraftPrefill\(item\)/, "写开发信必须把预填写进草稿区");
assert.match(apiLayer, /未编造缺失项/, "缺字段时必须提示缺什么");
assert.match(prototype, /id="prospectMailGaps"/, "搜客清单草稿区必须能显示缺字段");
assert.match(prototype, /id="prospectMailGapActions"/, "缺项提示旁必须能放补齐按钮");
assert.match(prototype, /id="prospectMailGapEditor"/, "缺项补齐必须在草稿区展开候选资料");
assert.match(apiLayer, /去补邮箱/, "缺邮箱时必须有去补邮箱");
assert.match(apiLayer, /去补联系人/, "缺有效联系人时必须有去补联系人");
assert.match(apiLayer, /去补公司名/, "缺公司名时必须有去补公司名");
assert.match(apiLayer, /保存并重新预填/, "补齐后必须能保存并重新预填同一份草稿");
const gapSaveStart = apiLayer.indexOf("async function saveProspectDraftGaps");
const gapSaveEnd = apiLayer.indexOf("function applyProspectOutreachDraftPrefill", gapSaveStart);
const gapSave = gapSaveStart >= 0 && gapSaveEnd > gapSaveStart ? apiLayer.slice(gapSaveStart, gapSaveEnd) : "";
assert.match(gapSave, /\/api\/prospect-list\/\$\{encodeURIComponent\(current\.id\)\}\/details/, "缺项补齐必须写回这条候选的资料");
assert.match(gapSave, /returnToProspectOutreachDraft\(upsertWebsiteOpportunity\(current\)\)/, "保存后必须把补齐结果写回这条候选并回到同一份草稿");
assert.match(gapSave, /系统不会编造/, "不合格邮箱不得落成假资料");
assert.match(gapSave, /空着的项不会写成假数据/, "空字段不得在补齐时写成假资料");
assert.doesNotMatch(gapSave, /send-development-email|sendProspectDevelopmentEmail/, "缺项补齐不得发送开发信");
assert.match(apiLayer.slice(apiLayer.indexOf("function returnToProspectOutreachDraft"), apiLayer.indexOf("async function saveProspectDraftGaps")), /applyProspectOutreachDraftPrefill\(current\)/, "回到草稿时必须按已有规则重算预填");
assert.match(apiLayer, /id="leadFinderWriteEmailButton"[\s\S]*写开发信/, "可联系的获客结果必须有写开发信入口");
assert.match(apiLayer, /openProspectDraftFromAcquisition\(item\)/, "获客结果里的写开发信必须打开同一份预填草稿");
assert.match(apiLayer, /function prospectNeedsDevelopmentEmail[\s\S]*status !== "contactable"[\s\S]*lastDevelopmentEmailAt[\s\S]*prospectQueueEmail/, "待写开发信只包含可联系、有邮箱、尚未发出的候选");
assert.match(apiLayer, /PENDING_DEVELOPMENT_EMAIL_LIMIT = 8/, "工作台待写开发信最多显示 8 行");
assert.match(apiLayer, /没有可写开发信的候选。去智能获客或搜客清单，补齐可联系状态和邮箱后再回来。这里不会编造名单。/, "没有可写对象时必须指向获客和搜客清单，不能编造名单");
assert.match(prototype, /id="dashboardPendingEmails"[\s\S]*待写开发信/, "工作台必须有待写开发信区块");
assert.match(apiLayer, /data-dashboard-pending-email[\s\S]*有邮箱/, "待写开发信每一行必须带公司、状态和邮箱有无");
assert.match(apiLayer, /prospectNeedsDevelopmentEmail\(item\) \? badge\("可写开发信"/, "搜客清单里符合条件的候选要标可写开发信");
assert.match(apiLayer, /lastDevelopmentEmailAt \? badge\("已发开发信", "green"\)/, "搜客清单已发候选要标已发开发信");
const pendingEmailClickStart = apiLayer.indexOf('qs<HTMLElement>("#dashboardPendingEmails")?.addEventListener');
const pendingEmailClick = apiLayer.slice(pendingEmailClickStart, pendingEmailClickStart + 520);
assert.match(pendingEmailClick, /openProspectDraftFromAcquisition\(item\)/, "点待写开发信必须打开现有草稿流");
assert.doesNotMatch(pendingEmailClick, /sendProspectDevelopmentEmail|send-development-email/, "点待写开发信不得发送");
assert.match(apiLayer, /RECENT_OUTREACH_LIMIT = 5/, "工作台最近触达最多显示 5 行");
const recentCandidates = kbSourceBetween(apiLayer, "function recentOutreachCandidates()", "\nfunction renderDashboardRecentOutreach");
assert.match(recentCandidates, /shortlistedAt[\s\S]*lastDevelopmentEmailAt/, "最近触达只包含搜客清单里已经发出开发信的候选");
assert.match(apiLayer, /还没有已发开发信。去待写开发信或搜客清单写一封，确认发送后才会出现在这里。这里不会编造记录。/, "没有已发记录时必须指向待写和搜客清单，不能编造记录");
assert.match(prototype, /id="dashboardRecentOutreach"[\s\S]*最近触达/, "工作台必须有最近触达区块");
assert.match(apiLayer, /data-dashboard-recent-outreach[\s\S]*已发开发信/, "最近触达每一行必须标已发开发信");
const recentClickStart = apiLayer.indexOf('qs<HTMLElement>("#dashboardRecentOutreach")?.addEventListener');
const recentClick = apiLayer.slice(recentClickStart, recentClickStart + 640);
assert.match(recentClick, /openSentProspectFromDashboard\(item\)/, "点最近触达必须打开已发候选");
assert.doesNotMatch(recentClick, /sendProspectDevelopmentEmail|send-development-email|openProspectDraftFromAcquisition|openProspectOutreachDraft/, "点最近触达不得发送或打开待写草稿");
const openSent = kbSourceBetween(apiLayer, "function openSentProspectFromDashboard", "\nfunction renderProspectDetail");
assert.match(openSent, /workspace\.open = false/, "打开已发记录时草稿区必须收起");
assert.match(openSent, /不会再次发送/, "打开已发记录时必须说明不会再次发送");
assert.doesNotMatch(openSent, /sendProspectDevelopmentEmail|send-development-email|openProspectOutreachDraft/, "打开已发记录不得发送");
const sendProspectMail = kbSourceBetween(apiLayer, "async function sendProspectDevelopmentEmail", "\nfunction currentLeadFinderTitle");
assert.match(sendProspectMail, /Object\.assign\(existing, result\.opportunity\)[\s\S]*renderProspectList\(\)/, "发送成功后必须用返回的候选刷新清单");
const prospectListRender = kbSourceBetween(apiLayer, "function renderProspectList()", "\nfunction prospectsAsSyncRows");
assert.match(prospectListRender, /renderDashboardPendingEmails\(\)[\s\S]*renderDashboardRecentOutreach\(\)/, "清单刷新必须同时更新待写队列和最近触达");
assert.doesNotMatch(apiLayer, /international sourcing and distribution/, "预填不能把空业务编成泛泛的采购场景");
assert.match(apiLayer, /sendProspectDevelopmentEmail[\s\S]*confirmAction\(/, "搜客清单发送开发信必须经过确认");
assert.match(apiLayer, /先选定收件对象/, "未选对象时开发信页必须给出获客入口，而不是空白");
assert.match(apiLayer, /不会自动发送/, "从候选打开 WhatsApp 不得表述成自动发送");
assert.match(apiLayer, /function prospectConvertGate/, "搜客清单必须能判断转线索资格");
assert.match(apiLayer, /function convertProspectsToLeads[\s\S]*confirmAction\(/, "转为线索必须先确认");
assert.match(apiLayer, /\/api\/prospects\/\$\{encodeURIComponent\(entry\.gate\.prospectId\)\}\/convert-to-lead/, "确认后必须走现有转线索接口");
assert.match(apiLayer, /operationCode: "convert_prospect_to_lead_v1"/, "转线索请求必须使用现有操作码");
assert.match(apiLayer, /Idempotency-Key/, "转线索请求必须带幂等键");
assert.match(apiLayer, /不会重复转入/, "已是线索时必须写明不再转入");
assert.match(apiLayer, /未达门禁/, "不满足时必须标明未达门禁");
assert.match(apiLayer, /id="prospectConvertOpenLead"/, "转入成功后必须能跳到线索");
assert.doesNotMatch(apiLayer, /sync-opportunities/, "转为线索不能再走绕过可联系门禁的同步接口");
const approvalPending = kbSourceBetween(apiLayer, "function prospectContactableApprovalPending", "\nfunction contactableApprovalButton");
assert.match(approvalPending, /gate\.ready/, "已可转线索时不得出现可联系批准入口");
assert.match(approvalPending, /state !== "blocked"/, "已是线索或未阻断时不得出现可联系批准入口");
assert.match(approvalPending, /人工可联系批准/, "入口只认人工可联系批准这句缺项");
assert.match(approvalPending, /ownerId !== state\.user/, "不是当前业务员时不显示可联系批准入口");
assert.match(apiLayer, /function contactableApprovalButton[\s\S]{0,240}去申请可联系批准/, "入口文案必须是去申请可联系批准");
assert.match(apiLayer, /prospectContactableApprovalPending\(item, gate\)[\s\S]{0,180}contactableApprovalButton/, "清单行只在缺人工可联系批准时给出入口");
assert.match(apiLayer, /renderProspectConvertGate\(item, "prospectDetailSyncButton"\)\}[\s\S]{0,80}renderContactableApprovalPanel\(item, "prospect"\)/, "搜客清单详情必须能展开现有资格检查");
assert.match(apiLayer, /renderProspectConvertGate\(item, "leadFinderDetailConvertButton"\)\}[\s\S]{0,80}renderContactableApprovalPanel\(item, "lead-finder"\)/, "候选详情必须能展开现有资格检查");
const openApproval = kbSourceBetween(apiLayer, "async function openContactableApproval", "\nfunction bindContactableApprovalEntries");
assert.match(openApproval, /loadProspectQualification/, "入口必须打开现有资格检查");
assert.match(openApproval, /prospectContactableApprovalSurface = "prospect"/, "已在搜客清单的候选要落到清单详情");
assert.doesNotMatch(openApproval, /convert-to-lead|mutateProspectQualification|\/approve|contactability\//, "入口不得代为批准或转线索");
const holdNotice = kbSourceBetween(apiLayer, "function prospectComplianceReasonText", "\nfunction prospectQualificationResult");
assert.match(holdNotice, /原因未回传/, "没有原因时必须写原因未回传");
assert.match(holdNotice, /data-hold-kind/, "抑制说明必须带状态种类");
assert.match(holdNotice, /来源：/, "已有来源时要显示来源");
assert.doesNotMatch(holdNotice, /<button|解除抑制|一键解除|unsuppress/, "抑制说明必须只读，不能提供解除");
assert.match(prospectListRender, /renderProspectComplianceNotices\(item\)/, "搜客清单行必须展示抑制、退订或退信原因");
assert.match(apiLayer, /prospect-detail-hero[\s\S]{0,1200}renderProspectComplianceNotices\(item\)/, "搜客清单详情必须展示同一份原因");
assert.match(apiLayer, /lead-verification-drawer-head[\s\S]{0,900}renderProspectComplianceNotices\(item\)/, "候选详情必须展示同一份原因");
assert.match(prototype, /\.prospect-hold-notice/, "原因条必须有可见样式");
const followWritable = kbSourceBetween(apiLayer, "function prospectFollowUpWritable", "\nfunction renderProspectFollowUpSummary");
assert.match(followWritable, /status === "excluded"/, "已排除的候选不开放跟进写入");
assert.match(followWritable, /ownerId !== state\.user/, "不是当前业务员时不开放跟进写入");
assert.match(followWritable, /contactable/, "可联系候选可以记跟进");
assert.match(followWritable, /contacted/, "已联系候选可以记跟进");
assert.match(followWritable, /synced/, "已转入线索的候选可以记跟进");
assert.match(followWritable, /gate\.ready/, "已有人工可联系批准时可以记跟进");
assert.match(apiLayer, /function renderProspectFollowUpSummary[\s\S]{0,500}暂无跟进/, "没有跟进时必须写暂无跟进");
assert.match(apiLayer, /data-follow-up="latest"/, "有跟进时必须展示最近一条");
assert.match(prospectListRender, /renderProspectFollowUpSummary\(item\)/, "搜客清单行必须展示最近跟进");
assert.match(apiLayer, /renderContactableApprovalPanel\(item, "prospect"\)\}[\s\S]{0,120}renderProspectFollowUpEntry\(item, "prospect"\)/, "搜客清单详情必须能记跟进");
assert.match(apiLayer, /renderContactableApprovalPanel\(item, "lead-finder"\)\}[\s\S]{0,120}renderProspectFollowUpEntry\(item, "lead-finder"\)/, "候选详情必须能记跟进");
const followEntry = kbSourceBetween(apiLayer, "function renderProspectFollowUpEntry", "\nfunction focusProspectFollowUpInput");
assert.match(followEntry, /记录跟进/, "写入按钮文案必须是记录跟进");
assert.match(followEntry, /保存下次跟进/, "详情必须能单独改下次跟进");
assert.match(followEntry, /datetime-local/, "下次跟进使用日期时间");
assert.match(followEntry, /不会发送开发信，也不会转为线索/, "跟进说明必须写明不会发送、不会转线索");
assert.match(followEntry, /prospectFollowUpWritable\(item\)/, "未达可联系时详情不放写入框");
assert.match(followEntry, /renderProspectNextFollow\(item\)/, "详情必须显示下次跟进");
assert.doesNotMatch(followEntry, /convert-to-lead|send-development-email|解除抑制/, "跟进入口不得转线索、发信或解除抑制");
const saveFollowUp = kbSourceBetween(apiLayer, "async function saveProspectFollowUp", "\nfunction renderProspectList");
assert.match(saveFollowUp, /\/api\/prospect-list\/\$\{encodeURIComponent\(item\.id\)\}\/follow-ups/, "记录跟进必须走现有候选接口");
assert.match(saveFollowUp, /body: \{ content: string; nextFollowAt\?: string \} = \{ content \}/, "记录跟进仍以文本为主");
assert.match(saveFollowUp, /if \(nextFollowAt\) body\.nextFollowAt = nextFollowAt/, "有下次跟进时间才一并提交");
assert.match(saveFollowUp, /JSON\.stringify\(\{ nextFollowAt \}\)/, "可以只改下次跟进");
assert.doesNotMatch(saveFollowUp, /convert-to-lead|send-development-email|approved_contactable|ensureProspectFollowUpTodo/, "记录跟进不得转线索、改批准或生成待办");
const followQueue = kbSourceBetween(apiLayer, "function followUpQueueCandidates()", "\nfunction renderDashboardFollowUps");
assert.match(followQueue, /shortlistedAt/, "待记跟进只包含搜客清单里的候选");
assert.match(followQueue, /prospectFollowUpWritable\(item\)/, "待记跟进只包含已可联系的候选");
assert.match(apiLayer, /没有可记跟进的候选。去搜客清单，留下已可联系的候选后再回来。这里不会编造名单。/, "没有可记跟进时必须指向搜客清单，不能编造名单");
assert.match(prototype, /id="dashboardFollowUps"[\s\S]*待记跟进/, "工作台必须有待记跟进");
const followBoard = kbSourceBetween(apiLayer, "function renderDashboardFollowUps()", "\nfunction renderDashboardProspectRuns");
assert.match(followBoard, /data-dashboard-follow-up/, "待记跟进每一行必须能打开");
assert.match(followBoard, /暂无跟进/, "待记跟进每一行在没有记录时写暂无跟进");
const followClickStart = apiLayer.indexOf('qs<HTMLElement>("#dashboardFollowUps")?.addEventListener');
const followClick = apiLayer.slice(followClickStart, followClickStart + 520);
assert.match(followClick, /openFollowUpFromDashboard\(item\)/, "点待记跟进必须打开跟进");
assert.doesNotMatch(followClick, /sendProspectDevelopmentEmail|send-development-email|convertProspectsToLeads|openProspectOutreachDraft/, "点待记跟进不得发送或转线索");
const openFollow = kbSourceBetween(apiLayer, "function openFollowUpFromDashboard", "\nfunction openSentProspectFromDashboard");
assert.match(openFollow, /prospectFollowUpFocusId = item\.id/, "打开待记跟进必须落到输入框");
assert.match(openFollow, /不会发送，也不会转为线索/, "打开待记跟进时必须说明不会发送、不会转线索");
assert.doesNotMatch(openFollow, /sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead/, "打开待记跟进不得发送或转线索");
assert.match(prototype, /\.prospect-follow-up/, "跟进摘要必须有可见样式");
assert.match(prospectListRender, /renderProspectNextFollow\(item\)/, "搜客清单行必须展示下次跟进");
assert.match(apiLayer, /未设下次跟进/, "未设置下次跟进时必须写未设下次跟进");
assert.match(apiLayer, /data-next-follow="overdue"/, "过期的下次跟进必须标已逾期");
assert.match(apiLayer, /已逾期/, "过期样式文案必须是已逾期");
assert.match(prototype, /id="dashboardDueFollowUps"[\s\S]*今日到期/, "工作台必须有今日到期");
assert.match(prototype, /\.prospect-next-follow\.is-overdue/, "逾期必须有可见样式");
const dueQueue = kbSourceBetween(apiLayer, "function dueFollowUpCandidates", "\nfunction renderDashboardDueFollowUps");
assert.match(dueQueue, /shortlistedAt/, "今日到期只包含搜客清单里的候选");
assert.match(dueQueue, /prospectFollowUpWritable\(item\)/, "今日到期只包含已可联系的候选");
assert.match(dueQueue, /"overdue"/, "今日到期包含已逾期");
assert.match(dueQueue, /"today"/, "今日到期包含今天要跟的");
assert.match(apiLayer, /没有今天到期或已逾期的下次跟进。去搜客清单，给已可联系的候选设一个时间后再回来。这里不会编造名单，也不会发到站外。/, "没有到期时必须指向搜客清单，不能编造名单或发到站外");
const dueClickStart = apiLayer.indexOf('qs<HTMLElement>("#dashboardDueFollowUps")?.addEventListener');
const dueClick = apiLayer.slice(dueClickStart, dueClickStart + 700);
assert.match(dueClick, /openFollowUpFromDashboard\(item, "next"\)/, "点今日到期必须打开下次跟进");
assert.doesNotMatch(dueClick, /sendProspectDevelopmentEmail|send-development-email|convertProspectsToLeads|openProspectOutreachDraft/, "点今日到期不得发送或转线索");
const stageLayer = readFileSync(new URL("./prospect-acquisition-stage.ts", import.meta.url), "utf8");
assert.match(stageLayer, /export function deriveAcquisitionStage/, "阶段必须由纯函数从已有字段推导");
assert.match(stageLayer, /草稿不落库/, "没有落库草稿时不得单开草稿待发");
assert.match(stageLayer, /label: "待触达"/, "未触达的标签是待触达");
assert.match(stageLayer, /label: "待写开发信"/, "可联系且未发出的标签是待写开发信");
assert.match(stageLayer, /label: "已触达待批准"/, "已触达未批准的标签是已触达待批准");
assert.match(stageLayer, /label: "可联系"/, "已有人工可联系批准且未跟进的标签是可联系");
assert.match(stageLayer, /label: "跟进中"/, "已有跟进的标签是跟进中");
assert.match(stageLayer, /label: "已转线索"/, "已转入的标签是已转线索");
assert.match(stageLayer, /filter: "held"/, "抑制、退订、退信和无效归在抑制筛选");
assert.match(stageLayer, /不会自动批准/, "已触达阶段不得自动批准");
assert.match(stageLayer, /不会自动推进/, "跟进阶段不得自动推进");
assert.doesNotMatch(stageLayer, /convert-to-lead|send-development-email|INSERT|UPDATE|stage 表/, "阶段推导不得转线索、发信或写阶段表");
assert.match(prospectListRender, /renderAcquisitionStageBadge\(item\)/, "搜客清单每一行必须显示阶段");
const stageRows = kbSourceBetween(apiLayer, "function prospectFilteredRows()", "\nfunction selectedProspect");
assert.match(stageRows, /prospectStageFilter[\s\S]*deriveAcquisitionStage/, "阶段筛选只按推导结果过滤");
assert.match(apiLayer, /prospect-detail-hero[\s\S]{0,900}renderProspectAcquisitionStage\(item\)/, "搜客清单详情必须说明当前阶段");
assert.match(apiLayer, /lead-verification-drawer-head[\s\S]{0,700}renderProspectAcquisitionStage\(item\)/, "候选详情必须说明当前阶段");
assert.match(apiLayer, /查看抑制原因/, "抑制阶段必须能点到原来的原因");
assert.match(apiLayer, /function focusProspectHoldNotice[\s\S]*prospect-hold-notice/, "查看抑制原因必须落到原来的原因条");
assert.doesNotMatch(kbSourceBetween(apiLayer, "function renderProspectAcquisitionStage", "\nfunction focusProspectHoldNotice"), /解除抑制|convert-to-lead|send-development-email/, "阶段说明不得解除抑制、转线索或发信");
assert.match(prototype, /data-prospect-stage-filter="pending"[\s\S]*待触达/, "阶段筛选必须有待触达");
assert.match(prototype, /data-prospect-stage-filter="reached"[\s\S]*已触达/, "阶段筛选必须有已触达");
assert.match(prototype, /data-prospect-stage-filter="contactable"[\s\S]*可联系/, "阶段筛选必须有可联系");
assert.match(prototype, /data-prospect-stage-filter="following"[\s\S]*跟进中/, "阶段筛选必须有跟进中");
assert.match(prototype, /data-prospect-stage-filter="converted"[\s\S]*已转线索/, "阶段筛选必须有已转线索");
assert.match(prototype, /data-prospect-stage-filter="held"[\s\S]*抑制/, "阶段筛选必须有抑制");
assert.match(prototype, /id="dashboardAcquisitionStages"[\s\S]*获客阶段/, "工作台必须有获客阶段计数");
assert.match(apiLayer, /本人名下还没有搜客清单。去智能获客加入候选后再看阶段。这里不会编造数字，点开也不会改状态。/, "没有本人候选时不得编造阶段数字");
const stageClickStart = apiLayer.indexOf('qs<HTMLElement>("#dashboardAcquisitionStages")?.addEventListener');
const stageClick = apiLayer.slice(stageClickStart, stageClickStart + 520);
assert.match(stageClick, /openAcquisitionStageFromDashboard/, "点工作台阶段必须打开筛选后的清单");
assert.doesNotMatch(stageClick, /sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead/, "点工作台阶段不得发送或转线索");
const openStage = kbSourceBetween(apiLayer, "function openAcquisitionStageFromDashboard", "\nfunction renderProspectList");
assert.match(openStage, /prospectStageFilter = filter/, "打开阶段必须只设置筛选");
assert.match(openStage, /不会发送，也不会转为线索/, "打开阶段时必须说明不会发送、不会转线索");
assert.doesNotMatch(openStage, /sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead|\/approve/, "打开阶段不得发送、转线索或批准");
assert.match(prototype, /\.prospect-stage\b/, "阶段说明必须有可见样式");
assert.match(prototype, /\.acquisition-stage-count\b/, "工作台阶段计数必须有可见样式");
const coverageLayer = readFileSync(new URL("./prospect-coverage-pool.ts", import.meta.url), "utf8");
assert.match(coverageLayer, /export function deriveCoveragePool/, "覆盖池必须由纯函数从已有字段推导");
assert.match(coverageLayer, /tenantProspectId/, "覆盖池只认已有的 tenantProspectId");
assert.match(coverageLayer, /未进正式企业覆盖池/, "未进池的文案必须是未进正式企业覆盖池");
assert.match(coverageLayer, /已在正式企业覆盖池/, "已在池的文案必须是已在正式企业覆盖池");
assert.match(coverageLayer, /尚未进入正式企业覆盖池，不能转为线索/, "未进池说明必须沿用转线索的同一句");
assert.match(coverageLayer, /不会自动入池/, "覆盖池说明不得自动入池");
assert.match(coverageLayer, /kind: "convert"/, "未进池但已可转时下一步是转线索确认");
assert.match(coverageLayer, /去写开发信/, "缺开发信时下一步是去写开发信");
assert.match(coverageLayer, /去申请可联系批准/, "缺批准时下一步是去申请可联系批准");
assert.match(coverageLayer, /去补正式企业身份/, "其余未进池候选下一步是现有正式企业身份");
assert.doesNotMatch(coverageLayer, /fetch\(|convert-to-lead|send-development-email|INSERT|UPDATE/, "覆盖池推导不得发请求或写库");
assert.match(prospectListRender, /renderCoveragePoolBadge\(item\)/, "搜客清单每一行必须显示覆盖池标签");
assert.match(prospectListRender, /renderCoveragePoolLine\(item\)/, "未进池的清单行必须带下一步");
assert.match(prospectListRender, /renderDashboardCoverageGaps\(\)/, "清单刷新必须同时更新覆盖池缺口");
const coverageRows = kbSourceBetween(apiLayer, "function prospectFilteredRows()", "\nfunction selectedProspect");
assert.match(coverageRows, /prospectCoverageFilter[\s\S]*deriveCoveragePool/, "覆盖池筛选只按 tenantProspectId 推导结果过滤");
assert.match(apiLayer, /prospect-detail-hero[\s\S]{0,1200}renderProspectCoveragePool\(item\)/, "搜客清单详情必须说明覆盖池");
assert.match(apiLayer, /lead-verification-drawer-head[\s\S]{0,900}renderProspectCoveragePool\(item\)/, "候选详情必须说明覆盖池");
assert.match(apiLayer, /没有未进正式企业覆盖池的候选。这里不会编造公司，也不会自动入池。/, "筛不到未进池时必须写清空态");
assert.match(prototype, /data-prospect-coverage-filter="out"[\s\S]*未进正式企业覆盖池/, "清单必须能筛未进正式企业覆盖池");
assert.match(prototype, /id="dashboardCoverageGaps"[\s\S]*未进正式企业覆盖池/, "工作台必须有未进正式企业覆盖池");
assert.match(apiLayer, /COVERAGE_POOL_GAP_LIMIT = 8/, "工作台覆盖池缺口最多显示 8 行");
assert.match(apiLayer, /当前可见范围里还没有搜客清单。去智能获客加入候选后再看。这里不会编造名单，也不会自动入池。/, "没有清单时不得编造覆盖池缺口");
assert.match(apiLayer, /当前可见的搜客清单都已在正式企业覆盖池。这里不会编造缺口，也不会自动入池。/, "都已在池时不得编造缺口");
const coverageQueue = kbSourceBetween(apiLayer, "function coveragePoolGapCandidates()", "\nfunction renderDashboardCoverageGaps");
assert.match(coverageQueue, /shortlistedAt/, "覆盖池缺口只包含搜客清单里的候选");
assert.match(coverageQueue, /deriveCoveragePool/, "覆盖池缺口只包含未进池的候选");
const coverageClickStart = apiLayer.indexOf('qs<HTMLElement>("#dashboardCoverageGaps")?.addEventListener');
const coverageClick = apiLayer.slice(coverageClickStart, coverageClickStart + 640);
assert.match(coverageClick, /openCoverageGapFromDashboard/, "点工作台缺口必须打开候选详情");
assert.doesNotMatch(coverageClick, /sendProspectDevelopmentEmail|convertProspectsToLeads|startProspectIdentityBootstrap|convert-to-lead/, "点工作台缺口不得发送、转线索或开始身份核验");
const openGap = kbSourceBetween(apiLayer, "function openCoverageGapFromDashboard", "\nfunction openConvertConfirmationFromCoverage");
assert.match(openGap, /prospectCoverageFilter = "out"|showProspectForCoverage\(item, "coverage"\)/, "打开缺口必须能落到未进池筛选");
assert.match(openGap, /不会自动入池，也不会转为线索/, "打开缺口时必须说明不会自动入池、不会转线索");
assert.doesNotMatch(openGap, /sendProspectDevelopmentEmail|convertProspectsToLeads|startProspectIdentityBootstrap|convert-to-lead/, "打开缺口不得发送、转线索或开始身份核验");
const openConvert = kbSourceBetween(apiLayer, "function openConvertConfirmationFromCoverage", "\nfunction openIdentityFromCoverage");
assert.match(openConvert, /prospectConvertGate\(item\)\.ready/, "转线索捷径必须先看现有资格");
assert.match(openConvert, /不会直接转入/, "转线索捷径不得直接转入");
assert.doesNotMatch(openConvert, /convertProspectsToLeads|convert-to-lead|sendProspectDevelopmentEmail|startProspectIdentityBootstrap/, "转线索捷径不得调用转换、发信或身份核验");
const openIdentity = kbSourceBetween(apiLayer, "function openIdentityFromCoverage", "\nfunction openCoveragePoolNext");
assert.match(openIdentity, /不会自动开始核验，也不会自动入池/, "身份捷径不得自动开始核验或入池");
assert.match(openIdentity, /不会自动加入，也不会自动入池/, "未加入清单时不得自动加入");
assert.doesNotMatch(openIdentity, /startProspectIdentityBootstrap|identity-bootstrap|convertProspectsToLeads|sendProspectDevelopmentEmail/, "身份捷径不得提交核验、转线索或发信");
const openCoverageNext = kbSourceBetween(apiLayer, "function openCoveragePoolNext", "\nfunction bindCoveragePoolNext");
assert.match(openCoverageNext, /openConvertConfirmationFromCoverage/, "可转时必须打开现有确认");
assert.match(openCoverageNext, /openProspectDraftFromAcquisition/, "缺开发信时必须打开现有草稿");
assert.match(openCoverageNext, /openContactableApproval/, "缺批准时必须打开现有检查");
assert.match(openCoverageNext, /openIdentityFromCoverage/, "其余未进池必须打开现有身份");
assert.doesNotMatch(openCoverageNext, /convertProspectsToLeads|sendProspectDevelopmentEmail|startProspectIdentityBootstrap/, "下一步捷径不得自己转入、发送或开始核验");
assert.match(prototype, /\.prospect-coverage\b/, "覆盖池说明必须有可见样式");
const collisionLayer = readFileSync(new URL("./prospect-crm-collision.ts", import.meta.url), "utf8");
assert.match(collisionLayer, /export function presentCrmCollision/, "撞库展示必须复用已有结果，不另写匹配");
assert.match(collisionLayer, /已有客户/, "撞库命中客户的文案必须是已有客户");
assert.match(collisionLayer, /已有线索/, "撞库命中线索的文案必须是已有线索");
assert.match(collisionLayer, /未撞库/, "未命中的文案必须是未撞库");
assert.match(collisionLayer, /不是正式企业覆盖池/, "撞库说明必须和覆盖池区分开");
assert.match(collisionLayer, /不会自动合并，也不会改归属/, "撞库说明不得自动合并或改归属");
assert.match(collisionLayer, /名称不展示/, "看不见的命中不得展示名称");
assert.doesNotMatch(collisionLayer, /tenantProspectId|未进正式企业覆盖池|fetch\(|convert-to-lead|send-development-email/, "撞库展示不得混用覆盖池，也不得发请求或转线索");
assert.match(prospectListRender, /renderCrmCollisionBadge\(item\)/, "搜客清单每一行必须显示撞库标签");
assert.match(prospectListRender, /renderCrmCollisionLine\(item\)/, "已撞库的清单行必须带名称和入口");
assert.match(prospectListRender, /renderDashboardCrmCollisions\(\)/, "清单刷新必须同时更新撞库提示");
const collisionRows = kbSourceBetween(apiLayer, "function prospectFilteredRows()", "\nfunction selectedProspect");
assert.match(collisionRows, /prospectCollisionFilter[\s\S]*prospectCrmCollision/, "撞库筛选只按已有撞库结果过滤");
assert.match(apiLayer, /prospect-detail-hero[\s\S]{0,1600}renderProspectCrmCollision\(item\)/, "搜客清单详情必须说明撞库");
assert.match(apiLayer, /lead-verification-drawer-head[\s\S]{0,1200}renderProspectCrmCollision\(item\)/, "候选详情必须说明撞库");
assert.match(apiLayer, /没有已撞库的候选。这里不会编造命中，也不会自动合并。/, "筛不到已撞库时必须写清空态");
assert.match(prototype, /data-prospect-collision-filter="hit"[\s\S]*已撞库/, "清单必须能筛已撞库");
assert.match(prototype, /id="dashboardCrmCollisions"[\s\S]*已有客户或线索撞库/, "工作台必须有已有客户或线索撞库");
assert.match(apiLayer, /CRM_COLLISION_LIMIT = 8/, "工作台撞库提示最多显示 8 行");
assert.match(apiLayer, /当前可见范围里还没有搜客清单。去智能获客加入候选后再看。这里不会编造名单，也不会自动合并。/, "没有清单时不得编造撞库");
assert.match(apiLayer, /当前可见的搜客清单都未撞库。这里不会编造命中，也不会自动合并。/, "都未撞库时不得编造命中");
assert.match(apiLayer, /客户\/线索撞库/, "详情标题必须是客户/线索撞库，不叫覆盖池");
assert.match(collisionLayer, /查看已有客户/, "命中客户时必须能打开现有客户详情");
assert.match(collisionLayer, /查看已有线索/, "命中线索时必须能打开现有线索详情");
assert.match(apiLayer, /crmCollisionLinkLabel\(hit\)/, "清单和详情必须使用撞库入口文案");
const collisionQueue = kbSourceBetween(apiLayer, "function crmCollisionCandidates()", "\nfunction renderDashboardCrmCollisions");
assert.match(collisionQueue, /shortlistedAt/, "工作台撞库只包含搜客清单里的候选");
assert.match(collisionQueue, /prospectCrmCollision/, "工作台撞库只包含已撞库的候选");
const collisionClickStart = apiLayer.indexOf('qs<HTMLElement>("#dashboardCrmCollisions")?.addEventListener');
const collisionClick = apiLayer.slice(collisionClickStart, collisionClickStart + 640);
assert.match(collisionClick, /openCrmCollisionFromDashboard/, "点工作台撞库必须打开候选详情");
assert.doesNotMatch(collisionClick, /sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead|openCrmCollisionRecord/, "点工作台撞库不得发送、转线索或直接改客户");
const openCollision = kbSourceBetween(apiLayer, "function openCrmCollisionFromDashboard", "\nfunction ownedAcquisitionCandidates");
assert.match(openCollision, /prospectCollisionFilter = "hit"/, "打开撞库必须落到已撞库筛选");
assert.match(openCollision, /不会自动合并，也不会改归属/, "打开撞库时必须说明不会自动合并、不会改归属");
assert.doesNotMatch(openCollision, /sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead|PATCH|ownerId =/, "打开撞库不得发送、转线索或改归属");
const openRecord = kbSourceBetween(apiLayer, "async function openCrmCollisionRecord", "\nconst CRM_COLLISION_LIMIT");
assert.match(openRecord, /openCustomerDrawer\(\)/, "查看已有客户必须打开现有客户详情");
assert.match(openRecord, /openLead\(lead\.id\)/, "查看已有线索必须打开现有线索详情");
assert.match(openRecord, /不会自动合并，也不会改归属/, "打开已有记录时必须说明不会合并、不会改归属");
assert.doesNotMatch(openRecord, /convert-to-lead|send-development-email|merge|ownerId =/, "打开已有记录不得转线索、发信、合并或改归属");
assert.match(prototype, /\.prospect-collision\b/, "撞库说明必须有可见样式");
const failureLayer = readFileSync(new URL("./prospect-outreach-failure.ts", import.meta.url), "utf8");
assert.match(failureLayer, /export function presentOutreachFailure/, "开发信失败必须只消费接口带回的结果");
assert.match(failureLayer, /无失败记录/, "没有失败时文案必须是无失败记录");
assert.match(failureLayer, /发送失败/, "发送失败的文案必须是发送失败");
assert.match(failureLayer, /开发信退信/, "退信的文案必须是开发信退信");
assert.match(failureLayer, /不是抑制或退订/, "失败说明必须和抑制条区分开");
assert.match(failureLayer, /不会自动重发，也不会解除抑制/, "失败说明不得自动重发或解除抑制");
assert.match(failureLayer, /去重写开发信草稿/, "可重写时必须跳到现有草稿入口");
assert.doesNotMatch(failureLayer, /原因未回传|已退信|fetch\(|convert-to-lead|send-development-email/, "失败展示不得混用抑制文案，也不得发请求或转线索");
assert.match(prospectListRender, /renderOutreachFailureLine\(item\)/, "搜客清单每一行必须显示最近一次开发信失败或退信");
assert.match(prospectListRender, /renderDashboardOutreachFailures\(\)/, "清单刷新必须同时更新开发信失败入口");
const failureRows = kbSourceBetween(apiLayer, "function prospectFilteredRows()", "\nfunction selectedProspect");
assert.match(failureRows, /prospectOutreachFailureFilter[\s\S]*prospectOutreachFailure/, "失败筛选只按已有失败结果过滤");
assert.match(apiLayer, /prospect-detail-hero[\s\S]{0,2200}renderProspectOutreachFailure\(item\)/, "搜客清单详情必须说明开发信失败或退信");
assert.match(apiLayer, /lead-verification-drawer-head[\s\S]{0,1800}renderProspectOutreachFailure\(item\)/, "候选详情必须说明开发信失败或退信");
assert.match(apiLayer, /没有失败或退信的候选。这里不会编造记录，也不会自动重发。/, "筛不到失败时必须写清空态");
assert.match(prototype, /data-prospect-outreach-failure-filter="hit"[\s\S]*有失败\/退信/, "清单必须能筛有失败/退信");
assert.match(prototype, /id="dashboardOutreachFailures"[\s\S]*开发信失败或退信/, "工作台必须有开发信失败或退信");
assert.match(apiLayer, /OUTREACH_FAILURE_LIMIT = 8/, "工作台开发信失败最多显示 8 行");
assert.match(apiLayer, /当前可见范围里还没有搜客清单。去智能获客加入候选后再看。这里不会编造名单，也不会自动重发。/, "没有清单时不得编造开发信失败");
assert.match(apiLayer, /当前可见的搜客清单没有开发信失败或退信。这里不会编造记录，也不会自动重发。/, "没有失败时不得编造记录");
assert.match(apiLayer, /开发信失败或退信/, "详情标题必须是开发信失败或退信，不叫抑制原因");
assert.match(apiLayer, /outreachFailureRewriteLabel\(/, "失败态必须复用重写草稿的入口文案");
const failureQueue = kbSourceBetween(apiLayer, "function outreachFailureCandidates()", "\nfunction renderDashboardOutreachFailures");
assert.match(failureQueue, /shortlistedAt/, "工作台失败只包含搜客清单里的候选");
assert.match(failureQueue, /prospectOutreachFailure/, "工作台失败只包含有失败或退信的候选");
const failureClickStart = apiLayer.indexOf('qs<HTMLElement>("#dashboardOutreachFailures")?.addEventListener');
const failureClick = apiLayer.slice(failureClickStart, failureClickStart + 700);
assert.match(failureClick, /openOutreachFailureFromDashboard/, "点工作台失败必须打开候选详情");
assert.doesNotMatch(failureClick, /sendProspectDevelopmentEmail|openOutreachFailureDraft|convert-to-lead|convertProspectsToLeads/, "点工作台失败不得发送、重写或转线索");
const openFailure = kbSourceBetween(apiLayer, "function openOutreachFailureFromDashboard", "\nfunction bindOutreachFailureDraft");
assert.match(openFailure, /prospectOutreachFailureFilter = "hit"/, "打开失败必须落到有失败/退信筛选");
assert.match(openFailure, /不会自动重发，也不会解除抑制/, "打开失败时必须说明不会自动重发、不会解除抑制");
assert.doesNotMatch(openFailure, /sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead|openOutreachFailureDraft|\/approve/, "打开失败不得发送、转线索或批准");
const openFailureDraft = kbSourceBetween(apiLayer, "function openOutreachFailureDraft", "\nconst OUTREACH_FAILURE_LIMIT");
assert.match(openFailureDraft, /openProspectDraftFromAcquisition/, "重写捷径必须打开现有开发信草稿");
assert.doesNotMatch(openFailureDraft, /sendProspectDevelopmentEmail|convert-to-lead|\/approve|setProspectSuppression/, "重写捷径不得发送、转线索或解除抑制");
assert.match(prototype, /\.prospect-outreach-failure\b/, "开发信失败说明必须有可见样式");
const engagementLayer = readFileSync(new URL("./prospect-outreach-engagement.ts", import.meta.url), "utf8");
assert.match(engagementLayer, /export function presentOutreachEngagement/, "开发信打开或点击必须只消费接口带回的结果");
assert.match(engagementLayer, /无打开或点击/, "没有打开或点击时文案必须是无打开或点击");
assert.match(engagementLayer, /无打开/, "没有打开时必须写清空态");
assert.match(engagementLayer, /无点击/, "没有点击时必须写清空态");
assert.match(engagementLayer, /仓内没有送达回执/, "必须说明仓内没有送达回执");
assert.match(engagementLayer, /这不是失败条，也不是抑制条/, "打开或点击必须和失败条、抑制条区分开");
assert.match(engagementLayer, /不会自动跟进，也不会自动发下一封/, "打开或点击不得自动跟进或自动发下一封");
assert.doesNotMatch(engagementLayer, /原因未回传|已退信|解除抑制|fetch\(|convert-to-lead|send-development-email|deliveredAt\s*:/, "打开或点击不得混用失败文案，也不得发请求、转线索或编造送达字段");
assert.match(prospectListRender, /renderOutreachEngagementLine\(item\)/, "搜客清单每一行必须显示打开和点击");
assert.match(prospectListRender, /renderOutreachFailureLine\(item\)[\s\S]{0,80}renderOutreachEngagementLine\(item\)/, "打开或点击必须和失败条分开显示");
assert.match(prospectListRender, /renderDashboardOutreachEngagements\(\)/, "清单刷新必须同时更新打开或点击入口");
const engagementRows = kbSourceBetween(apiLayer, "function prospectFilteredRows()", "\nfunction selectedProspect");
assert.match(engagementRows, /prospectOutreachEngagementFilter[\s\S]*prospectOutreachEngagement/, "打开或点击筛选只按已有结果过滤");
assert.equal(
  [...apiLayer.matchAll(/\$\{renderProspectOutreachFailure\(item\)\}\n    \$\{renderProspectOutreachEngagement\(item\)\}/g)].length,
  2,
  "搜客清单详情和候选详情都必须在失败条后面单独说明打开或点击"
);
assert.match(apiLayer, /没有打开或点击的候选。这里不会编造记录，也不会自动跟进。/, "筛不到打开或点击时必须写清空态");
assert.match(prototype, /data-prospect-outreach-engagement-filter="hit"[\s\S]*有打开\/点击/, "清单必须能筛有打开/点击");
assert.match(prototype, /id="dashboardOutreachEngagements"[\s\S]*开发信打开或点击/, "工作台必须有开发信打开或点击");
assert.match(apiLayer, /OUTREACH_ENGAGEMENT_LIMIT = 8/, "工作台打开或点击最多显示 8 行");
assert.match(apiLayer, /当前可见范围里还没有搜客清单。去智能获客加入候选后再看。这里不会编造名单，也不会自动跟进。/, "没有清单时不得编造打开或点击");
assert.match(apiLayer, /当前可见的搜客清单没有打开或点击。这里不会编造记录，也不会自动跟进。/, "没有打开或点击时不得编造记录");
assert.match(apiLayer, /开发信打开或点击/, "详情标题必须是开发信打开或点击，不叫失败或抑制");
const engagementQueue = kbSourceBetween(apiLayer, "function outreachEngagementCandidates()", "\nfunction renderDashboardOutreachEngagements");
assert.match(engagementQueue, /shortlistedAt/, "工作台打开或点击只包含搜客清单里的候选");
assert.match(engagementQueue, /prospectOutreachEngagement/, "工作台打开或点击只包含有打开或点击的候选");
const engagementClickStart = apiLayer.indexOf('qs<HTMLElement>("#dashboardOutreachEngagements")?.addEventListener');
const engagementClick = apiLayer.slice(engagementClickStart, engagementClickStart + 760);
assert.match(engagementClick, /openOutreachEngagementFromDashboard/, "点工作台打开或点击必须打开候选详情");
assert.doesNotMatch(engagementClick, /sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead|openOutreachFailureDraft|recordProspect/, "点工作台打开或点击不得发送、转线索或记跟进");
const openEngagement = kbSourceBetween(apiLayer, "function openOutreachEngagementFromDashboard", "\nfunction renderProspectList");
assert.match(openEngagement, /prospectOutreachEngagementFilter = "hit"/, "打开触达反馈必须落到有打开/点击筛选");
assert.match(openEngagement, /不会自动跟进，也不会自动发下一封/, "打开触达反馈时必须说明不会自动跟进、不会自动发下一封");
assert.doesNotMatch(openEngagement, /sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead|openOutreachFailureDraft|\/approve|recordProspect/, "打开触达反馈不得发送、转线索、批准或记跟进");
assert.match(prototype, /\.prospect-outreach-engagement\b/, "开发信打开或点击必须有可见样式");
const replyLayer = readFileSync(new URL("./prospect-outreach-reply.ts", import.meta.url), "utf8");
assert.match(replyLayer, /export function presentOutreachReply/, "开发信回复必须只消费接口带回的结果");
assert.match(replyLayer, /无回复/, "没有回复时文案必须是无回复");
assert.match(replyLayer, /有回复/, "没有摘要时必须写有回复");
assert.match(replyLayer, /这不是打开或点击条，也不是失败条，也不是抑制条/, "回复必须和打开或点击、失败条、抑制条区分开");
assert.match(replyLayer, /不会自动跟进，也不会自动发下一封/, "回复不得自动跟进或自动发下一封");
assert.match(replyLayer, /去跟进记录/, "有回复时必须能跳到现有跟进记录");
assert.match(replyLayer, /查看回复记录/, "有回复时必须能跳到现有回复记录");
assert.doesNotMatch(replyLayer, /原因未回传|已退信|解除抑制|fetch\(|convert-to-lead|send-development-email|deliveredAt\s*:/, "回复不得混用失败文案，也不得发请求、转线索或编造送达字段");
assert.match(prospectListRender, /renderOutreachReplyLine\(item\)/, "搜客清单每一行必须显示开发信回复");
assert.match(prospectListRender, /renderOutreachEngagementLine\(item\)[\s\S]{0,80}renderOutreachReplyLine\(item\)/, "回复必须和打开或点击分开显示");
assert.match(prospectListRender, /renderDashboardOutreachReplies\(\)/, "清单刷新必须同时更新开发信回复入口");
const replyRows = kbSourceBetween(apiLayer, "function prospectFilteredRows()", "\nfunction selectedProspect");
assert.match(replyRows, /prospectOutreachReplyFilter[\s\S]*prospectOutreachReply/, "回复筛选只按已有结果过滤");
assert.equal(
  [...apiLayer.matchAll(/\$\{renderProspectOutreachEngagement\(item\)\}\n    \$\{renderProspectOutreachReply\(item\)\}/g)].length,
  2,
  "搜客清单详情和候选详情都必须在打开或点击后面单独说明回复"
);
assert.match(apiLayer, /没有回复的候选。这里不会编造记录，也不会自动跟进。/, "筛不到回复时必须写清空态");
assert.match(prototype, /data-prospect-outreach-reply-filter="hit"[\s\S]*有回复/, "清单必须能筛有回复");
assert.match(prototype, /id="dashboardOutreachReplies"[\s\S]*开发信回复/, "工作台必须有开发信回复");
assert.match(apiLayer, /OUTREACH_REPLY_LIMIT = 8/, "工作台开发信回复最多显示 8 行");
assert.match(apiLayer, /当前可见范围里还没有搜客清单。去智能获客加入候选后再看回复。这里不会编造名单，也不会自动跟进。/, "没有清单时不得编造开发信回复");
assert.match(apiLayer, /当前可见的搜客清单没有开发信回复。这里不会编造记录，也不会自动跟进。/, "没有回复时不得编造记录");
assert.match(apiLayer, /开发信回复/, "详情标题必须是开发信回复，不叫打开或失败或抑制");
assert.match(apiLayer, /outreachReplyFollowLabel\(/, "有回复时必须复用跟进入口文案");
assert.match(apiLayer, /outreachReplyHistoryLabel\(/, "有回复时必须复用回复记录入口文案");
const replyQueue = kbSourceBetween(apiLayer, "function outreachReplyCandidates()", "\nfunction renderDashboardOutreachReplies");
assert.match(replyQueue, /shortlistedAt/, "工作台回复只包含搜客清单里的候选");
assert.match(replyQueue, /prospectOutreachReply/, "工作台回复只包含有回复的候选");
const replyClickStart = apiLayer.indexOf('qs<HTMLElement>("#dashboardOutreachReplies")?.addEventListener');
const replyClick = apiLayer.slice(replyClickStart, replyClickStart + 760);
assert.match(replyClick, /openOutreachReplyFromDashboard/, "点工作台回复必须打开候选详情");
assert.doesNotMatch(replyClick, /sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead|openOutreachReplyFollow|openOutreachReplyHistory|openProspectReplyModal|saveProspectFollowUp/, "点工作台回复不得发送、转线索、打开跟进或记下回复");
const openReply = kbSourceBetween(apiLayer, "function openOutreachReplyFromDashboard", "\nfunction markProspectConverted");
assert.match(openReply, /prospectOutreachReplyFilter = "hit"/, "打开回复必须落到有回复筛选");
assert.match(openReply, /不会自动跟进，也不会自动发下一封/, "打开回复时必须说明不会自动跟进、不会自动发下一封");
assert.doesNotMatch(openReply, /sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead|openOutreachReplyFollow|openOutreachReplyHistory|openProspectReplyModal|\/approve|saveProspectFollowUp/, "打开回复不得发送、转线索、批准或记跟进");
const replyFollow = kbSourceBetween(apiLayer, "function openOutreachReplyFollow", "\nfunction openOutreachReplyHistory");
assert.match(replyFollow, /prospect-follow-up-entry/, "去跟进记录必须滚到现有跟进记录");
assert.match(replyFollow, /不会自动记下跟进，也不会发信/, "跳到跟进时必须说明不会自动记下跟进");
assert.doesNotMatch(replyFollow, /saveProspectFollowUp|sendProspectDevelopmentEmail|convert-to-lead|openProspectReplyModal/, "跳到跟进不得提交跟进、发信或打开记录回复");
const replyHistory = kbSourceBetween(apiLayer, "function openOutreachReplyHistory", "\nfunction bindOutreachReplyLinks");
assert.match(replyHistory, /openProspectTouchpointHistory/, "查看回复记录必须打开现有触达记录");
assert.match(replyHistory, /不会自动跟进，也不会发信/, "查看回复记录时必须说明不会自动跟进");
assert.doesNotMatch(replyHistory, /saveProspectFollowUp|sendProspectDevelopmentEmail|convert-to-lead|openProspectReplyModal|\/replies/, "查看回复记录不得提交跟进、发信或新写回复");
assert.match(prototype, /\.prospect-outreach-reply\b/, "开发信回复必须有可见样式");
const sequenceLayer = readFileSync(new URL("./prospect-outreach-sequence.ts", import.meta.url), "utf8");
assert.match(sequenceLayer, /export function presentOutreachSequence/, "外联序列必须只消费接口带回的结果");
assert.match(sequenceLayer, /无序列/, "没有序列时文案必须是无序列");
assert.match(sequenceLayer, /查看方案/, "有方案时必须能跳到现有方案");
assert.match(sequenceLayer, /查看发信批次/, "有发信批次时必须能跳到现有批次");
assert.match(sequenceLayer, /查看触达序列/, "有触达序列时必须能跳到现有序列");
assert.match(sequenceLayer, /这不是回复条，也不是打开或点击条，也不是失败条，也不是抑制条/, "序列必须和回复、打开或点击、失败条、抑制条区分开");
assert.match(sequenceLayer, /不会推进序列，也不会自动发下一封/, "序列不得推进步骤或自动发下一封");
assert.doesNotMatch(sequenceLayer, /原因未回传|已退信|解除抑制|fetch\(|convert-to-lead|send-development-email|controlOutreachSequence/, "序列不得混用失败文案，也不得发请求、转线索或推进序列");
assert.match(prospectListRender, /renderOutreachSequenceLine\(item\)/, "搜客清单每一行必须显示外联序列");
assert.match(prospectListRender, /renderOutreachReplyLine\(item\)[\s\S]{0,80}renderOutreachSequenceLine\(item\)/, "序列必须和回复分开显示");
assert.match(prospectListRender, /renderDashboardOutreachSequences\(\)/, "清单刷新必须同时更新外联序列入口");
const sequenceRows = kbSourceBetween(apiLayer, "function prospectFilteredRows()", "\nfunction selectedProspect");
assert.match(sequenceRows, /prospectOutreachSequenceFilter[\s\S]*prospectOutreachSequence/, "序列筛选只按已有结果过滤");
assert.equal(
  [...apiLayer.matchAll(/\$\{renderProspectOutreachReply\(item\)\}\n    \$\{renderProspectOutreachSequence\(item\)\}/g)].length,
  2,
  "搜客清单详情和候选详情都必须在回复后面单独说明外联序列"
);
assert.match(apiLayer, /没有进行中的序列。这里不会编造记录，也不会推进序列。/, "筛不到进行中序列时必须写清空态");
assert.match(apiLayer, /没有已停的序列。这里不会编造记录，也不会推进序列。/, "筛不到已停序列时必须写清空态");
assert.match(prototype, /data-prospect-outreach-sequence-filter="active"[\s\S]*进行中/, "清单必须能筛进行中");
assert.match(prototype, /data-prospect-outreach-sequence-filter="stopped"[\s\S]*已停/, "清单必须能筛已停");
assert.match(prototype, /id="dashboardOutreachSequences"[\s\S]*外联序列/, "工作台必须有外联序列");
assert.match(apiLayer, /OUTREACH_SEQUENCE_LIMIT = 8/, "工作台外联序列最多显示 8 行");
assert.match(apiLayer, /当前可见范围里还没有搜客清单。去智能获客加入候选后再看序列。这里不会编造名单，也不会推进序列。/, "没有清单时不得编造外联序列");
assert.match(apiLayer, /当前可见的搜客清单没有外联序列。这里不会编造记录，也不会推进序列。/, "没有序列时不得编造记录");
assert.match(apiLayer, /外联序列/, "详情标题必须是外联序列，不叫回复或失败或抑制");
assert.match(apiLayer, /outreachSequenceEntryLabel\(/, "有序列时必须复用现有入口文案");
const sequenceQueue = kbSourceBetween(apiLayer, "function outreachSequenceCandidates()", "\nfunction renderDashboardOutreachSequences");
assert.match(sequenceQueue, /shortlistedAt/, "工作台序列只包含搜客清单里的候选");
assert.match(sequenceQueue, /prospectOutreachSequence/, "工作台序列只包含已有序列的候选");
const sequenceClickStart = apiLayer.indexOf('qs<HTMLElement>("#dashboardOutreachSequences")?.addEventListener');
const sequenceClick = apiLayer.slice(sequenceClickStart, sequenceClickStart + 760);
assert.match(sequenceClick, /openOutreachSequenceFromDashboard/, "点工作台序列必须打开候选详情");
assert.doesNotMatch(sequenceClick, /sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead|openOutreachSequenceEntry|controlOutreachSequence/, "点工作台序列不得发送、转线索或推进序列");
const openSequence = kbSourceBetween(apiLayer, "function openOutreachSequenceFromDashboard", "\nfunction openProspectConvertFollowUp");
assert.match(openSequence, /prospectOutreachSequenceFilter = view\.progress === "active" \|\| view\.progress === "stopped" \? view\.progress : "all"/, "打开序列必须落到进行中或已停筛选");
assert.match(openSequence, /不会推进步骤，也不会自动发下一封/, "打开序列时必须说明不会推进步骤、不会自动发下一封");
assert.doesNotMatch(openSequence, /sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead|openOutreachSequenceEntry|openOutreachPlanDetail|\/approve|controlOutreachSequence/, "打开序列不得发送、转线索、打开方案或推进步骤");
const sequenceEntry = kbSourceBetween(apiLayer, "function openOutreachSequenceEntry", "\nfunction bindOutreachSequenceLinks");
assert.match(sequenceEntry, /openOutreachPlanDetail/, "查看方案必须打开现有方案详情");
assert.match(sequenceEntry, /loadOutreachBatches/, "查看发信批次必须打开现有批次");
assert.match(sequenceEntry, /#agentSequenceList/, "查看触达序列必须打开现有序列入口");
assert.match(sequenceEntry, /不会推进步骤，也不会发信/, "跳到序列入口时必须说明不会推进步骤");
assert.doesNotMatch(sequenceEntry, /sendProspectDevelopmentEmail|convert-to-lead|controlOutreachSequence|\/approve|data-sequence-control|data-plan-action/, "跳到序列入口不得发信、转线索或推进步骤");
assert.match(prototype, /\.prospect-outreach-sequence\b/, "外联序列必须有可见样式");
const draftBacklogLayer = readFileSync(new URL("./prospect-outreach-draft-backlog.ts", import.meta.url), "utf8");
assert.match(draftBacklogLayer, /export function presentOutreachDraftBacklog/, "待发草稿必须只消费接口带回的结果");
assert.match(draftBacklogLayer, /无待发草稿/, "没有草稿时文案必须是无待发草稿");
assert.match(draftBacklogLayer, /查看发信批次/, "有草稿时必须能跳到现有发信批次");
assert.match(draftBacklogLayer, /这不是外联序列，也不是回复条，也不是打开或点击条，也不是失败条，也不是抑制条/, "草稿必须和外联序列、回复、打开或点击、失败条、抑制条区分开");
assert.match(draftBacklogLayer, /不会放行批次，也不会发送/, "草稿不得放行或发送");
assert.doesNotMatch(draftBacklogLayer, /无序列|进行中|原因未回传|已退信|解除抑制|fetch\(|convert-to-lead|send-development-email|approveProspectOutreachBatch/, "草稿不得混用序列或失败文案，也不得发请求、转线索或放行");
assert.match(prospectListRender, /renderOutreachDraftBacklogLine\(item\)/, "搜客清单每一行必须显示待发草稿");
assert.match(prospectListRender, /renderOutreachSequenceLine\(item\)[\s\S]{0,80}renderOutreachDraftBacklogLine\(item\)/, "草稿必须和序列分开显示");
assert.match(prospectListRender, /renderDashboardOutreachDraftBacklogs\(\)/, "清单刷新必须同时更新待发草稿入口");
const draftBacklogRows = kbSourceBetween(apiLayer, "function prospectFilteredRows()", "\nfunction selectedProspect");
assert.match(draftBacklogRows, /prospectOutreachDraftBacklogFilter[\s\S]*prospectOutreachDraftBacklog/, "草稿筛选只按已有结果过滤");
assert.equal(
  [...apiLayer.matchAll(/\$\{renderProspectOutreachSequence\(item\)\}\n    \$\{renderProspectOutreachDraftBacklog\(item\)\}/g)].length,
  2,
  "搜客清单详情和候选详情都必须在序列后面单独说明待发草稿"
);
assert.match(apiLayer, /没有待发草稿。这里不会编造草稿，也不会放行批次。/, "筛不到待发草稿时必须写清空态");
assert.match(prototype, /data-prospect-outreach-draft-backlog-filter="pending"[\s\S]*有积压/, "清单必须能筛有积压");
assert.match(prototype, /id="dashboardOutreachDraftBacklogs"[\s\S]*待发草稿/, "工作台必须有待发草稿");
assert.match(apiLayer, /OUTREACH_DRAFT_BACKLOG_LIMIT = 8/, "工作台待发草稿最多显示 8 行");
assert.match(apiLayer, /当前可见范围里还没有搜客清单。去智能获客加入候选后再看待发草稿。这里不会编造名单，也不会放行批次。/, "没有清单时不得编造待发草稿");
assert.match(apiLayer, /当前可见的搜客清单没有待发草稿。这里不会编造草稿，也不会放行批次。/, "没有草稿时不得编造记录");
assert.match(apiLayer, /待发草稿/, "详情标题必须是待发草稿，不叫序列或回复或失败或抑制");
assert.match(apiLayer, /outreachDraftBacklogEntryLabel\(/, "有草稿时必须复用现有发信批次入口文案");
const draftBacklogQueue = kbSourceBetween(apiLayer, "function outreachDraftBacklogCandidates()", "\nfunction renderDashboardOutreachDraftBacklogs");
assert.match(draftBacklogQueue, /shortlistedAt/, "工作台草稿只包含搜客清单里的候选");
assert.match(draftBacklogQueue, /prospectOutreachDraftBacklog/, "工作台草稿只包含有待发草稿的候选");
const draftBacklogClickStart = apiLayer.indexOf('qs<HTMLElement>("#dashboardOutreachDraftBacklogs")?.addEventListener');
const draftBacklogClick = apiLayer.slice(draftBacklogClickStart, draftBacklogClickStart + 760);
assert.match(draftBacklogClick, /openOutreachDraftBacklogFromDashboard/, "点工作台草稿必须打开候选详情");
assert.doesNotMatch(draftBacklogClick, /sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead|openOutreachDraftBacklogEntry|approveProspectOutreachBatch|\/approve/, "点工作台草稿不得发送、转线索或放行");
const openDraftBacklog = kbSourceBetween(apiLayer, "function openOutreachDraftBacklogFromDashboard", "\nconst OUTREACH_SEQUENCE_LIMIT");
assert.match(openDraftBacklog, /prospectOutreachDraftBacklogFilter = "pending"/, "打开草稿必须落到有积压筛选");
assert.match(openDraftBacklog, /不会放行批次，也不会发送/, "打开草稿时必须说明不会放行、不会发送");
assert.doesNotMatch(openDraftBacklog, /sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead|openOutreachDraftBacklogEntry|loadOutreachBatches|\/approve/, "打开草稿不得发送、转线索、打开发信批次或放行");
const draftBacklogEntry = kbSourceBetween(apiLayer, "function openOutreachDraftBacklogEntry", "\nfunction bindOutreachDraftBacklogLinks");
assert.match(draftBacklogEntry, /loadOutreachBatches/, "查看发信批次必须打开现有批次");
assert.match(draftBacklogEntry, /不会放行，也不会发送/, "跳到发信批次时必须说明不会放行");
assert.doesNotMatch(draftBacklogEntry, /sendProspectDevelopmentEmail|convert-to-lead|approveProspectOutreachBatch|\/approve|data-batch-approve|data-plan-action/, "跳到发信批次不得发信、转线索或放行");
assert.match(prototype, /\.prospect-outreach-draft-backlog\b/, "待发草稿必须有可见样式");
const inboundSyncLayer = readFileSync(new URL("./inbound-sync-status.ts", import.meta.url), "utf8");
assert.match(inboundSyncLayer, /export function presentInboundSyncStatus/, "收信同步必须只消费账号上已有的收信字段");
assert.match(inboundSyncLayer, /INBOUND_SYNC_LIMIT = 8/, "收信同步最多 8 条");
assert.match(inboundSyncLayer, /正常/, "没有收信异常时文案必须是正常");
assert.match(inboundSyncLayer, /收信同步异常/, "有异常时文案必须是收信同步异常");
assert.match(inboundSyncLayer, /收信设置/, "当前账号必须能跳到现有收信设置");
assert.match(inboundSyncLayer, /这是收信同步，不是发件/, "收信同步必须标明这是收信不是发件");
assert.match(inboundSyncLayer, /不是待发草稿，也不是外联序列，也不是回复条，也不是打开或点击条，也不是失败条，也不是抑制条/, "收信同步必须和草稿、序列、回复、打开或点击、失败条、抑制条区分开");
assert.match(inboundSyncLayer, /不会改授权，不会重连，不会触发同步，也不会发信/, "收信同步不得改授权、重连、触发同步或发信");
assert.doesNotMatch(inboundSyncLayer, /无待发草稿|无序列|原因未回传|已退信|解除抑制|fetch\(|convert-to-lead|inbound-mail\/sync|send-development-email/, "收信同步不得混用草稿或失败文案，也不得发请求、转线索或触发同步");
assert.match(apiLayer, /presentInboundSyncStatus\(/, "个人设置和工作台必须复用收信同步投影");
assert.match(apiLayer, /收信同步异常/, "设置里的收信状态必须写成收信同步异常");
assert.match(apiLayer, /没有收信同步异常。这里不会编造异常，也不会触发同步。/, "筛不到异常时必须写清空态");
assert.match(prototype, /data-inbound-sync-filter="error"[\s\S]*有异常/, "工作台必须能筛有异常");
assert.match(prototype, /id="dashboardInboundSync"[\s\S]*收信同步/, "工作台必须有收信同步");
assert.match(prototype, /id="profileInboundSync"/, "个人设置必须有现有收信监听入口");
assert.match(apiLayer, /INBOUND_SYNC_LIMIT/, "工作台收信同步必须守住 8 条上限");
assert.match(apiLayer, /正在读取当前账号/, "没有账号时不得编造收信异常");
assert.match(apiLayer, /收信同步暂时读不到（\$\{escapeHtml\(inboundSyncReadError\)\}）。点刷新重试。这里不会编造异常，也不会触发同步。/, "刷新失败时不得编造正常");
const inboundQueue = kbSourceBetween(apiLayer, "function inboundSyncAccountRows()", "\nfunction inboundSyncTone");
assert.match(inboundQueue, /state\.user/, "工作台收信同步以当前账号为一条");
assert.match(inboundQueue, /state\.accounts/, "看得到账号清单时才带上其他账号");
const inboundRender = kbSourceBetween(apiLayer, "function renderDashboardInboundSync()", "\nfunction openInboundSyncSettings");
assert.match(inboundRender, /listInboundSyncRows\(/, "工作台只渲染投影后的收信状态");
assert.match(inboundRender, /INBOUND_SYNC_LIMIT/, "工作台渲染必须传入 8 条上限");
assert.match(inboundRender, /state\.user\?\.id/, "当前账号必须留在收信名单里");
const inboundClick = kbSourceBetween(apiLayer, 'qs<HTMLElement>("#dashboardInboundSync")?.addEventListener', "\n  qs<HTMLButtonElement>(\"#profileSaveButton\")");
assert.match(inboundClick, /openInboundSyncSettings/, "点工作台收信同步必须打开收信设置");
assert.doesNotMatch(inboundClick, /sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead|inbound-mail\/sync|refreshInboundSyncStatus|profileTestImap/, "点工作台收信同步不得发信、转线索、触发同步或测试连接");
const openInbound = kbSourceBetween(apiLayer, "function openInboundSyncSettings()", "\nasync function refreshInboundSyncStatus");
assert.match(openInbound, /activateNavView\("profile"/, "收信设置必须打开现有个人设置");
assert.match(openInbound, /#profileInboundSync/, "收信设置必须落到现有收信监听");
assert.match(openInbound, /不会改授权，不会重连，也不会触发同步/, "打开收信设置时必须说明不会改授权、不会重连、不会触发同步");
assert.doesNotMatch(openInbound, /sendProspectDevelopmentEmail|convert-to-lead|inbound-mail\/sync|profileTestImap|profileSaveButton|\/approve/, "打开收信设置不得发信、转线索、触发同步或保存");
const refreshInbound = kbSourceBetween(apiLayer, "async function refreshInboundSyncStatus", "\nconst OUTREACH_SEQUENCE_LIMIT");
assert.match(refreshInbound, /\/api\/auth\/me/, "刷新收信同步必须重读当前账号");
assert.doesNotMatch(refreshInbound, /inbound-mail\/sync|synchronizeUser|send-development-email|convert-to-lead|profileTestImap|\/approve/, "刷新收信同步不得触发同步、发信或转线索");
assert.match(prototype, /\.dashboard-inbound-sync-note\b/, "收信同步必须有可见说明样式");
const summaryLayer = readFileSync(new URL("./acquisition-todo-summary.ts", import.meta.url), "utf8");
assert.match(summaryLayer, /export function buildAcquisitionTodoSummary/, "获客待办摘要必须只聚合已有投影");
assert.match(summaryLayer, /ACQUISITION_TODO_SUMMARY_LIMIT = 8/, "摘要合计最多 8 条");
assert.match(summaryLayer, /ACQUISITION_TODO_SUMMARY_PER_CATEGORY = 2/, "摘要每类最多 2 条");
assert.match(summaryLayer, /可联系批准待办[\s\S]*待发草稿积压[\s\S]*外联序列已停[\s\S]*有回复待看[\s\S]*开发信失败\/退信[\s\S]*收信同步异常/, "摘要类别必须按这个优先级");
assert.match(summaryLayer, /人工可联系批准/, "可联系批准待办只认已有的人工可联系批准缺项");
assert.match(summaryLayer, /不替代各类原条/, "摘要必须标明不替代原条");
assert.match(summaryLayer, /progress === "stopped"/, "外联序列摘要只收已停");
assert.doesNotMatch(summaryLayer, /fetch\(|inbound-mail\/sync|send-development-email|convert-to-lead|approveProspectOutreachBatch|controlOutreachSequence/, "摘要不得发请求、转线索、放行、推进或触发同步");
assert.match(prototype, /id="dashboardAcquisitionTodoSummary"[\s\S]{0,1800}id="dashboardAcquisitionStages"/, "摘要必须在获客阶段上面");
assert.match(prototype, /id="dashboardAcquisitionTodoSummaryNote"[\s\S]*不替代各类原条/, "摘要说明必须写明不替代原条");
assert.match(prototype, /id="dashboardOutreachDraftBacklogs"[\s\S]*待发草稿/, "待发草稿原条还在");
assert.match(prototype, /id="dashboardInboundSync"[\s\S]*收信同步/, "收信同步原条还在");
assert.match(prototype, /id="dashboardOutreachReplies"[\s\S]*开发信回复/, "开发信回复原条还在");
assert.match(prototype, /id="dashboardOutreachFailures"[\s\S]*开发信失败或退信/, "开发信失败原条还在");
assert.match(prototype, /id="dashboardOutreachSequences"[\s\S]*外联序列/, "外联序列原条还在");
assert.match(apiLayer, /buildAcquisitionTodoSummary\(/, "工作台必须复用摘要聚合");
assert.match(apiLayer, /approvalPending: pending/, "可联系批准待办必须复用现有缺项判断");
const summaryRender = kbSourceBetween(apiLayer, "function renderDashboardAcquisitionTodoSummary()", "\nasync function refreshDashboardAcquisitionTodoSummary");
assert.match(summaryRender, /buildAcquisitionTodoSummary\(/, "摘要渲染必须走聚合结果");
assert.match(summaryRender, /有则列出，没有的类别会跳过/, "没有的类别必须跳过");
assert.match(summaryRender, /不会编造待办，也不替代各类原条/, "没有待办时不得编造，也不得说成原条");
assert.match(summaryRender, /不会编造异常，也不会触发同步/, "收信读不到时不得编造异常或触发同步");
assert.match(kbSourceBetween(apiLayer, "function renderAcquisitionTodoGroups", "\nfunction renderDashboardAcquisitionTodoSummary"), /data-acquisition-todo-category/, "摘要按类别分块，不把几类合成一条");
assert.doesNotMatch(summaryRender, /sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead|inbound-mail\/sync|approveProspectOutreachBatch|controlOutreachSequence|\/approve/, "摘要渲染不得发送、转线索、放行、推进或触发同步");
const summaryRefresh = kbSourceBetween(apiLayer, "async function refreshDashboardAcquisitionTodoSummary", "\nfunction bindDashboardAcquisitionTodoSummary");
assert.match(summaryRefresh, /refreshDashboardPendingEmails\(\)/, "刷新摘要必须重读候选");
assert.match(summaryRefresh, /refreshInboundSyncStatus\(\)/, "刷新摘要必须重读账号上的收信字段");
assert.doesNotMatch(summaryRefresh, /inbound-mail\/sync|send-development-email|convert-to-lead|approveProspectOutreachBatch|controlOutreachSequence/, "刷新摘要不得触发同步、发信、转线索、放行或推进");
const summaryBind = kbSourceBetween(apiLayer, "function bindDashboardAcquisitionTodoSummary()", "\nasync function convertProspectsToLeads");
assert.match(summaryBind, /prospectContactableApprovalPending\(item, prospectConvertGate\(item\)\)/, "点批准待办必须再核对现有缺项");
assert.match(summaryBind, /openContactableApproval\(item\)/, "点批准待办必须打开现有跟进前检查");
assert.match(summaryBind, /openOutreachDraftBacklogEntry\(item\)/, "点待发草稿必须打开现有发信批次");
assert.match(summaryBind, /openOutreachSequenceFromDashboard\(item\)/, "点已停序列必须打开候选详情");
assert.match(summaryBind, /openOutreachReplyFromDashboard\(item\)/, "点有回复必须打开候选详情");
assert.match(summaryBind, /openOutreachFailureFromDashboard\(item\)/, "点失败或退信必须打开候选详情");
assert.match(summaryBind, /openInboundSyncSettings\(\)/, "点当前账号收信异常必须打开收信设置");
assert.match(summaryBind, /accountId !== state\.user\?\.id/, "别的账号不打开收信设置");
assert.doesNotMatch(summaryBind, /sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead|inbound-mail\/sync|approveProspectOutreachBatch|controlOutreachSequence|openOutreachSequenceEntry|profileTestImap|\/approve/, "点摘要不得发送、转线索、放行、推进、触发同步或打开序列控制");
assert.match(apiLayer, /bindDashboardAcquisitionTodoSummary\(\);/, "摘要点击必须绑定一次");
assert.match(prototype, /\.dashboard-acquisition-todo-note\b/, "摘要说明必须有可见样式");
const nextFollowDueLayer = readFileSync(new URL("./prospect-next-follow-due.ts", import.meta.url), "utf8");
assert.match(nextFollowDueLayer, /export function presentNextFollowDue/, "下次跟进逾期必须只消费已有的下次跟进时间");
assert.match(nextFollowDueLayer, /NEXT_FOLLOW_DUE_LIMIT = 8/, "下次跟进逾期最多 8 条");
assert.match(nextFollowDueLayer, /无下次跟进/, "没有下次跟进时文案必须是无下次跟进");
assert.match(nextFollowDueLayer, /逾期/, "过了当前时刻必须标逾期");
assert.match(nextFollowDueLayer, /今日/, "今天还没到的时刻必须标今日");
assert.match(nextFollowDueLayer, /未到/, "今天之后必须标未到");
assert.match(nextFollowDueLayer, /去下次跟进/, "必须能跳到现有跟进入口");
assert.match(nextFollowDueLayer, /这不是获客待办摘要，也不是待记跟进，也不是今日到期/, "下次跟进逾期必须和摘要、待记跟进、今日到期区分开");
assert.match(nextFollowDueLayer, /也不是待发草稿，也不是外联序列，也不是回复条，也不是打开或点击条，也不是失败条，也不是抑制条，也不是收信同步/, "下次跟进逾期必须和草稿、序列、回复、打开或点击、失败、抑制、收信同步区分开");
assert.match(nextFollowDueLayer, /不会自动跟进，不会改时间，不会发信，也不会改 convert_to_lead 或 approved_contactable/, "下次跟进逾期不得自动跟进、改时间、发信或改门禁");
assert.doesNotMatch(nextFollowDueLayer, /已逾期|未设下次跟进|fetch\(|convert-to-lead|send-development-email|saveProspectNextFollow|saveProspectFollowUp/, "下次跟进逾期不得混用已逾期或未设下次跟进，也不得发请求、改时间或记跟进");
assert.doesNotMatch(kbSourceBetween(nextFollowDueLayer, "function nextFollowDueLineLabel", "\nexport function nextFollowDueStatusLabel"), /今日到期|已逾期|未设下次跟进/, "行文案必须用逾期、今日、未到，不用今日到期");
assert.match(prospectListRender, /renderNextFollowDueLine\(item\)/, "搜客清单每一行必须显示下次跟进逾期");
assert.match(prospectListRender, /renderProspectNextFollow\(item\)[\s\S]{0,80}renderNextFollowDueLine\(item\)/, "下次跟进逾期必须和原来的下次跟进分开显示");
assert.match(prospectListRender, /renderDashboardNextFollowDue\(\)/, "清单刷新必须同时更新下次跟进逾期入口");
const nextFollowDueRows = kbSourceBetween(apiLayer, "function prospectFilteredRows()", "\nfunction selectedProspect");
assert.match(nextFollowDueRows, /prospectNextFollowDueFilter[\s\S]*prospectNextFollowDue/, "下次跟进逾期筛选只按已有时间过滤");
assert.equal(
  [...apiLayer.matchAll(/\$\{renderProspectOutreachDraftBacklog\(item\)\}\n    \$\{renderProspectNextFollowDue\(item\)\}/g)].length,
  2,
  "搜客清单详情和候选详情都必须在待发草稿后面单独说明下次跟进逾期"
);
assert.match(apiLayer, /没有逾期的下次跟进。这里不会编造时间，也不会自动跟进。/, "筛不到逾期时必须写清空态");
assert.match(apiLayer, /没有今日的下次跟进。这里不会编造时间，也不会自动跟进。/, "筛不到今日时必须写清空态");
assert.match(prototype, /data-prospect-next-follow-due-filter="overdue"[\s\S]*逾期/, "清单必须能筛逾期");
assert.match(prototype, /data-prospect-next-follow-due-filter="today"[\s\S]*今日/, "清单必须能筛今日");
assert.match(prototype, /id="dashboardDueFollowUps"[\s\S]{0,2500}id="dashboardNextFollowDue"[\s\S]*下次跟进逾期/, "工作台下次跟进逾期必须在今日到期下面");
assert.match(prototype, /id="dashboardNextFollowDueNote"[\s\S]*不是获客待办摘要/, "工作台说明必须和获客待办摘要分开");
assert.match(prototype, /id="dashboardDueFollowUps"[\s\S]*今日到期/, "今日到期原条还在");
assert.match(apiLayer, /NEXT_FOLLOW_DUE_LIMIT/, "工作台下次跟进逾期必须守住 8 条上限");
assert.match(apiLayer, /listNextFollowDueQueue\(/, "工作台必须复用逾期在前的排序");
assert.match(apiLayer, /当前可见范围里还没有搜客清单。去智能获客加入候选后再看下次跟进。这里不会编造名单，也不会自动跟进。/, "没有清单时不得编造下次跟进");
assert.match(apiLayer, /无下次跟进。当前可见的搜客清单没有下次跟进。这里不会编造时间，也不会自动跟进。/, "没有下次跟进时不得编造时间");
assert.match(apiLayer, /下次跟进逾期/, "详情标题必须是下次跟进逾期，不叫今日到期或获客待办摘要");
assert.match(apiLayer, /nextFollowDueEntryLabel\(/, "详情必须复用去下次跟进入口文案");
const nextFollowDueQueue = kbSourceBetween(apiLayer, "function renderDashboardNextFollowDue", "\nfunction openNextFollowDueFromDashboard");
assert.match(nextFollowDueQueue, /shortlistedAt/, "工作台下次跟进逾期只包含搜客清单里的候选");
assert.match(nextFollowDueQueue, /listNextFollowDueQueue\(/, "工作台下次跟进逾期只按已有时间排序");
assert.match(nextFollowDueQueue, /NEXT_FOLLOW_DUE_LIMIT/, "工作台渲染必须传入 8 条上限");
const nextFollowDueClickStart = apiLayer.indexOf('qs<HTMLElement>("#dashboardNextFollowDue")?.addEventListener');
const nextFollowDueClick = apiLayer.slice(nextFollowDueClickStart, nextFollowDueClickStart + 700);
assert.match(nextFollowDueClick, /openNextFollowDueFromDashboard/, "点工作台下次跟进逾期必须打开现有跟进入口");
assert.doesNotMatch(nextFollowDueClick, /saveProspectNextFollow|saveProspectFollowUp|sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead|openFollowUpFromDashboard/, "点工作台下次跟进逾期不得改时间、记跟进、发送或转线索");
const openNextFollowDue = kbSourceBetween(apiLayer, "function openNextFollowDueFromDashboard", "\nfunction renderDashboardProspectRuns");
assert.match(openNextFollowDue, /prospectNextFollowDueFilter = view\.kind === "overdue" \|\| view\.kind === "today" \? view\.kind : "all"/, "打开逾期或今日必须落到对应筛选，未到保持全部");
assert.match(openNextFollowDue, /nextFollowDueFocusId = item\.id/, "打开后必须停在现有下次跟进");
assert.match(openNextFollowDue, /不会自动跟进，也不会改时间/, "打开时必须说明不会自动跟进、不会改时间");
assert.doesNotMatch(openNextFollowDue, /saveProspectNextFollow|saveProspectFollowUp|sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead|\/approve/, "打开下次跟进逾期不得改时间、记跟进、发送、转线索或批准");
const scrollNextFollow = kbSourceBetween(apiLayer, "function scrollToExistingNextFollow", "\nfunction focusNextFollowDueTarget");
assert.match(scrollNextFollow, /prospect-follow-up-entry/, "去下次跟进必须滚到现有跟进记录");
assert.match(scrollNextFollow, /#prospectNextFollowAt, #leadFinderNextFollowAt/, "去下次跟进必须停在已有的下次跟进时间");
assert.doesNotMatch(scrollNextFollow, /saveProspectNextFollow|saveProspectFollowUp|\.value\s*=|fetch\(|convert-to-lead|send-development-email/, "跳到下次跟进不得改时间、提交跟进或发请求");
assert.match(prototype, /\.prospect-next-follow-due\b/, "下次跟进逾期必须有可见样式");
assert.match(prototype, /\.dashboard-next-follow-due-note\b/, "下次跟进逾期说明必须有可见样式");
const stageStuckLayer = readFileSync(new URL("./prospect-stage-stuck.ts", import.meta.url), "utf8");
assert.match(stageStuckLayer, /export function presentStageStuck/, "转化阶段卡住必须只消费已有阶段进入时间");
assert.match(stageStuckLayer, /STAGE_STUCK_LIMIT = 8/, "转化阶段卡住最多 8 条");
assert.match(stageStuckLayer, /STAGE_STUCK_WINDOW_DAYS = 7/, "停留窗口必须是 7 天");
assert.match(stageStuckLayer, /无阶段/, "没有可用进入时间时文案必须是无阶段");
assert.match(stageStuckLayer, /卡住/, "超过窗口必须标卡住");
assert.match(stageStuckLayer, /推进中/, "窗口内必须标推进中");
assert.match(stageStuckLayer, /查看当前阶段/, "必须能跳到现有阶段入口");
assert.match(stageStuckLayer, /enteredKind !== "iso"/, "下次跟进那种时间不算阶段进入时间");
assert.match(stageStuckLayer, /这不是获客阶段计数，也不是获客待办摘要，也不是下次跟进逾期/, "转化阶段卡住必须和阶段计数、摘要、下次跟进逾期区分开");
assert.match(stageStuckLayer, /也不是待记跟进或今日到期，也不是待发草稿、外联序列、回复、打开或点击、失败或抑制、收信同步/, "转化阶段卡住必须和待记跟进、草稿、序列、回复、打开或点击、失败、抑制、收信同步区分开");
assert.match(stageStuckLayer, /不会改阶段，不会自动跟进，不会发信，也不会改 convert_to_lead 或 approved_contactable/, "转化阶段卡住不得改阶段、自动跟进、发信或改门禁");
assert.doesNotMatch(stageStuckLayer, /fetch\(|convert-to-lead|send-development-email|saveProspectNextFollow|saveProspectFollowUp|approved_contactable\s*=/, "转化阶段卡住不得发请求、改阶段、记跟进或改门禁");
assert.doesNotMatch(kbSourceBetween(stageStuckLayer, "function stageStuckLineLabel", "\nexport function stageStuckStatusLabel"), /逾期|今日到期|无下次跟进|获客待办|无序列|无待发草稿/, "行文案必须用卡住、推进中、无阶段");
assert.match(prospectListRender, /renderStageStuckLine\(item\)/, "搜客清单每一行必须显示转化阶段卡住");
assert.match(prospectListRender, /renderNextFollowDueLine\(item\)[\s\S]{0,120}renderStageStuckLine\(item\)/, "转化阶段卡住必须和下次跟进逾期分开显示");
assert.match(prospectListRender, /renderDashboardStageStuck\(\)/, "清单刷新必须同时更新转化阶段卡住入口");
const stageStuckRows = kbSourceBetween(apiLayer, "function prospectFilteredRows()", "\nfunction selectedProspect");
assert.match(stageStuckRows, /prospectStageStuckFilter[\s\S]*prospectStageStuck/, "转化阶段卡住筛选只按已有进入时间过滤");
assert.equal(
  [...apiLayer.matchAll(/\$\{renderProspectNextFollowDue\(item\)\}\n    \$\{renderProspectStageStuck\(item\)\}/g)].length,
  2,
  "搜客清单详情和候选详情都必须在下次跟进逾期后面单独说明转化阶段卡住"
);
assert.match(apiLayer, /没有卡住的阶段。这里不会编造阶段，也不会改阶段。/, "筛不到卡住时必须写清空态");
assert.match(prototype, /data-prospect-stage-stuck-filter="stuck"[\s\S]*卡住/, "清单必须能筛卡住");
assert.match(prototype, /id="dashboardNextFollowDue"[\s\S]{0,4000}id="dashboardStageStuck"[\s\S]*转化阶段卡住/, "工作台转化阶段卡住必须在下次跟进逾期下面");
assert.match(prototype, /id="dashboardStageStuckNote"[\s\S]*不是获客阶段计数/, "工作台说明必须和获客阶段计数分开");
assert.match(prototype, /id="dashboardAcquisitionStages"[\s\S]*获客阶段/, "获客阶段计数还在");
assert.match(apiLayer, /STAGE_STUCK_LIMIT/, "工作台转化阶段卡住必须守住 8 条上限");
assert.match(apiLayer, /listStageStuckQueue\(/, "工作台必须复用卡住在前的排序");
assert.match(apiLayer, /当前可见范围里还没有搜客清单。去智能获客加入候选后再看阶段停留。这里不会编造名单，也不会改阶段。/, "没有清单时不得编造阶段停留");
assert.match(apiLayer, /无阶段。当前可见的搜客清单没有可判断停留的阶段进入时间。这里不会编造阶段，也不会改阶段。/, "没有进入时间时不得编造阶段");
assert.match(apiLayer, /转化阶段卡住/, "详情标题必须是转化阶段卡住");
assert.match(apiLayer, /stageStuckEntryLabel\(/, "详情必须复用查看当前阶段入口文案");
const stageStuckQueue = kbSourceBetween(apiLayer, "function renderDashboardStageStuck", "\nfunction openStageStuckFromDashboard");
assert.match(stageStuckQueue, /shortlistedAt/, "工作台转化阶段卡住只包含搜客清单里的候选");
assert.match(stageStuckQueue, /listStageStuckQueue\(/, "工作台转化阶段卡住只按已有进入时间排序");
assert.match(stageStuckQueue, /STAGE_STUCK_LIMIT/, "工作台渲染必须传入 8 条上限");
const stageStuckClickStart = apiLayer.indexOf('qs<HTMLElement>("#dashboardStageStuck")?.addEventListener');
const stageStuckClick = apiLayer.slice(stageStuckClickStart, stageStuckClickStart + 700);
assert.match(stageStuckClick, /openStageStuckFromDashboard/, "点工作台转化阶段卡住必须打开现有阶段");
assert.doesNotMatch(stageStuckClick, /saveProspectNextFollow|saveProspectFollowUp|sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead|openFollowUpFromDashboard/, "点工作台转化阶段卡住不得改阶段、记跟进、发送或转线索");
const openStageStuck = kbSourceBetween(apiLayer, "function openStageStuckFromDashboard", "\nfunction renderDashboardProspectRuns");
assert.match(openStageStuck, /prospectStageStuckFilter = view\.kind === "stuck" \? "stuck" : "all"/, "打开卡住必须落到卡住筛选，推进中保持全部");
assert.match(openStageStuck, /stageStuckFocusId = item\.id/, "打开后必须停在现有当前阶段");
assert.match(openStageStuck, /不会改阶段，也不会自动跟进/, "打开时必须说明不会改阶段、不会自动跟进");
assert.doesNotMatch(openStageStuck, /saveProspectNextFollow|saveProspectFollowUp|sendProspectDevelopmentEmail|convertProspectsToLeads|convert-to-lead|\/approve/, "打开转化阶段卡住不得改阶段、记跟进、发送、转线索或批准");
const scrollStage = kbSourceBetween(apiLayer, "function scrollToExistingStage", "\nfunction focusStageStuckTarget");
assert.match(scrollStage, /\.prospect-stage/, "查看当前阶段必须滚到现有阶段说明");
assert.doesNotMatch(scrollStage, /saveProspectNextFollow|saveProspectFollowUp|\.value\s*=|fetch\(|convert-to-lead|send-development-email/, "跳到当前阶段不得改阶段、提交跟进或发请求");
assert.match(prototype, /\.prospect-stage-stuck\b/, "转化阶段卡住必须有可见样式");
assert.match(prototype, /\.dashboard-stage-stuck-note\b/, "转化阶段卡住说明必须有可见样式");

// ---------------------------------------------------------------------------
// 知识库训练工作台（P1）
//
// 这组断言守的是**最容易静默失效的地方**：控件 id 必须 index.html 与 prototype-api.ts
// 两端都对得上（少一个就是「点了没反应」），以及前端调用的路由后端必须真的存在。
// ---------------------------------------------------------------------------
/**
 * 断言源码里存在**生效的**代码行 —— 注释里出现同名字符串不算数。
 *
 * 这条是踩出来的：第一版用 `apiLayer.includes("bindKbTrainingEvents();")` 断言，
 * 把调用整行注释掉后断言依然通过（注释里也有那串字符）。会红的自检才算自检。
 */
function kbHasLiveLine(source: string, matcher: (line: string) => boolean, message: string) {
  const hit = source.split("\n").some((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return false;
    return matcher(line);
  });
  assert.ok(hit, message);
}

/**
 * 取「某函数定义之后、下一个函数定义之前」的源码片段 —— 用于「这段逻辑必须落在这个函数里」的断言。
 *
 * 这条也是踩出来的：写「勾选后必须在 finally 里重读」时用的是
 * `toggleKbKnowledgeEnabled[\s\S]{0,1600}?finally \{…await loadKbKnowledgeBases…`，
 * 但同一文件后面还有两个函数也有 `finally` + 同样的调用，惰性匹配直接跳过去命中它们 ——
 * 把该函数里的那一行删掉，断言依然全绿。凡"必须在这个函数里"的判据都得先切出函数体。
 */
function kbSourceBetween(source: string, fromMarker: string, toMarker: string): string {
  const start = source.indexOf(fromMarker);
  if (start < 0) return "";
  const end = source.indexOf(toMarker, start + fromMarker.length);
  return source.slice(start, end < 0 ? source.length : end);
}

assert.match(prototype, /<div class="view" id="kb-training">/, "index.html 必须提供知识库训练视图容器");
assert.match(prototype, /data-view="kb-training"/, "知识库训练必须有导航入口");
// ⚠️ 真实事故（用户报「为什么所有界面都有知识库训练？？？」）：视图自带的 <style> 里
//    写成 `#kb-training { display:flex }`（权重 1,0,0），压掉了全局的
//    `.view { display:none }`（权重 0,1,0）→ 该视图不再受活动态约束，**每个页面都渲染**。
//    这类错误的通用形态是「以视图 id 为唯一主体、且体内写 display」，所以按视图清单逐个扫。
//    注意：判据必须跑在**剥掉注释**的副本上 —— 上面那段说明文字里就写着 `#kb-training { display:flex }`，
//    不剥注释的话断言会命中自己的注释（第一版就这么误报过一次）。
const prototypeNoComments = prototype.replace(/\/\*[\s\S]*?\*\//gu, "");
const kbViewIdList = [...prototype.matchAll(/<div class="view" id="([^"]+)"/gu)].map((match) => match[1]);
kbViewIdList.forEach((viewId) => {
  assert.doesNotMatch(
    prototypeNoComments,
    new RegExp(`#${viewId}\\s*\\{[^}]*display\\s*:`, "u"),
    `视图 #${viewId} 的样式不得直接写 display —— 会压掉 .view{display:none}，该视图会在所有页面渲染（布局态请写 #${viewId}.active）`
  );
});
assert.match(
  prototypeNoComments,
  /#kb-training\.active\s*\{[^}]*display:\s*flex/u,
  "知识库训练激活态必须以 flex 渲染三屏（布局态限定在 .active 上）"
);
// 来源描述：资料从哪来 / 谁给的口径，跟着候选出处一起显示。三个落点缺一不可 ——
// 少了输入框用户填不了；少了提交体填了也不生效；少了出处渲染生效了也看不见。
assert.match(prototype, /id="kbSourceNote"/u, "屏 1 必须有「来源描述」输入框 #kbSourceNote");
kbHasLiveLine(apiLayer, (line) => line.includes('"#kbSourceNote"'), "prototype-api.ts 必须读取 #kbSourceNote");
assert.match(prototype, /data-kb-staged-note/u, "暂存清单每行必须有「来源描述」输入框");
kbHasLiveLine(apiLayer, (line) => line.includes("kbStagedNote"), "暂存描述输入必须绑定 data-kb-staged-note（dataset.kbStagedNote）");
kbHasLiveLine(apiLayer, (line) => line.includes("note: soloStaged && mainNote ? mainNote : item.note || undefined"), "暂存项提交时必须带上来源描述");
kbHasLiveLine(apiLayer, (line) => line.includes("note: mainNote || undefined"), "正文框那一份提交时必须带上来源描述");
assert.match(
  kbSourceBetween(apiLayer, "function kbSourceRefHtml", "function kbCandidateStatusTag"),
  /escapeHtml\(ref\.note\)/u,
  "候选出处必须渲染来源描述（且要过 escapeHtml）"
);
// 出处三件套随发布到插件：试问引用卡片必须显示「《文件》§段落 · 描述」。
// KbProbeCitation 要有三件套字段；kbProbeCitationHtml 里要拼《标题》并渲染出处行（都过 escapeHtml）。
assert.match(
  apiLayer,
  /interface KbProbeCitation\s*\{[^}]*sourceTitle\?[^}]*sourceAnchor\?[^}]*sourceNote\?/u,
  "KbProbeCitation 必须声明出处三件套（sourceTitle/sourceAnchor/sourceNote）"
);
assert.match(
  kbSourceBetween(apiLayer, "function kbProbeCitationHtml", "function renderKbProbe"),
  /citation\.sourceTitle \? `《\$\{citation\.sourceTitle\}》`/u,
  "试问引用必须显示文件名（《文件》格式，出处整行统一过 escapeHtml）"
);
assert.match(
  kbSourceBetween(apiLayer, "function kbProbeCitationHtml", "function renderKbProbe"),
  /出处：\$\{escapeHtml\(sourceBits\)\}/u,
  "试问引用必须渲染「出处：」整行（且要过 escapeHtml）"
);
kbHasLiveLine(apiLayer, (line) => line.trim() === '"kb-training": "知识库训练",', "viewLabels 必须注册知识库训练");
kbHasLiveLine(apiLayer, (line) => line.trim() === '"kb-training": "training.read",', "知识库训练必须复用 training.read 权限");
kbHasLiveLine(apiLayer, (line) => line.trim() === 'if (view === "kb-training") {', "进入知识库训练必须挂载加载钩子");
kbHasLiveLine(apiLayer, (line) => line.trim() === "void loadKbTraining({ silent: true });", "进入知识库训练必须加载工作台（且为静默加载）");
kbHasLiveLine(apiLayer, (line) => line.trim() === "bindKbTrainingEvents();", "知识库训练事件必须在启动时绑定一次");
kbHasLiveLine(apiLayer, (line) => line.trim() === 'if (activeView === "kb-training" && view !== "kb-training") stopKbTrainingPoll();', "离开知识库训练必须停止轮询");
kbHasLiveLine(apiLayer, (line) => line.includes('candidate.preselect && candidate.status === "pending"'), "预勾选必须直接采用后端算出的 preselect");
assert.doesNotMatch(apiLayer, /shouldPreselect|KB_PRESELECT_CONFIDENCE/, "前端不得复制后端的预勾选规则（规则只在后端有一份）");
const kbTrainingIds = [
  "kbRefreshButton",
  "kbSourceTitle",
  "kbSourceAsset",
  "kbSourceBody",
  "kbSourceFile",
  "kbUploadButton",
  "kbStartRunButton",
  "kbTargetKnowledgeBase",
  "kbStagedList",
  "kbSourceHint",
  "kbRunList",
  "kbCandidateSummary",
  "kbCandidateStatusFilter",
  "kbCandidateKindFilter",
  "kbCandidateConfidenceFilter",
  "kbCandidateGapOnly",
  "kbCandidateList",
  "kbCandidateNotice",
  "kbCandidateSelectedCount",
  "kbReviewSelectedButton",
  "kbDropSelectedButton",
  "kbPublishButton",
  "kbProbeInput",
  "kbProbeButton",
  "kbProbeResult",
  "kbProbeOpenButton",
  "kbProbeModal",
  "kbProbeModalClose",
  "kbKnowledgeSummary",
  "kbKnowledgeList",
  "kbKnowledgeNotice",
  "kbKnowledgeSearch"
];
kbTrainingIds.forEach((id) => {
  assert.ok(prototype.includes(`id="${id}"`), `知识库训练缺少控件 #${id}`);
  kbHasLiveLine(apiLayer, (line) => line.includes(`"#${id}"`), `prototype-api.ts 从未引用 #${id}（选择器拼错即静默不生效）`);
});
// 顶部搜索框只过滤卡片展示：判据落在真正过滤的那一行上。
// 「归入哪个库」下拉仍走全量（renderKbTargetOptions 用 kbKnowledgeSorted() 原样取），
// 提交口径不能被搜索框收窄 —— 收窄了用户搜着字发布，就会把成果发进没搜出来的库。
kbHasLiveLine(apiLayer, (line) => line.includes("item.name.toLowerCase().includes(query)"), "知识库搜索必须按名称过滤卡片");
kbHasLiveLine(apiLayer, (line) => line.includes("匹配 ${items.length} / 共 ${all.length} 个"), "搜索时摘要必须显示匹配数（否则不知道是筛过了还是真没有）");
kbHasLiveLine(apiLayer, (line) => line.includes("没有匹配「"), "搜索无结果必须区分「没有匹配」与「还没有知识库」两种空态");
// 试问验证必须是「按钮 → 弹窗」：弹窗复用全局 .modal-backdrop/.modal 语言
//（自造一套浮层会让关闭/遮罩/Esc 的行为与其它弹窗不一致），且打开即聚焦输入框。
assert.match(prototype, /class="modal-backdrop" id="kbProbeModal"/u, "试问验证必须用全局弹窗语言（.modal-backdrop + #kbProbeModal），不得自造浮层");
assert.match(prototype, /id="kbProbeModalClose"[^>]*aria-label="关闭"/u, "试问弹窗必须有关闭键（aria-label=\"关闭\"）");
kbHasLiveLine(apiLayer, (line) => line.includes('kbProbeModal.classList.add("active")'), "试问弹窗必须由「问一句试试」按钮打开（.active 显隐与全局弹窗一致）");
kbHasLiveLine(apiLayer, (line) => line.includes('kbProbeModal.classList.remove("active")'), "试问弹窗必须可关闭（关闭键/遮罩点击）");
kbHasLiveLine(apiLayer, (line) => line.includes('qs<HTMLInputElement>("#kbProbeInput")?.focus()'), "试问弹窗打开后必须聚焦输入框（打开即问）");
// 指标条的 <small> 是「这格是什么」，不是「取值范围枚举」：
// 曾经写成「CLI / 模型 / 未生效」，于是引擎正常工作时也摆着一个「未生效」，
// 用户读到的结论是「我的引擎没生效」—— 真降级反而被这句话淹掉。
assert.doesNotMatch(prototype, /<small>[^<]*未生效[^<]*<\/small>/u, "指标条说明位不得把「未生效」写成静态取值：引擎正常时会被读成「当前未生效」，真降级反而看不出");

// ---------------------------------------------------------------------------
// 知识库训练：试问屏必须与插件 resolve() 的真实出参对齐
//
// 这里守的是本轮修掉的一类错：前端曾经按「出处」的形状去渲染 `hits`
// （读 title/snippet/score），结果每条都渲染成空壳 —— 而真相是 `hits` 是
// `TrainingLibraryMatch`（{entry, similarity, matchedTerms}），`citations` 才是出处。
// 契约不一致时界面不会报错，只会安静地少显示东西，所以必须由断言守住。
// ---------------------------------------------------------------------------
// 判据必须落在**真正渲染的那一行**上：只断言「出现过 probe.verdict」是不够的
// —— 守卫条件 `if (probe.message && !probe.verdict)` 里也有它，把渲染那一行删掉照样通过。
kbHasLiveLine(apiLayer, (line) => line.includes("escapeHtml(probe.verdict)"), "试问必须展示插件给的护栏判决（verdict）");
kbHasLiveLine(apiLayer, (line) => line.includes("for (const warning of probe.warnings"), "试问必须展示插件给的提示（warnings）");
kbHasLiveLine(
  apiLayer,
  (line) => line.includes("item.entry.question || item.entry.answer"),
  "试问必须指出踩到的禁用场景（哪句被拦、为什么）"
);
kbHasLiveLine(
  apiLayer,
  (line) => line.includes("citations.filter((citation) => citation.kind === group.kind)"),
  "试问的正文出处必须以 citations 分组渲染"
);
assert.doesNotMatch(
  apiLayer,
  /probe\.blocked|blocked\?:\s*boolean/u,
  "插件 resolve() 没有 blocked 字段：前端不得伪造（假字段只会让界面永远少显示一句真话）"
);
assert.doesNotMatch(
  apiLayer,
  /\.\.\.\(probe\.hits \|\| \[\]\),\s*\.\.\.\(probe\.citations/u,
  "hits 与 citations 是同一次检索的两种视图，相加会让同一条问答被列两遍、条数翻倍"
);
assert.match(
  apiLayer,
  /interface KbProbeMatch \{[\s\S]{0,400}?entry: KbProbeEntry;/u,
  "hits 的类型必须是插件的 TrainingLibraryMatch（含 entry），不是出处形状"
);

// 行内编辑：人工确认闸必须能润色答案，否则不合口径的候选只有「丢弃」一条路。
kbHasLiveLine(
  apiLayer,
  (line) => line.trim() === "body: JSON.stringify({ ids: chunk, action, edits: edits?.length ? edits : undefined })",
  "确认时必须把 edits 一起提交（后端支持 edits，不传等于改了不生效）"
);
kbHasLiveLine(apiLayer, (line) => line.includes('data-kb-edit="answer"'), "编辑态必须有答案输入框");
// 同上：光有字符串不够 —— 渲染处与聚焦选择器是两件事，缺一个就是「编辑框打不开或点不到」。
assert.ok(
  (apiLayer.match(/data-kb-edit="answer"/gu) || []).length >= 2,
  "答案输入框必须既被渲染、也被聚焦逻辑引用（进编辑态要能直接开始打字）"
);
kbHasLiveLine(apiLayer, (line) => line.includes('"edit-confirm"'), "编辑态必须有「保存并确认」动作");

// 多份资料：一次训练要能带上好几份（后端 text.items 上限 50 条）。
assert.match(prototype, /id="kbSourceFile"[^>]*\bmultiple\b/u, "本地文件读取必须支持多选（一次只训一份是真实摩擦）");
// 上传区是 div 不是 button：键盘可达性与拖拽导入必须手动补齐，缺了就是"只能用鼠标"。
kbHasLiveLine(apiLayer, (line) => line.includes('upload.onkeydown = (event) =>'), "上传区必须键盘可达（Enter / 空格打开选择窗口）");
kbHasLiveLine(apiLayer, (line) => line.includes("upload.ondrop = (event) =>"), "上传区必须支持拖拽导入（点选之外的第二条路）");
kbHasLiveLine(apiLayer, (line) => line.includes("all.filter((item) => kbSourceFileKind(item.name) !== \"\")"), "拖入文件必须按扩展名过滤（二进制会被 text() 读成乱码语料）");
// PDF / Word 不能走 file.text()：浏览器读不出正文，必须交后端抽取。
kbHasLiveLine(apiLayer, (line) => line.includes("await kbExtractSourceFile(file)"), "PDF / Word 必须走后端抽取，不能本地当文本读");
kbHasLiveLine(apiLayer, (line) => line.includes("void readKbLocalFiles(ok)"), "拖拽与点选必须共用同一套读入管线（两套管线迟早读出两种结果）");
kbHasLiveLine(apiLayer, (line) => line.includes("sources: { text: { items } }"), "提交时必须以 text.items 携带多份资料（不是只发一份）");
assert.doesNotMatch(
  apiLayer,
  /files:\s*\{ assetIds:/u,
  "前端不得把关联资料同时塞进 files.assetIds：那条路径会把资料自身的说明当成一份语料喂进去"
);
kbHasLiveLine(apiLayer, (line) => line.includes("items.push({ title, body, assetId: assetId || undefined, note: mainNote || undefined })"), "正文框内容必须作为一份资料一起提交（含来源描述）");
assert.ok(
  (apiLayer.match(/kbTrainingState\.staged = \[\]/gu) || []).length >= 2,
  "暂存清单必须既能提交后自动清空、也能手动清空"
);

// 降级可见（§9）：轮询失败不许刷屏、不许静默；截断必须说出来。
// 断言计数而非「存在一处」：轮询与批次加载是两条独立的失败路径，
// 只守其中一条，另一条改成弹 toast 就会每 3 秒刷满界面（同名字符串会掩盖它）。
assert.ok(
  (apiLayer.match(/if \(options\.silent\) kbNotePollFailure\(\);/gu) || []).length >= 2,
  "轮询与批次加载两条失败路径都必须静默计数，不能每 3 秒弹一次错"
);
kbHasLiveLine(apiLayer, (line) => line.trim() === "if (kbTrainingState.pollStopped || kbTrainingState.editId) return;", "连续失败或编辑中必须停自动刷新");
kbHasLiveLine(
  apiLayer,
  (line) => line.includes("kbTrainingState.candidateTotal > kbTrainingState.candidates.length"),
  "候选被 limit 截断时必须明说（静默截断是历史踩过的坑）"
);

// 出处可点：候选的出处要能一键回到文件中心资料本身。
kbHasLiveLine(apiLayer, (line) => line.includes("data-kb-asset="), "候选出处必须渲染成可点链接（关联了文件中心资料时）");
kbHasLiveLine(apiLayer, (line) => line.includes('"[data-kb-asset]"'), "出处链接必须有事件处理");

// ---------------------------------------------------------------------------
// 知识库：公开 / 私用 + 账号级「默认知识库」多选启用
//
// 这一组守三件**错了也不会报错、只会安静地不对**的事：
//  ① 勾选即启用 —— 一旦退回「勾完再点保存」，用户勾完就走，出稿没变化且无从察觉；
//  ② 保存成功 ≠ 生效 —— 插件没推成功时必须**常驻**提示（清单在 CRM 生效、运行端还没生效）；
//  ③ 别人的库改不动 —— 只渲染勾选框，不渲染「改名 / 切公开」按钮
//     （渲染出来点了报错，比压根不渲染更糟：用户会以为是自己没权限）。
// ---------------------------------------------------------------------------
assert.doesNotMatch(
  apiLayer,
  /data-kb-kb-save/u,
  "启用清单不得有「保存」按钮：勾选即启用，多一步就会有人勾完不点保存，然后以为生效了"
);
kbHasLiveLine(
  apiLayer,
  (line) => line.includes("data-kb-kb-enable=") && line.includes("item.enabled"),
  "知识库勾选框必须反映当前启用状态（不看状态就渲染，界面会与真实清单不一致）"
);
kbHasLiveLine(
  apiLayer,
  (line) => line.includes("data-kb-kb-visibility=") && line.includes("item.isOwner"),
  "别人的知识库不得渲染「公开 / 私用」按钮：别人的库只能勾选启用，改不动"
);
kbHasLiveLine(
  apiLayer,
  (line) => line.includes("data-kb-kb-rename=") && line.includes("item.isOwner"),
  "别人的知识库不得渲染改名按钮（渲染出来点了报错比不渲染更糟）"
);
// 保存成功 ≠ 生效：这两条分支必须把「还没生效」留在屏幕上，而不是弹一个会消失的 toast。
kbHasLiveLine(apiLayer, (line) => line.includes("!result.pluginPushed"), "插件未同步必须显式提示：清单在 CRM 生效、运行端还没生效");
kbHasLiveLine(apiLayer, (line) => line.includes("result.rejected?.length"), "知识库被拒时必须说明是哪几个、为什么（静默忽略等于谎报成功）");
assert.ok(
  /finally \{[\s\S]*?await loadKbKnowledgeBases\(\{ silent: true \}\)/u.test(
    kbSourceBetween(apiLayer, "async function toggleKbKnowledgeEnabled", "async function toggleKbKnowledgeVisibility")
  ),
  "勾选后必须以后端清单为准重读：失败时由后端把勾选状态改回来（乐观更新会在失败时留下假象）"
);
assert.doesNotMatch(
  apiLayer,
  /function setKbKnowledgeNotice[\s\S]{0,400}?setTimeout/u,
  "知识库提示必须常驻：清单没同步到插件时出稿仍按旧清单走，自动消失的提示等于没说"
);
// 训练完成 / 发布候选之后都要静默重读知识库：条目数会变，不重读就看不到自己的成果进了哪个库。
// 断言的是**那一处调用本身**（`void` 形式），不是"文件里出现过这串字符"——
// 三个 finally 里的 `await` 形式也含同样的字符串，只数总量的话把这两处删掉也不会红。
assert.ok(
  (apiLayer.match(/void loadKbKnowledgeBases\(\{ silent: true \}\)/gu) || []).length >= 2,
  "发起训练与发布候选后都必须静默重读知识库（否则「已发布 N 条」永远停在旧数字）"
);
// 试问必须回报「这次读了什么范围」：没命中时这是唯一能区分
// 「被启用清单挡掉」与「库里压根没有这条语料」的证据，缺了用户只能靠猜。
kbHasLiveLine(apiLayer, (line) => line.includes("probe.kbScope"), "试问必须展示检索范围（插件回报的 kbScope）");
// 判据落在**给用户看的那句话**上：只断言 `scope.skippedByScope` 是不够的 ——
// 同一行模板里它出现两次，删掉三元判断、留下插值照样通过。
kbHasLiveLine(
  apiLayer,
  (line) => line.includes("条因不在启用清单里被跳过"),
  "检索范围必须包含「因不在启用清单里被跳过」的条数"
);
// 批次卡片要标明归属：发布是逐条带 kbId 的，卡片不显示，发布完就只能去知识库列表里反推。
kbHasLiveLine(apiLayer, (line) => line.includes("kbKnowledgeNameOf(run.kbId)"), "批次卡片必须标明这批归入哪个知识库");
// 面板每轮重绘都换掉 innerHTML：事件必须委托在容器上，逐行 addEventListener 会随重绘一起丢。
kbHasLiveLine(
  apiLayer,
  (line) => line.trim() === 'const knowledgeList = qs<HTMLElement>("#kbKnowledgeList");',
  "知识库面板的事件必须委托在容器上（行内按钮是每次重绘新建的）"
);
// 屏 1 的「这批成果归入哪个库」：不提供就等于每训一次多一个库，
// 同一份资料反复提炼（第一次失败、补内容再提）会把「选择默认知识库」那张清单彻底搞乱。
// 判据落在**真的提交了 kbId** 那一行上：只断言"有这个下拉"是抓不到"选了没发"的。
kbHasLiveLine(
  apiLayer,
  (line) => line.includes("...(targetKbId ? { kbId: targetKbId } : {})"),
  "屏 1 选中的归属知识库必须真的提交，否则选了等于没选"
);
kbHasLiveLine(
  apiLayer,
  (line) => line.includes("kbKnowledgeSorted().filter((item) => item.isOwner)"),
  "归属目标只列自己的知识库：别人的库后端会 403，列出来只会让用户点了报错"
);
kbHasLiveLine(
  apiLayer,
  (line) => line.includes("!result.knowledgeBaseSync.ok"),
  "新建库后清单同步失败必须提示（否则运行端仍按旧清单出稿，界面却显示已启用）"
);

// 运行中必须能回答「还在跑吗」与「能不能停」：只有「运行中」三个字时，
// 用户分不清在跑还是卡死，而这两种情况的下一步完全相反（等 vs 停下重来）。
kbHasLiveLine(apiLayer, (line) => line.includes("批 · 已处理"), "运行中的批次必须显示批次级进度（第几批/共几批）");
kbHasLiveLine(apiLayer, (line) => line.includes("data-kb-run-cancel="), "运行中的批次必须有停止入口");
// 停止是「请求」不是「结果」：发出后按钮必须停在「正在停止…」而不是弹回可点状态，
// 否则用户会以为没生效、反复点，而它本来就要等当前这批跑完。
kbHasLiveLine(
  apiLayer,
  (line) => line.includes("正在停止…（等当前这批结束）"),
  "停止请求发出后必须显示等待态（否则用户会以为没生效）"
);
kbHasLiveLine(apiLayer, (line) => line.includes("data-kb-run-retry="), "失败/取消的批次必须能一键把资料填回来");
// 第一批在飞时进度必然为 0：一条钉在 2% 的条子和「卡死」无法区分，
// 必须切成不定长扫光并在文案里给出单批耗时，用户才敢决定「再等等」还是「停掉」。
kbHasLiveLine(
  apiLayer,
  (line) => line.includes("pendingFirstBatch ? \" is-pending\" : \"\""),
  "第一批未返回时必须切到不定长进度（0% 与卡死无法区分）"
);
kbHasLiveLine(
  apiLayer,
  (line) => line.includes("单批通常 1~2 分钟"),
  "不定长进度必须写明单批耗时（否则用户仍然只能猜）"
);
kbHasLiveLine(
  prototype,
  (line) => line.includes("animation: kbBarIndeterminate"),
  "不定长进度必须有扫光动画（否则是静止的 38% 色块）"
);
// 发布是确认之后的事：待确认的行不得渲染发布键（摆在那里就会有人点，点了必然被后端拒）。
kbHasLiveLine(
  apiLayer,
  (line) => line.includes('candidate.status === "approved" ? `<button class="btn primary" data-kb-act="publish"'),
  "发布键只给已确认的候选"
);
assert.match(prototype, /id="kbPipeline"/u, "知识库训练必须有流水线步骤条（这一屏最容易迷路）");
assert.match(prototype, /id="kbEntriesModal"/u, "知识库必须能展开查看已发布条目（否则「已发布 N 条」只是个数字）");
assert.match(prototype, /id="kbEntriesSearch"/u, "知识库条目必须可搜索");
kbHasLiveLine(apiLayer, (line) => line.includes("openKbKnowledgeEntries(open)"), "知识库卡片必须有查看条目的入口");
// 删除知识库：不可撤销，入口 + 二次确认缺一不可（只有创建者拿得到这个按钮，判据在后端）。
kbHasLiveLine(apiLayer, (line) => line.includes('data-kb-kb-delete="${id}"'), "知识库卡片必须有删除入口");
kbHasLiveLine(apiLayer, (line) => line.includes('title: "删除知识库"'), "删除知识库必须二次确认（不可撤销）");

// 前后端路由对齐：前端调了而后端没有 = 上线即 404。后端目录不在时跳过（前端可单独跑）。
let kbBackendServer = "";
try {
  kbBackendServer = readFileSync(new URL("../../backend/src/server.ts", import.meta.url), "utf8");
} catch {
  kbBackendServer = "";
}
if (kbBackendServer) {
  const kbRoutes: Array<[string, string]> = [
    ["post", "/api/kb/training/extract"],
    ["post", "/api/kb/training/runs"],
    ["get", "/api/kb/training/runs"],
    ["get", "/api/kb/training/runs/:id"],
    ["post", "/api/kb/training/runs/:id/cancel"],
    ["get", "/api/kb/training/candidates"],
    ["post", "/api/kb/training/candidates/review"],
    ["post", "/api/kb/training/candidates/publish"],
    ["post", "/api/kb/training/candidates/:id/revoke"],
    ["get", "/api/kb/training/knowledge-bases"],
    ["get", "/api/kb/training/knowledge-bases/:id/entries"],
    ["put", "/api/kb/training/knowledge-bases/defaults"],
    ["patch", "/api/kb/training/knowledge-bases/:id"],
    ["delete", "/api/kb/training/knowledge-bases/:id"],
    ["post", "/api/kb/training/probe"]
  ];
  kbRoutes.forEach(([method, path]) => {
    assert.ok(kbBackendServer.includes(`app.${method}("${path}"`), `后端缺少 ${method.toUpperCase()} ${path}`);
  });
  [
    "/api/kb/training/runs",
    "/api/kb/training/candidates/review",
    "/api/kb/training/candidates/publish",
    "/revoke",
    "/api/kb/training/knowledge-bases",
    "/api/kb/training/probe"
  ].forEach((fragment) => {
    kbHasLiveLine(apiLayer, (line) => line.includes(fragment), `前端工作台缺少对 ${fragment} 的调用`);
  });

  // 批次候选计数必须四态齐全：界面那行「待确认 / 已确认 / 已发布 / 已丢弃」按状态对齐，
  // 后端少给一态，界面对应的数字就恒为 0 —— 看起来像「还没确认过」，其实是没查。
  let kbRepoSource = "";
  try {
    kbRepoSource = readFileSync(new URL("../../backend/src/kb-training/kb-training-repository.ts", import.meta.url), "utf8");
  } catch {
    kbRepoSource = "";
  }
  if (kbRepoSource.includes("countCandidatesByRun")) {
    ["pending", "approved", "rejected", "published"].forEach((status) => {
      assert.ok(
        kbRepoSource.includes(`SUM(status = '${status}')`),
        `批次候选计数缺少 ${status} 一态（界面「已确认 / 已丢弃」这类数字会恒为 0）`
      );
    });
  }
}

// 动效必须由 TypeScript 驱动，且必须尊重 prefers-reduced-motion。
assert.match(tradeMotion, /export function prefersReducedMotion/, "动效模块必须提供系统降级判断");
assert.match(tradeMotion, /requestAnimationFrame/, "计数动画必须用 requestAnimationFrame 驱动");
assert.match(tradeMotion, /Element\.prototype\.animate|element\.animate|\.animate\(/, "入场动效必须用 WAAPI 由 JS 编排");
assert.match(tradeMotion, /playedSignature/, "同一份市场数据不得在轮询重渲染时重播入场动效");
assert.match(tradeMotion, /svg\.replaceChildren\(\)/, "航线层每次重绘必须清空，避免路径叠加");
assert.equal(/@keyframes\s+mhStamp/.test(themeCss), false, "唛头入场不得退回 CSS keyframes");
assert.equal(/animation:\s*mhStamp/.test(themeCss), false, "唛头入场不得退回 CSS animation");

// 系统后台「控制台」：状态带与授权矩阵带的工程约束
assert.match(adminDeck, /organizations|organization-structure/, "后台控制台必须覆盖组织架构页");
assert.match(adminDeck, /\.main > \.workspace > \.view\.active, \.main > \.view\.active/, "后台视图分布在 workspace 与 main 两处，必须都能命中");
assert.match(adminDeck, /rails\.slice\(1\)/, "状态带每次只允许存在一条，重复插入必须清理");
assert.match(adminDeck, /head\.nextElementSibling !== existing/, "状态带位置必须紧随页首（首次渲染早于页首时要搬正）");
assert.match(adminDeck, /SCOPE_LEVELS/, "授权范围必须映射成可读刻度");
assert.match(adminDeck, /select\.addEventListener\('change'/, "改授权范围必须即时更新仪表与读数");
assert.match(adminCss, /\.kd-rail-cell\[data-tone="danger"\]/, "状态带必须能用信号色表达危险");
assert.match(adminCss, /--deck: #101315/, "后台必须是独立于业务区的深色甲板");

// 左侧导航：二级菜单没有图标，标签不能被排进图标列；导航必须能滚动到底
assert.match(themeCss, /\.nav button\.nav-secondary-button \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto/, "二级菜单必须单列+计数列，避免标签被截断");
assert.match(themeCss, /\.nav \{[^}]*display: block/, "导航必须是块级流：grid 会压缩行高导致 scrollHeight 失真、底部菜单切掉且无法滚动");

// 跟进船期表：只用真实到期日，四段归位，且能跳回待办
assert.match(timetable, /const DAYS = 7/, "船期表固定七天");
assert.match(timetable, /dueDay\.getTime\(\) < today\.getTime\(\)/, "早于今天的待办必须进逾期闸口，不能混入日列");
assert.match(timetable, /未排期/, "没有到期日的待办必须单独归入未排期，不得编造时间");
assert.match(timetable, /data-todo-id/, "排期事件必须带真实待办 id");
assert.match(timetable, /\.todo-row\[data-todo-id=/, "点击排期必须能定位回待办中心的具体行");
assert.match(prototype, /id="kdBoardTrack"/, "工作台必须提供船期表容器");
assert.match(themeCss, /\.kd-day\.is-today \{[\s\S]*background: var\(--ink\)/, "今天必须是唯一的墨底列（页面焦点）");

console.log(JSON.stringify({ ok: true, checked: required.length }, null, 2));
