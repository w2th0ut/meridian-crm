# 客多多 CRM 适配阿里云客服外呼方案（PR-0）

查阅日期：2026-10-31。本文只做调研和方案，不包含功能代码，也没有调用任何阿里云接口。

证据规则：产品能力、接口名、参数和字段只采用阿里云帮助中心（help.aliyun.com）或 OpenAPI 门户（api.aliyun.com）已打开页面上的原文。页面没写的内容标「待核实」，不补猜。客多多侧的开关、加密、抑制和跟进设计依据本仓库现有代码，并标明文件。

本场景的硬约束：人工坐席、由人点击触发外呼、不自动群呼。

## 1. 产品选型

对比的是两套官方产品，不是现有 `backend/src/telephony/provider.ts` 里混用的语音服务。

| 维度 | 云联络中心 CCC（推荐 API `2020-07-01`） | 智能外呼机器人 OutboundBot（API `2019-12-26`） |
| --- | --- | --- |
| 产品定位 | 坐席工作台、呼入呼出、IVR、录音、技能组。坐席用电脑、耳机和网络接打电话。 | 机器人按任务和名单自动外呼，含话术、重拨、并发和时间窗口。 |
| 人工点击外呼 | `MakeCall`：被叫可以是内部坐席，也可以是外部客户。坐席工作台 SDK 的 `call()` 返回值参考 `MakeCall`。 | 主路径是 `CreateJobGroup` 创建任务组，再 `AssignJobs` 批量提交号码，由调度系统拨打。 |
| 是否会自动群呼 | 预测式外呼 API 存在（见第 2 节）。不用这些 API 就不会变成群呼。 | 任务可以定时启动、按优先级抢并发、按策略重拨。这就是自动群呼。 |
| 坐席嵌入 | 官方软电话 SDK，可嵌进自有 Web 系统，并用来电回调做弹屏。 | 功能清单的主体是机器人、名单和报表。转人工是对话策略，不是业务员在 CRM 里点一个客户就打。 |
| 结果回传 | Webhook、RocketMQ 4、RocketMQ 5。 | 文档写的是 RocketMQ（4.0 / 5.0 / Serverless）。 |

来源：

- CCC 产品构成与集成方式：<https://help.aliyun.com/zh/ccs/service-architecture>
- CCC 使用方式（电脑 + 耳机 + 网络；不支持试用）：<https://help.aliyun.com/zh/ccs/usage-notes>
- CCC OpenAPI 版本：<https://help.aliyun.com/zh/ccs/cccai/use-openapi>
- `MakeCall`：<https://help.aliyun.com/zh/ccs/developer-reference/api-ccc-2020-07-01-makecall>
- 工作台 SDK 3.x：<https://help.aliyun.com/zh/ccs/cccai/use-cases/ccc-sdk-frontend-access-3>
- OutboundBot 调用方式：<https://help.aliyun.com/zh/ccs/outbound-bot/developer-reference/call-method>
- OutboundBot 快速集成（任务组、名单、RocketMQ）：<https://help.aliyun.com/zh/ccs/outbound-bot/developer-reference/quick-integration>
- OutboundBot 功能清单：<https://help.aliyun.com/zh/ccs/function-list>
- `CreateJobGroup`：<https://help.aliyun.com/zh/ccs/outbound-bot/developer-reference/api-outboundbot-2019-12-26-createjobgroup>
- `AssignJobs`：<https://help.aliyun.com/zh/ccs/outbound-bot/developer-reference/api-outboundbot-2019-12-26-assignjobs>

**推荐云联络中心 CCC，API 版本用 `2020-07-01`。** 不把智能外呼机器人当作本场景的拨号产品。

理由：

1. 本场景要的是人工坐席。CCC 的坐席和控制台就是为接听、拨打设计的；OutboundBot 的集成步骤是创建任务、上传名单、等调度结果。
2. 本场景要人点击一次、打一通。CCC 的 `MakeCall` 和 SDK `call()` 是单次呼叫。OutboundBot 的 `AssignJobs` 一次最多提交 99 条作业，交给外呼调度。
3. 本场景禁止自动群呼。CCC 上的预测式外呼可以不调用。OutboundBot 的定时、重拨和并发是产品主路径，接进来就会变成群呼。
4. `StartJob` 的官方说明是「不经过外呼调度系统直接发起呼叫。该接口只针对白名单用户开放」。它仍然是智能外呼的作业接口，不是坐席工作台，也不作为本方案的拨号接口。来源：<https://help.aliyun.com/zh/ccs/outbound-bot/developer-reference/api-outboundbot-2019-12-26-overview>

`StartBack2BackCall` 是 CCC 上的双呼：中间号码先呼叫主叫，接通后再呼叫被叫。官方说明它可用于没有坐席工作台的 APP 或小程序。它不是预测式群呼，但本场景的业务员已经在 Web CRM 里，优先用工作台 `call()` / `MakeCall`，让坐席在浏览器里通话。双呼只作为「坐席不在浏览器、改打手机」的备选，而且仍然必须由人点击，不能放进定时任务。来源：<https://help.aliyun.com/zh/ccs/developer-reference/api-ccc-2020-07-01-startback2backcall>，<https://help.aliyun.com/zh/ccs/usage-notes>，<https://help.aliyun.com/zh/ccs/support/faq-about-consultation>。

不在本方案范围内的产品：

- 语音服务 Dyvmsapi（`SingleCallByTts` 等）。现有话机代码会在没有技能组时走到这条路径。那是语音通知，不是人工坐席。
- 智能联络中心 AICCS（`2019-10-15`）。另一套机器人外呼产品，本场景不选。
- 智能语音导航 VoiceNavigator（页面上出现过 `2025-11-11` 的订阅接口）。不是本方案的拨号 API。

## 2. OpenAPI

### 2.1 版本、地域和认证

CCC 版本以官方表为准：`2020-07-01` 推荐，`2020-05-27` 和 `2017-07-05` 不推荐。接口风格是 RPC。官方推荐阿里云 SDK 和 CLI，不支持资源编排和 Terraform；自签请求见「自定义 HTTP 封装」。来源：<https://help.aliyun.com/zh/ccs/cccai/use-openapi>，产品概述：<https://help.aliyun.com/zh/ccs/developer-reference/api-ccc-2020-07-01-overview>。

CCC `2020-07-01` 已列出的接入点：

| 地域 | 地域 ID | 公网 | VPC |
| --- | --- | --- | --- |
| 华东 2（上海） | `cn-shanghai` | `ccc.cn-shanghai.aliyuncs.com` | `ccc-vpc.cn-shanghai.aliyuncs.com` |
| 华东 1（杭州） | `cn-hangzhou` | `ccc.cn-hangzhou.aliyuncs.com` | 官方表该格为空 |

来源：<https://help.aliyun.com/zh/ccs/cccai/api-ccc-2020-07-01-endpoint>。杭州 VPC 地址、以及除这两地以外的地域：**待核实**。接入点必须按实例所在地域填写，不能从实例 ID 的前缀拼域名。

OutboundBot 调用方式页写的接入点是 `outboundbot.cn-shanghai.aliyuncs.com`，版本 `2019-12-26`，RPC。来源：<https://help.aliyun.com/zh/ccs/outbound-bot/developer-reference/call-method>。其他地域：**待核实**。本方案不接这套 API。

认证：

- 使用 RAM 用户的 AccessKey，不用主账号 AccessKey。AccessKey 由 AccessKey ID 和 AccessKey Secret 组成，Secret 只在创建时显示一次。来源：<https://help.aliyun.com/zh/ram/support/faq-about-accesskey-pairs>。
- CCC 的 RAM 代码是 `ccc`，授权粒度是操作级。官方写明不能在 `Resource` 里写 ARN，要授权就写 `"Resource": "*"`。操作表在查阅当日是「暂无数据」。`MakeCall`、`GetCallDetailRecord`、`GetMonoRecording`、`ListUsers`、`CreateUser`、`UpdateSubscription` 等页都写着「当前 API 暂无授权信息透出」。因此 **CCC 每个 API 对应的 RAM Action 字符串待核实**，本文不编造 `ccc:MakeCall` 这类名字。来源：<https://help.aliyun.com/zh/ccs/developer-reference/api-ccc-2020-07-01-ram>。
- 系统策略 `AliyunCCCReadonlyAccess` 是只读。官方建议 OpenAPI 使用自定义策略，按需授权，而不是把产品系统策略当作最小权限。来源：<https://help.aliyun.com/zh/ccs/security-and-compliance/ccc>。只读策略不够发起呼叫。
- 签名：CCC 产品概述写明 OpenAPI 采用 RPC 签名风格，并建议优先用官方 SDK，自签要按签名机制做。RPC V2 的公共参数是 `Action`、`Version`、`AccessKeyId`、`SignatureNonce`、`Timestamp`（ISO 8601 UTC）、`SignatureMethod=HMAC-SHA1`、`SignatureVersion=1.0`、`Signature`，`Format` 可选 JSON。同一页写明 **不再推荐 V2，推荐 V3**。来源：<https://help.aliyun.com/zh/sdk/product-overview/rpc-mechanism>。V3 的具体章节 URL 以该页指向的 SDK 文档为准，本文不另引未打开的地址。实现时优先官方 SDK，由 SDK 处理签名；不要把仓库里现有的手写 HMAC-SHA1 当成合同。
- STS 临时凭证是 RAM 文档推荐的无 AK 方式。CCC 坐席工作台若改走 STS 或 OAuth2，端点和 scope **待核实**。SDK 2.x 页只说转发可以用 AK/SK 或 OAuth2，没有在本文引用的页面给出授权地址。来源：<https://help.aliyun.com/zh/ccs/cccai/use-cases/sdk-frontend-access>，<https://help.aliyun.com/zh/ccs/service-architecture>。本方案默认服务端保管 RAM 用户 AK，浏览器不持有密钥。

### 2.2 发起外呼

人点击、坐席在浏览器里通话，用 `MakeCall`。

| 参数 | 必填 | 官方说明 |
| --- | --- | --- |
| `InstanceId` | 是 | 实例 ID |
| `UserId` | 否 | 发起外呼的坐席 ID。不填则使用当前 RAM 账号映射的坐席 |
| `DeviceId` | 是 | 设备 ID。官方写明无意义，可以随便填写 |
| `Callee` | 是 | 外部呼叫时填客户号码；内部呼叫时填坐席分机 |
| `Caller` | 否 | 外部呼叫时必须是该坐席可用的外呼号码。使用权来自：号码绑到坐席已签入的技能组，或设为坐席个人外呼号码 |
| `TimeoutSeconds` | 否 | 30–300 秒，超时未接通则挂断 |
| `MaskedCallee` | 否 | 脱敏后的被叫，脱敏规则由客户自己定义 |
| `MediaType` | 否 | 默认 `AUDIO`，也可 `VIDEO` |
| `Tags` | 否 | 随路数据 |
| `FlashSmsVariables` | 否 | 闪信配置 |

成功时 `Data.CallContext.JobId` 是通话 ID，`CallType` 含 `OUTBOUND`。坐席状态不符时返回 `InvalidOperation.UserState`。来源：<https://help.aliyun.com/zh/ccs/developer-reference/api-ccc-2020-07-01-makecall>。

工作台 SDK 的 `call({ callee, caller, timeoutSeconds, maskedCallee, mediaType })` 与上述字段对应，返回值参考 `MakeCall`。来源：<https://help.aliyun.com/zh/ccs/cccai/use-cases/ccc-sdk-frontend-access-3>。

备选 `StartBack2BackCall` 的必填项是 `InstanceId`、`Caller`、`Callee`、`Broker`。`Broker` 是实例下可用的外呼号码。可选 `TimeoutSeconds`（默认 30）、`AdditionalBroker`、`Tags`。返回 `CallType=BACK2BACK` 和 `JobId`。来源：<https://help.aliyun.com/zh/ccs/developer-reference/api-ccc-2020-07-01-startback2backcall>。

`RedialCall` 用于重拨脱敏话单中的号码，SDK 的 `redialCall` 引用它。来源：API 概览 <https://help.aliyun.com/zh/ccs/developer-reference/api-ccc-2020-07-01-overview>，SDK 同上。

号码是否可外呼，用 `ListOutboundNumbersOfUser` 查询指定坐席的可外呼号码。来源：同上概览页。

### 2.3 查询通话记录和录音

单通详情：`GetCallDetailRecord`。必填 `InstanceId`、`ContactId`（通话 ID，示例形如 `job-...`）。

和 CRM 跟进直接相关、且已在该页核对的返回字段：

| 字段 | 含义 |
| --- | --- |
| `ContactType` | `INBOUND` 呼入，`OUTBOUND` 呼出，另有 `BACK2BACK`、`PREDICTIVE` 等 |
| `ContactDisposition` | 结束原因，含 `Success`、`NoAnswer`、`Reject`、`AbandonedInRing` 等 |
| `EarlyMediaState` | 未接通时的早媒体判断：`NoAnswer`、`Busy`、`PowerOff`、`OutOfService`、`NotExist`、`Restricted`、`NotConnected` |
| `CallDuration` | 整数，单位秒 |
| `EstablishedTime` / `ReleaseTime` / `StartTime` | Unix 毫秒。该页写：呼出的 `StartTime` 从接通开始计算；未建立则 `EstablishedTime` 为空 |
| `CallingNumber` / `CalledNumber` | 主叫 / 被叫 |
| `AgentIds` / `SkillGroupIds` | 逗号分隔 |
| `RecordingReady` | 录音是否已生成 |
| `ReleaseInitiator` | `agent` 或 `customer` |
| `ReleaseReason` | SIP 响应码加文字 |

来源：<https://help.aliyun.com/zh/ccs/developer-reference/api-ccc-2020-07-01-getcalldetailrecord>。

列表：用 `ListCallDetailRecordsV2`，不要用已停止迭代的 `ListCallDetailRecords`。必填 `InstanceId`、`PageNumber`（1–100）、`PageSize`（1–100）。可用 `StartTime` / `EndTime`（Unix 毫秒）、`ContactIdList`、`ContactTypeList`、`ContactDispositionList`、`EarlyMediaStateList`、`AgentId`、`CallingNumber`、`CalledNumber`、`Number` 过滤。`TotalCount` 只在第一页有值，其他页返回 0。

该页对时长的表述和 `GetCallDetailRecord` 不完全一致：V2 把 `CallDuration` 标成 string，并写「呼出从接通开始计时，单位秒」；同时把 `StartTime` 写成「外呼从拨号开始计算」。V2 另有 `TalkTime`（整数，秒）和 `RecordingDuration`（整数，秒）。**两页文案冲突，以哪一个计时口径为准：待核实。** 实现时同时保存原始字段，不自行折算后再覆盖原文。来源：<https://help.aliyun.com/zh/ccs/developer-reference/api-ccc-2020-07-01-listcalldetailrecordsv2>，旧接口说明见概览页。

最近通话：`ListRecentCallDetailRecords`，取当前 RAM 账号映射坐席的最近记录。来源：概览页。

录音：

| API | 用途 | 已核对的请求 | 已核对的返回 |
| --- | --- | --- | --- |
| `GetMonoRecording` | 坐席和客户合成一条音轨，WAV | 必填 `InstanceId`、`ContactId`；可选 `ExpireSeconds`（示例 300） | `FileUrl`、`FileName`、`Duration`。`Duration` 的单位在该页写的是毫秒。`FileUrl` 的说明又写「有效期为 1 天」 |
| `GetMultiChannelRecording` | 坐席和客户分声道，MKV | 参数表本文未逐项打开 | 概览页说明格式为 MKV |

`ExpireSeconds` 与「链接有效期 1 天」的关系 **待核实**。CRM 不把 `FileUrl` 当作永久地址，播放时按 `ContactId` 重新取。来源：<https://help.aliyun.com/zh/ccs/developer-reference/api-ccc-2020-07-01-getmonorecording>，多轨见概览页。

事件里的 `RecordingReady.downloadURL` 是 OSS 链接，同样会过期。落库以 `GetMonoRecording` 的回查结果为准。

### 2.4 坐席与用户

坐席和 RAM 用户是映射关系。`CreateUser` 会创建一个 RAM 子账号，并把初始密码发到 `Email`。必填：`InstanceId`、`LoginName`、`DisplayName`、`Email`、`RoleId`。`RoleId` 形如 `Agent@实例ID`、`Manager@实例ID`、`Admin@实例ID`。成功返回 `UserId`（示例 `agent@ccc-test`）和 `Extension`。来源：<https://help.aliyun.com/zh/ccs/developer-reference/api-ccc-2020-07-01-createuser>。

`ListUsers` 必填 `InstanceId`、`PageNumber`、`PageSize`（都是 1–100）。返回 `UserId`、`LoginName`、`DisplayName`、`Email`、`RamId`、`Extension`、`RoleId`、`WorkMode`、`PersonalOutboundNumberList`、`SkillLevelList`。来源：<https://help.aliyun.com/zh/ccs/developer-reference/api-ccc-2020-07-01-listusers>。

`ModifyUser` 可改电话、工作模式、角色和工号。`RemoveUsers` 只解除 RAM 与实例的映射，不删除 RAM 账号本身。`ListInstances` 取当前阿里云账号下的实例列表。来源：概览页 <https://help.aliyun.com/zh/ccs/developer-reference/api-ccc-2020-07-01-overview>。

本方案不在业务员保存 CRM 资料时自动调用 `CreateUser`。创建坐席会发出 RAM 密码邮件，只能作为管理员单独确认的动作。

### 2.5 外呼任务和名单

这些 API **存在**，本场景的点击外呼 **不调用它们**。

CCC 预测式外呼（版本仍是 `2020-07-01`）：`CreateCampaign`、`GetCaseFileUploadUrl`、`AddCases`、`AppendCases`、`SubmitCampaign`、`PauseCampaign`、`ResumeCampaign`、`AbortCampaign`、`UpdateCampaign`、`GetCampaign`、`ListCampaigns`、`ListCases`、`ListAttempts`。目录：<https://help.aliyun.com/zh/ccs/developer-reference/api-ccc-2020-07-01-dir-predictive-outcall/>。各接口的完整参数表本文没有逐页抄录；实现若要只读展示，先打开对应 API 页，缺的字段标待核实，不凭目录名补参数。

CCC 禁呼名单：`ListDoNotCallNumbers`、`ImportDoNotCallNumbers`、`GetDoNotCallFileUploadParameters`。来源：概览页。这是「不要打」的名单，不是拨号任务。

OutboundBot 任务：`CreateJobGroup`、`AssignJobs`（`JobsJson` 最多 99 条）、`QueryJobs`、`ListJobs`、`DescribeJob`、`DownloadRecording`（请求用 `TaskId`，返回 `DownloadParams.SignatureUrl`）、`QueryJobsWithResult`、`SearchTask`、`GetTaskByUuid`。来源：

- <https://help.aliyun.com/zh/ccs/outbound-bot/developer-reference/api-outboundbot-2019-12-26-overview>
- <https://help.aliyun.com/zh/ccs/outbound-bot/developer-reference/api-outboundbot-2019-12-26-queryjobs>
- <https://help.aliyun.com/zh/ccs/outbound-bot/developer-reference/api-outboundbot-2019-12-26-downloadrecording>

`Dialogue` 已废弃，不使用。来源：<https://help.aliyun.com/zh/ccs/outbound-bot/developer-reference/api-outboundbot-2019-12-26-dialogue>。

## 3. 事件回调

### 3.1 推送方式

CCC `UpdateSubscription` 的 `MqType` 只有三个取值：`rocketmq4`、`rocketmq5`、`webhook`。

| 方式 | 官方要求 |
| --- | --- |
| Webhook | `MqType=webhook`，`ProducerId=PID_Webhook`，`DefaultTopic=Topic_Webhook`，`AccessPoint` 填回调服务地址 |
| RocketMQ 5 | `MqType=rocketmq5`，要填 `Username`、`Password`、`MqInstanceId`，`AccessPoint` 为 MQ 接入地址，`DefaultTopic` 为 Topic，`ProducerId` 为 GroupId |
| RocketMQ 4 | `MqType=rocketmq4`，要填 `MqInstanceId`。控制台教程写明云联络中心使用的是 RocketMQ 4.0 |

`EventSubscriptionsJson` 是事件清单，元素为 `{ "Name": "<事件名>", "Disabled": true|false }`。来源：<https://help.aliyun.com/zh/ccs/developer-reference/api-ccc-2020-07-01-updatesubscription>，控制台步骤：<https://help.aliyun.com/zh/ccs/cccai/use-cases/how-to-enable-event-notification>。

消息服务 MNS：`UpdateSubscription` 的枚举里没有 MNS。MNS 自己的 HTTP 订阅签名（校验证书 URL、`Authorization`）是轻量消息队列的文档，不是 CCC 事件推送文档。CCC 是否会经 MNS 推送：**待核实**。在官方把 MNS 列进订阅类型之前，不把 MNS 当作本方案的通道。MNS 签名参考（仅在将来证实走 MNS 时才适用）：<https://help.aliyun.com/zh/mns/developer-reference/topic-message-http-subscription-signature>。

CCC `2020-07-01` 概览页没有名为 `GetSubscription` 的接口。查阅当日只看到 VoiceNavigator `2025-11-11` 的 `GetSubscription`，那不是 CCC 拨号产品。如何用 API 读回 CCC 当前订阅：**待核实**。配置以 `UpdateSubscription` 的返回和实例控制台为准。

OutboundBot 的完成态通知是购买的 RocketMQ，不是本方案要接的通道。消息类型见下。来源：<https://help.aliyun.com/zh/ccs/outbound-bot/developer-reference/quick-integration>。

客多多已有 HTTP Webhook 入口，第一期接 CCC Webhook。RocketMQ 作为同一批事件的替代投递，不在第一期实现。

### 3.2 事件类型

事件格式页的公共字段是 `eventTime`、`eventType`、`instanceId`。话务类事件还有 `contactId`、`channelId`、`callType`、`caller`、`callee`。来源：<https://help.aliyun.com/zh/ccs/use-cases/event-notification-formats>。

本场景要订阅、且该页有定义的事件：

| 需求 | 官方事件 | 已核对的特有字段 |
| --- | --- | --- |
| 振铃 | `Ringing` | `agentId`、`destination`、`skillGroupId`、`scenario`、`tags`。坐席侧另有 `AgentRinging` |
| 接通 | `Established` | `agentId`、`skillGroupId`、`scenario`、`tags` |
| 挂断 | `Released` | `releaseInitiator`、`releaseReason`、`earlyMediaState`（`NoAnswer`、`Busy`、`PowerOff`、`OutOfService`、`NotExist`、`Restricted`、`NotConnected`）、`earlyMediaText` |
| 录音就绪 | `RecordingReady` | `startTime`、`endTime`、`duration`（秒；坐席和客户都参与才生成）、`agentIds`、`fileName`、`downloadURL` |
| 话单 | `CDRReady` | `startTime`、`establishedTime`、`endTime`、`dispositionCode`（含 `Success`、`NoAnswer`、`Reject`、`AbandonedRing` 等）、`agentIds`、`skillGroupIds` |
| 来电 | 没有单独名为「来电」的事件 | 用 `callType=INBOUND` 的 `Ringing` / `AgentRinging` / `Established` 表示。`callType` 的枚举包括 `INBOUND`、`OUTBOUND`、`BACK2BACK`、`PREDICTIVE` |

同页还有 `Dialing`、`AgentDialing`、`DualTrackRecordingReady` 等。`UpdateSubscription` 示例里的清单更长（排队、转接、预测式活动状态等）。第一期只启用上表这些，其余保持 `Disabled: true`。预测式活动事件（`CampaignSubmitted` 等）不启用，避免被误接成自动拨号。

OutboundBot 的 MQ 事件（本方案不接）：`JobComplete`、`Dialing`、`CallAnswered`、`CallFinished`、`LabelReady`、`RecordingReady`。来源：快速集成页。

Webhook 的 HTTP 方法、Content-Type、重试次数和成功状态码，事件格式页和 `UpdateSubscription` 页都没有写。**待核实**。实现前用控制台测试推送确认，不在代码里假设是 POST JSON 或 200。

### 3.3 验签

CCC 事件格式页的字段里没有签名。`UpdateSubscription` 也没有密钥或签名算法参数。页面上另有一篇「API 签名机制」，算的是 `x-dmpaas-signature`，对象是全局服务的 HTTP 调用，不是 CCC 事件推送。来源：<https://help.aliyun.com/zh/ccs/support/untitled-document-1699584702690>。

结论：**官方文档没有给出 CCC 事件 Webhook 的验签方法。** 不能写成「阿里云会带 HMAC」。

在官方补上验签之前，入站请求按下面三条一起做。三条都过了才写通话记录和跟进。

1. 共享密钥。`AccessPoint` 使用只在加密私有设置里保存的路径令牌，例如 `https://<crm主机>/api/telephony/aliyun-events/<token>`。用恒定时间比较。令牌不是阿里云颁发的签名，只是回调地址的一部分。
2. 回查 API。把 body 只当作线索。用其中的 `instanceId` 与本地配置比较，不一致直接拒绝。再用 `GetCallDetailRecord(InstanceId, ContactId)` 核对通话确实存在，跟进里的时长、结果、号码以回查结果为准，不用事件正文覆盖。录音再调 `GetMonoRecording`。回查失败只记拒绝审计，不生成跟进。
3. IP 白名单。事件推送文档没有公布 CCC Webhook 的出口网段。**出口 IP 待核实，本文不写任何 IP。** 阿里云给出网段后再加到反向代理。白名单不能代替回查。

仓库已有 `verifyHmacWebhookSignature`（`backend/src/integrations/integration-webhook.ts`）：请求头 `t=<unix秒>,v1=<64位hex>`，HMAC-SHA256 的原文是 `时间戳.nonce.` 加原始 body，默认 300 秒窗口，比较用 `timingSafeEqual`。阿里云事件推送没有这个头，所以不能要求 CCC 按这个格式签名。这个函数只用于两种后续情况：官方后来规定了可映射的签名，或我方自己的网关在转发前签名。第一期的 CCC 入口不把「缺少 v1 头」当成可以跳过；缺少官方签名时，必须仍然通过路径令牌和回查。

第三方 IM 渠道那套 `sha1(时间戳 + secretKey + contactId)` 再 Base64 的算法属于另一个接入文档，不用于语音事件。来源：<https://help.aliyun.com/zh/ccs/third-party-access-channels>。

## 4. 坐席工作台嵌入与来电弹屏

官方集成方式是把软电话做成 JS 组件嵌进 CRM，不是给一个可单独登录的 iframe 页面 URL。若组件被放进 iframe，iframe 要加 `allow="microphone; camera; autoplay"`。业务系统必须是 HTTPS。浏览器要求 Chrome 72 及以上。查阅当日 3.x 文档写的版本是 workbench `3.8.1`、IM SDK `1.8.1`；2.x 文档写明最新能力以 3.x 为准。实现时重新打开该页核对版本号再固定，不把 `3.8.1` 写死成永久值。

初始化形态：`new CCCWorkbenchSDK({ dom, instanceId, ajaxPath, ... })`。`ajaxPath` 指向客多多自己的后端。SDK 的请求由后端转成 CCC OpenAPI，再把 JSON 透传回去。密钥只留在后端。来源：<https://help.aliyun.com/zh/ccs/cccai/use-cases/ccc-sdk-frontend-access-3>，集成目录：<https://help.aliyun.com/zh/ccs/use-cases/agent-workbench-integration/>。

和弹屏、拨号有关的回调（均来自 3.x 文档）：

| 回调 | 作用 |
| --- | --- |
| `onCallComing` | 来电。`event.caller` 主叫，`event.callee` 被叫，`event.jobId` 通话 ID，`event.callType` 呼叫类型，`event.callContext` 参考 `PollUserStatus` |
| `onCallDialing` | 去电振铃，字段同上 |
| `onCallEstablish` / `onCallRelease` | 接通 / 挂断 |
| `onBeforeCallDialing` | 调用 `call` 之前。文档要求必须执行 `payload.callback()`，否则电话不会拨出。可以改写 `callee` |
| `call` | 拨打。参数见第 2.2 节 |

`PollUserStatus` 的返回结构文档要求参考该 API。本文没有逐字段打开 `PollUserStatus` 页，`callContext` 里除 SDK 已点名的 `caller`、`callee`、`jobId`、`callType` 之外的字段 **待核实**。

来电匹配顺序（客多多侧，不是阿里云规则）：

1. `jobId` 命中本系统已经记下的外呼尝试，直接打开那条客户、线索或候选。
2. 否则用来电的 `caller`（`callType=INBOUND`）或去电的 `callee` 做号码匹配。比较前去掉空格和常见分隔符。是否去掉国家码 `86`，与库里现有号码的存储格式一起在实现 PR 用真实样例核对，不在这里规定一种未经验证的归一化。
3. 匹配面：`Customer.phone`、`Lead.phone`、候选联系方式里 `channelType === "phone"` 的 `channelValue`（`backend/src/types.ts`）。只匹配当前登录人按现有可见范围能看到的记录。
4. 多条命中时列出选择，不自动改负责人，不新建线索。
5. 没有命中时弹屏只显示号码和「未匹配」。不创建客户、线索或候选，不调用 `convert_to_lead`，不写入 `approved_contactable`。

点击外呼若走 SDK，门禁放在 `onBeforeCallDialing`：服务端拒绝时不调用 `payload.callback()`，电话就不会拨出。这符合官方「不调用 callback 则不拨号」的说明。

## 5. CRM 侧设计

现有话机在 `backend/src/telephony/` 和 `frontend/src/telephony.ts`，导航是「话机（可选）」。它已经有通话记录、录音目录和模拟器。本方案不把那条模拟器链路改成自动云外呼，也不沿用它现在的阿里云请求形状（见第 6 节差距）。

### 5.1 一键外呼出现在哪

客户页、线索页、候选页各加一个外呼动作。号码来源：

- 客户：`Customer.phone`
- 线索：`Lead.phone`
- 候选：`channelType === "phone"` 的 `channelValue`

没有号码就不显示动作。功能开关关闭时，按钮不发起请求。

### 5.2 拨号前的门禁

每一次点击按这个顺序，任何一步失败都只记审计，不调用 `MakeCall`，也不调用 SDK `callback()`。

1. 功能开关必须为开。默认关。
2. 权限沿用现有可见范围：业务员只能拨自己能看到的客户、线索和候选；管理员范围不在本方案放宽。
3. 抑制名单。候选侧复用 `setProspectSuppression`（`backend/src/prospect-qualification-workflow.ts`）已经写下的抑制和退订。号码或候选仍在抑制中则拒绝。客户和线索如果能关联到仍被抑制的候选或号码，同样拒绝。本方案不新增「解除抑制」入口。
4. 候选页还要满足现有可联系决定：该电话渠道上当前、未过期的决定仍是 `approved_contactable`（`backend/src/prospect-follow-up.ts` 已有这个只读判断）。外呼不修改这个状态。
5. 不调用 `convertProspectToLead`，不改 `convert_to_lead`。通话结束也不自动转入线索。
6. 坐席映射存在，且该 CRM 用户对应的 CCC `UserId` 已配置。没有映射就拒绝，不用公司共用 AK 去「默认坐席」代拨。`MakeCall` 不填 `UserId` 时会落到当前 RAM 账号映射的坐席，所以代拨必须显式传映射后的 `UserId`。该 RAM 用户是否被允许为其他 `UserId` 发起 `MakeCall`：**待核实**（授权信息页没有给出 Action）。接通清单里把这项列为上线前确认。
7. 通过后写一条外呼审计，再允许拨号。

现有话机的周期回访定时器（`docs/DESIGN.md` 所述约 60 秒下发）不得在开关打开后调用真实云接口。真实拨号只有人点击这一条路。

### 5.3 审计

跟进审计 `appendFollowUpAudit`（`backend/src/follow-up-audit.ts`）只在成功写下跟进时记录，失败和无权不记。所以「每次外呼」需要单独的拨号审计，包括被拒绝的点击。字段沿用现有审计的最小集合：操作人、时间、对象类型和 ID、动作、结果（允许或拒绝）和拒绝原因。不记录 AccessKey，不把密钥写进日志。

对象类型第一期覆盖客户、线索、候选。`FollowUpAuditEvent` 目前的对象类型只有 `prospect_candidate` 和 `customer`，线索跟进仍走 `LeadActivity`。拨号审计若要包含线索，在实现 PR 扩展类型，不塞进跟进审计里冒充「已写跟进」。

### 5.4 回调如何落通话记录和跟进

通话详情继续用现有 `CallRecord`（`backend/src/telephony/types.ts`）：方向、状态、`providerCallId`（存 `JobId` / `contactId`）、客户或线索 ID、号码、坐席、开始和结束时间、时长、录音引用、失败原因。

跟进不另做平行表：

- 客户：`CustomerActivity`，`type` 已有 `"call"`
- 线索：`LeadActivity`，`type` 已有 `"call"`
- 候选：现有 `LeadActivity.prospectCandidateId`，转入线索前 `leadId` 可空

一条通话只创建一条跟进。`Released` 或 `CDRReady` 第一次到达时创建，并调用一次 `appendFollowUpAudit`。随后的 `RecordingReady` 只更新同一条通话和同一条跟进的录音与时长，不再插入第二条跟进，也不再追加跟进审计。

跟进正文只写回查得到的结果：`ContactDisposition`、`EarlyMediaState`、`CallDuration`（保留原始单位说明）、坐席 `UserId`。录音不把 OSS 临时 URL 当作唯一存档；保存 `ContactId`，播放时走服务端 `GetMonoRecording`。是否把文件下载到现有 `/uploads/telephony`，留到实现 PR，测试用假 URL，不下载阿里云对象。

### 5.5 幂等

| 键 | 规则 |
| --- | --- |
| 拨号尝试 | CRM 生成的 UUID。同一次点击重试不产生第二通云呼叫 |
| 通话 | `instanceId + contactId` 唯一。重复的 `MakeCall` 响应只更新这一条 |
| 事件 | `instanceId + contactId + eventType + eventTime`。同一事件再送不新建记录 |
| 跟进 | 每个 `contactId` 至多一条 `type=call` 的活动 |

事件先落原始报文（不含密钥），回查成功后再改业务状态。回查超时保持「待核对」，不把事件里的时长写成最终结果。

### 5.6 来电弹屏

见第 4 节。弹屏只读匹配，不写可联系决定，不转线索。

### 5.7 外呼任务名单同步

允许的同步只有方向「不要打」：

- 管理员在开关打开后，手工确认，把 CRM 抑制号码同步到 CCC `ImportDoNotCallNumbers`。同步失败不影响 CRM 自己的拨号前检查，CRM 检查仍然生效。
- 控制台里已经存在的预测式活动，可以用 `ListCampaigns` / `ListCases` 只读展示。不提供 `SubmitCampaign`、`ResumeCampaign`、`AddCases` 按钮。

不允许的同步：把客户、线索或候选推进 `CreateCampaign`、`AddCases`、`AppendCases`，或推进 OutboundBot 的 `CreateJobGroup` / `AssignJobs`。那是自动群呼。

### 5.8 坐席与 CRM 用户

映射表：CRM 用户 ID、CCC `UserId`、`LoginName`、分机 `Extension`、工作模式。管理员从 `ListUsers` 的结果里选择，不手填未核对的 ID。一个 CRM 用户只对应一个 `UserId`。业务员只能使用映射到自己的坐席。`CreateUser` 不进默认流程。

## 6. 安全硬规与现有机制

| 硬规 | 做法 |
| --- | --- |
| 功能开关默认关闭 | 与官网线索入口相同：缺文件即关闭，`enabled` 只有显式 `true` 才算开。见 `backend/src/website-lead-ingress-settings.ts` 的 `EMPTY_SETTINGS.enabled = false` |
| AK/SK 只进加密私有设置 | 公司级凭证放 `backend/.data/private/aliyun-ccc.enc.json`，密钥文件放同目录且不进仓库。沿用该模块的 AES-256-GCM、AAD、`0o600`、原子替换。发布脚本已把 `backend/.data/private` 链到 `shared/private`，新版本读得到旧设置。现有 `telephony_settings` 把 `aliyunAccessKeySecret` 放在 MySQL payload 里，接口虽不回显，但那不是这套加密存储。后续 PR 把库里的密钥迁出并清空，读接口继续只返回是否已配置 |
| 按集成连接存的附属密钥 | 若某团队要把回调令牌放到集成连接上，用 `encryptIntegrationValue`（`backend/src/integrations/integration-credential-vault.ts`）：AES-256-GCM，主密钥来自 `INTEGRATION_CREDENTIAL_KEY`（至少 32 字符），AAD 绑定 `teamId`、`ownerId`、`connectionId`、`artifactType`，密文 `v1.<iv>.<tag>.<ciphertext>`。公司级 AK 不以明文环境变量或仓库文件存在 |
| 回调必须验签 | 官方没有 CCC Webhook 验签时，按第 3.3 节执行路径令牌、实例比对和 `GetCallDetailRecord` 回查。不能以「官方没签名」为由接受任意 POST |
| CI 和测试全部 mock | 测试注入假的 CCC 客户端，断言没有向 `aliyuncs.com` 发起连接。不使用真实实例 ID 拨号。现有 `SimulatorProvider` 可以继续承担无凭证演示，但不能在测试里被换成真实 `fetch` |
| 只允许人点击 | 不调用预测式外呼和 OutboundBot 任务 API。周期回访定时器不进入真实云分支 |
| 不放宽合规门禁 | 不改 `approved_contactable` 的批准条件，不改 `convert_to_lead`，不提供解除抑制。外呼是额外检查，不是旁路 |

仓库现状和官方合同不一致的地方，后续 PR 要改掉，不能当接口样例：

- `AliyunProvider` 的域名用实例 ID 第一个 `-` 前的片段拼接 `.aliyuncs.com`。实例 `ccc-test` 会变成 `ccc.aliyuncs.com`。官方接入点是 `ccc.cn-shanghai.aliyuncs.com` 或 `ccc.cn-hangzhou.aliyuncs.com`。
- 代码调用 `StartBack2BackCall` 时传了 `ExtraExtensionId`，没有传官方必填的 `Broker`。
- 没有技能组时改调 Dyvmsapi `SingleCallByTts`。那不是本方案的产品。
- 代码用 `TalkTime`、`RecordingUrl` 等字段理解 CCC 详情。官方单通详情页的时长字段是 `CallDuration`，录音要另调 `GetMonoRecording` 取 `FileUrl`。

健康检查若需要，官方有 `ListInstances`。现有代码已经调用了这个名字；是否在无实例权限时适合作为探活，等授权 Action 核实后再定。探活也不允许在 CI 里打到公网。

## 7. PR 拆分

共 6 个 PR。PR-0 是本文。每个实现 PR 都默认开关关闭、测试使用 mock、不拨真实电话、不改抑制和转线索门禁。

### PR-0 调研（本 PR）

范围：只新增本文。

验收：文档中的接口名都能在文内链接打开；待核实项没有被写成已证实；`verify-scripts` 和 `build` 在该提交上通过；不部署。

### PR-1 开关与加密配置

范围：私有加密设置（地域、实例 ID、主叫号码、AK、回调令牌），默认关闭；管理接口只回「已配置」；把已落在 `telephony_settings` 里的密钥迁出并清空。不提供拨号按钮，不注册公网回调。

验收：缺文件时开关为关；响应和日志不含 Secret；密钥文件权限为 `0600`；测试不访问阿里云；现有话机模拟器仍可用。

### PR-2 拨号门禁与 mock 契约

范围：服务端「请求外呼」用例。mock 客户端的入参对齐 `MakeCall` 的必填字段（`InstanceId`、`DeviceId`、`Callee`，以及映射得到的 `UserId`）。拒绝路径覆盖：开关关闭、无权限、抑制、候选缺少 `approved_contactable`、无坐席映射。写拨号审计。定时回访不进入该用例。

验收：上述拒绝都不产生通话记录；允许时 mock 返回假的 `JobId` 且网络层未被调用；`convert_to_lead` 和抑制状态与拨号前一致；现有话机测试仍通过。

### PR-3 三个页面的一键外呼

范围：客户、线索、候选页的按钮。先走 PR-2 的服务端用例，允许后再调 SDK `call()` 或明确的服务端 `MakeCall` mock。`onBeforeCallDialing` 在服务端拒绝时不调用 `callback()`。

验收：无号码不显示；开关关闭不发请求；三页的允许和拒绝都能在界面上看到原因；移动和桌面宽度下按钮不挡住现有主操作。浏览器验证这三页，而不是只看单张截图。

### PR-4 回调、通话记录和跟进

范围：Webhook 入口。校验路径令牌和实例 ID；mock 回查 `GetCallDetailRecord` 和 `GetMonoRecording`；幂等写入 `CallRecord` 和一条 `call` 跟进；重复事件不新增跟进。

验收：伪造实例 ID、错误令牌、回查失败都不写跟进；同一 `contactId` 的 `Released` 与 `RecordingReady` 只留下一条跟进和一条跟进审计；测试不下载 OSS。

### PR-5 坐席映射、工作台和弹屏

范围：管理员从 mock 的 `ListUsers` 绑定 CRM 用户；开关打开时嵌入工作台容器（测试不加载 `g.alicdn.com`）；`onCallComing` 按第 4 节匹配。只读展示 mock 的活动列表，并提供一次需人工确认的抑制号码导出形状（对齐 `ImportDoNotCallNumbers` 的存在性，参数在实现时打开官方页核对）。不提供启动活动的操作。不调用 `CreateUser`。

验收：未映射用户不能外呼；来电命中、多条命中、未命中三种界面正确；未命中不新建线索；活动列表没有提交或恢复按钮；测试无外网请求。

PR-5 之后才讨论真实接通。真实接通仍是单独的人工配置，不随代码合并自动打开开关，也不走部署流水线拨测。

## 8. 真实接通清单

代码合并不会开通通话。上线前由使用方提供下面各项。标「待核实」的项要在阿里云控制台或更新后的官方页确认，不能用本文填上。

| 项 | 要提供的内容 |
| --- | --- |
| 产品 | 已开通的云联络中心实例，不是智能外呼机器人实例。官方写明云联络中心不支持试用 |
| 实例 ID | 控制台中的实例 ID，示例形态 `ccc-test`，以实际为准 |
| 地域 | `cn-shanghai` 或 `cn-hangzhou`，并确认与实例一致。对应公网域名见第 2.1 节。若实例在其他地域：待核实 |
| API 版本 | 确认实例可用 `2020-07-01`，不使用 `2017-07-05` |
| RAM 用户 | 专用于客多多的 RAM 子账号，不要主账号 AccessKey。提供 AccessKey ID。Secret 只通过加密配置写入服务器，不写进工单、仓库和聊天记录 |
| 最小权限 | 查阅当日官方没有公布 CCC API 的 Action 列表。在 RAM 控制台生成只包含拨号、查话单、取录音、列坐席、列外呼号码、列实例、配置订阅、只读活动、导入禁呼号码所需的自定义策略。`Resource` 按官方要求为 `"*"`。`AliyunCCCReadonlyAccess` 不够拨号。策略 JSON 以控制台当时给出的 Action 为准 |
| 代拨确认 | 用该 RAM 用户为映射的坐席 `UserId` 调用 `MakeCall` 是否被允许：待核实。若不允许，改为每个坐席自己的凭证或官方 OAuth，OAuth 端点也待核实 |
| 主叫号码 | 实例上已开通、用途包含呼出的号码。该号码已绑到坐席签入的技能组，或已设为坐席个人外呼号码 |
| 技能组 | 若号码靠技能组授权，提供技能组 ID（形态见文档示例 `skillgroup@实例ID`） |
| 坐席 | 每个要拨号的 CRM 用户对应一个已存在的 CCC `UserId`、登录名和分机。不要把初始密码发到代码仓库。是否新建坐席由管理员另行决定，`CreateUser` 会发 RAM 密码邮件 |
| 坐席环境 | Chrome 72 或更新版本、HTTPS 的 CRM 地址、麦克风权限。嵌在 iframe 时允许 `microphone`、`camera`、`autoplay` |
| 回调 | 公网 HTTPS 地址。在实例里用 `UpdateSubscription` 配 `MqType=webhook`、`ProducerId=PID_Webhook`、`DefaultTopic=Topic_Webhook`。第一期只打开 `Ringing`、`AgentRinging`、`Established`、`Released`、`RecordingReady`、`CDRReady`。路径令牌由客多多生成并写入加密设置 |
| Webhook 细节 | HTTP 方法、成功状态码、重试策略、出口 IP：待核实。未确认前先用控制台的测试推送看实际请求 |
| 录音 | 确认实例会在双方接通后生成录音。播放依赖 `GetMonoRecording`。链接有效期以当时官方页为准（当前页同时出现 `ExpireSeconds` 和「1 天」） |
| 开关 | 以上齐全后，才在服务器加密配置里把功能开关设为开。仓库默认值保持关 |

不需要提供的内容：OutboundBot 实例、外呼任务组、预测式活动名单、主账号 AccessKey、写在仓库里的密钥。
