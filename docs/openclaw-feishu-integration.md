# OpenClaw 飞书接入技术文档

## 概述

本文档详细介绍 OpenClaw 项目中飞书（Feishu/Lark）平台的接入实现，包括 Plugin/Channel 架构、消息收发流程、访问控制机制等。

---

## 一、Plugin 与 Channel 机制

### 1.1 概念区分

| 概念 | 说明 |
|------|------|
| **Plugin（插件）** | OpenClaw 的**扩展单元**，可以是 Channel Plugin（通道插件）或 Provider Plugin（模型提供商插件） |
| **Channel（通道）** | **一种特殊的 Plugin**，用于连接外部 IM 平台（Telegram、Discord、飞书等） |

```
OpenClaw 插件体系
    │
    ├── Channel Plugin（通道插件）
    │   ├── feishu（飞书）
    │   ├── telegram
    │   ├── discord
    │   └── whatsapp
    │
    └── Provider Plugin（模型提供商插件）
        ├── openai
        ├── anthropic
        └── azure-openai
```

### 1.2 Plugin 架构

#### 1.2.1 Plugin 定义结构

```typescript
// src/plugins/types.ts
type OpenClawPluginDefinition = {
  id?: string;           // 唯一标识 (如 "feishu")
  name?: string;         // 显示名称
  description?: string;  // 描述
  version?: string;      // 版本
  kind?: PluginKind;     // 类型
  configSchema?: OpenClawPluginConfigSchema;  // 配置校验
  
  // 生命周期钩子
  register?: (api: OpenClawPluginApi) => void;  // 注册阶段
  activate?: (api: OpenClawPluginApi) => void;  // 激活阶段
};
```

#### 1.2.2 Plugin API（插件可用的能力）

```typescript
type OpenClawPluginApi = {
  // 注册工具（Agent 可调用的工具）
  registerTool: (tool, opts?) => void;
  
  // 注册钩子（生命周期事件处理）
  registerHook: (events, handler) => void;
  
  // 注册 HTTP 处理器
  registerHttpHandler: (handler) => void;
  registerHttpRoute: (params) => void;
  
  // 注册通道（Channel Plugin 专用）
  registerChannel: (registration) => void;
  
  // 注册自定义命令（绕过 LLM）
  registerCommand: (command) => void;
  
  // 注册 CLI 命令
  registerCli: (registrar) => void;
  
  // 注册服务（后台服务）
  registerService: (service) => void;
  
  // 注册模型提供商
  registerProvider: (provider) => void;
  
  // 注册网关方法
  registerGatewayMethod: (method, handler) => void;
  
  // 路径解析
  resolvePath: (input) => string;
};
```

#### 1.2.3 Plugin 生命周期

```
┌─────────────────────────────────────────────────────────┐
│                   Plugin 生命周期                        │
└─────────────────────────────────────────────────────────┘

1. 加载 (loader)
   │
   ▼
2. 注册 (register)
   │  - registerTool()
   │  - registerHook()
   │  - registerChannel() ← 注册 Channel
   │  - registerCommand()
   │  ...
   │
   ▼
3. 激活 (activate)
   │  - 初始化配置
   │  - 启动服务
   │
   ▼
4. 运行 (running)
   │  - 处理消息
   │  - 响应事件
   │
   ▼
5. 停用/卸载 (stop/unload)
```

### 1.3 Channel 架构

#### 1.3.1 ChannelPlugin 类型定义

```typescript
type ChannelPlugin<ResolvedAccount = any> = {
  // 基础信息
  id: ChannelId;                    // 如 "feishu"
  meta: ChannelMeta;                // 元信息（名称、文档等）
  capabilities: ChannelCapabilities; // 能力声明
  
  // 配置相关
  config: ChannelConfigAdapter;     // 账号列表、解析、启用状态
  configSchema?: ChannelConfigSchema;
  
  // 生命周期（通过 gateway 适配器）
  gateway?: ChannelGatewayAdapter;  // startAccount/stopAccount
  
  // 消息处理
  messaging?: ChannelMessagingAdapter;
  outbound?: ChannelOutboundAdapter;  // 发送消息
  streaming?: ChannelStreamingAdapter; // 流式响应
  
  // 访问控制
  security?: ChannelSecurityAdapter;
  pairing?: ChannelPairingAdapter;
  groups?: ChannelGroupAdapter;
  
  // 辅助功能
  status?: ChannelStatusAdapter;    // 状态探针
  auth?: ChannelAuthAdapter;        // 登录认证
  heartbeat?: ChannelHeartbeatAdapter; // 心跳检查
  directory?: ChannelDirectoryAdapter; // 用户/群组目录
  resolver?: ChannelResolverAdapter;   // 目标解析
  
  // 命令与工具
  commands?: ChannelCommandAdapter;
  agentTools?: ChannelAgentToolFactory | ChannelAgentTool[];
  
  // 其他
  onboarding?: ChannelOnboardingAdapter;
  reload?: { configPrefixes: string[] };
};
```

#### 1.3.2 ChannelAdapter 体系（17种适配器）

| 适配器 | 职责 | 关键方法 |
|--------|------|----------|
| **gateway** | 生命周期管理 | `startAccount()`, `stopAccount()`, `loginWithQrStart()` |
| **config** | 账号配置管理 | `listAccountIds()`, `resolveAccount()`, `isConfigured()` |
| **messaging** | 消息接收处理 | `onMessage()` |
| **outbound** | 消息发送 | `sendText()`, `sendMedia()`, `sendPayload()` |
| **streaming** | 流式响应 | `stream()` |
| **security** | 访问控制 | `checkAllow()`, `resolveDmPolicy()` |
| **pairing** | 配对机制 | `notifyApproval()` |
| **groups** | 群组管理 | `resolveRequireMention()`, `resolveToolPolicy()` |
| **status** | 状态探针 | `probeAccount()`, `buildAccountSnapshot()` |
| **auth** | 登录认证 | `login()` |
| **heartbeat** | 心跳检查 | `checkReady()` |
| **directory** | 用户目录 | `self`, `listPeers()`, `listGroups()` |
| **resolver** | 目标解析 | `resolveTargets()` |
| **elevated** | 权限提升 | `allowFromFallback()` |
| **commands** | 命令处理 | 自定义命令 |
| **agentTools** | Agent工具 | channel 特有工具 |
| **onboarding** | 入站引导 | 引导用户配置 channel |

### 1.4 数据流：Plugin 注册 → Channel 启动

#### 1.4.1 Plugin 注册流程

```
┌─────────────────────────────────────────────────────────────┐
│                  Plugin 注册流程                             │
└─────────────────────────────────────────────────────────────┘

1. 加载插件
   │
   ▼
2. plugins/loader.ts: loadPlugin()
   │   读取 extensions/<name>/src/plugin.ts
   │
   ▼
3. 调用 register(api)
   │   api.registerChannel({
   │     plugin: feishuPlugin,
   │     dock?: channelDock
   │   })
   │
   ▼
4. plugins/registry.ts: registerChannel()
   │   注册到全局 ChannelPluginCatalog
   │
   ▼
5. 完成
```

#### 1.4.2 Channel 启动流程

```
┌─────────────────────────────────────────────────────────────┐
│                  Channel 启动流程                             │
└─────────────────────────────────────────────────────────────┘

1. Gateway 启动
   │
   ▼
2. gateway/server-channels.ts: createChannelManager()
   │
   ▼
3. ChannelManager.startChannels()
   │   遍历所有启用的 channel
   │
   ▼
4. 对每个 channel 调用 startChannel()
   │
   ▼
5. 获取 ChannelPlugin
   │   const plugin = getChannelPlugin(channelId)
   │
   ▼
6. 调用 plugin.gateway.startAccount(ctx)
   │   ┌────────────────────────────────────┐
   │   │ ctx = {                           │
   │   │   cfg,          // 配置             │
   │   │   accountId,    // 账号 ID          │
   │   │   account,      // 解析后的账号配置  │
   │   │   runtime,      // 运行时环境        │
   │   │   abortSignal,  // 终止信号         │
   │   │   log,          // 日志             │
   │   │   getStatus,    // 获取状态        │
   │   │   setStatus     // 设置状态        │
   │   │ }                              │
   │   └────────────────────────────────────┘
   │
   ▼
7. Channel 内部启动
   │   如飞书: monitorFeishuProvider()
   │   - 创建 WebSocket 连接
   │   - 注册消息处理
   │   - 启动长连接监听
   │
   ▼
8. Channel 运行中
   │   等待接收消息...
```

---

## 二、飞书接入实现

### 2.1 技术栈

- **官方 SDK**: `@larksuiteoapi/node-sdk` (v1.58.0)
- **通信方式**: WebSocket 长连接模式接收消息

### 2.2 核心模块结构

```
src/feishu/
├── bot.ts          # 机器人创建和启动入口
├── client.ts       # 飞书客户端工厂，管理多账号
├── send.ts         # 消息发送（文本、媒体、文件）
├── message.ts      # 消息接收和处理
├── format.ts       # Markdown 转飞书富文本
├── download.ts     # 媒体文件下载
├── streaming-card.ts # 流式卡片（打字机效果）
├── pairing-store.ts # 配对请求存储
├── access.ts       # 访问控制（白名单/配对）
├── config.ts       # 配置解析
├── domain.ts       # 域名解析（国内/国际版）
└── types.ts        # 类型定义
```

### 2.3 认证/授权方式

| 配置项 | 说明 |
|--------|------|
| `appId` | 飞书应用 ID (cli_xxx) |
| `appSecret` | 应用密钥 |
| `appSecretFile` | 密钥文件路径（支持密钥管理器） |
| `domain` | 域名：`feishu`(默认) 或 `lark`(国际版) |

支持**多账号**配置：
```yaml
channels:
  feishu:
    accounts:
      bot1:
        appId: "cli_xxx"
        appSecret: "yyy"
      bot2:
        appId: "cli_zzz"
        appSecret: "aaa"
```

### 2.4 配置文件示例

```yaml
channels:
  feishu:
    appId: "cli_xxx"
    appSecret: "yyy"
    dmPolicy: "pairing"      # 私聊需要配对
    groupPolicy: "open"       # 群聊开放
    requireMention: true      # 群聊必须@
    streaming: true           # 启用流式卡片
    historyLimit: 10          # 保留10条群聊历史
```

### 2.5 消息收发机制

**发送** (`send.ts`):
- 支持消息类型: `text`, `image`, `file`, `audio`, `media`, `post`, `interactive`
- 自动将 Markdown 转为飞书富文本 (`post` 格式)
- 支持从 URL 上传媒体文件

**接收** (`bot.ts` + `message.ts`):
- 使用 WebSocket 长连接监听 `im.message.receive_v1` 事件
- 支持文本、图片、文件、音频、表情包消息
- 处理 @mention 群聊触发

### 2.6 访问控制策略

| 策略 | 说明 | 处理流程 |
|------|------|----------|
| `open` | 开放 | 直接处理消息 |
| `allowlist` | 白名单 | 检查 senderId 是否在白名单 |
| `pairing` | 配对 | 未知用户 → 生成配对码 → 管理员审批 |
| `disabled` | 禁用 | 忽略所有消息 |

| 策略 | 说明 |
|------|------|
| `dmPolicy` (私聊) | `pairing`(配对) / `allowlist`(白名单) / `open`(开放) / `disabled`(禁用) |
| `groupPolicy` (群组) | `open` / `allowlist` / `disabled` |
| `requireMention` | 群聊是否必须 @机器人 |

### 2.7 特色功能

- **流式卡片**: 打字机效果回复 (`streaming-card.ts`)
- **配对机制**: 未知用户发送配对码，管理员审批后放行
- **历史上下文**: 保留群聊/DM 历史作为上下文
- **媒体处理**: 自动下载并上传图片/文件/音频

---

## 三、飞书接入流程与数据流

### 3.1 整体架构

OpenClaw 采用 **插件化架构** + **Gateway 统一管理** 的方式接入飞书：

```
┌─────────────────────────────────────────────────────────────────┐
│                        Gateway (主服务)                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │               ChannelManager (通道管理器)                  │  │
│  │   - startChannels() / startChannel()                     │  │
│  │   - 管理各 channel 的生命周期                              │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Telegram插件   │  │   Slack插件    │  │  飞书插件       │
│                 │  │                 │  │ (feishuPlugin) │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌──────────────────────────────────────────────────────────────────┐
│                     运行时 (src/feishu/)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ bot.ts   │  │ monitor  │  │ message  │  │  send.ts │        │
│  │          │──│ .ts      │──│ .ts      │──│          │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                  ┌────────────────────────┐
                  │   飞书开放平台           │
                  │   (WebSocket 长连接)    │
                  └────────────────────────┘
```

### 3.2 接入流程（启动步骤）

#### 步骤1：配置加载
```
配置文件 (openclaw.yaml)
    │
    ▼
┌─────────────────────────────────────┐
│  channels:                          │
│    feishu:                         │
│      appId: "cli_xxx"              │
│      appSecret: "yyy"              │
│      accounts:                     │
│        bot1:                       │
│          appId: "cli_aaa"         │
│          appSecret: "bbb"         │
└─────────────────────────────────────┘
```

#### 步骤2：插件注册 (`extensions/feishu/`)
```
plugin.id = "feishu"
    │
    ▼ api.registerChannel({ plugin: feishuPlugin })
    │
    ▼ 在 Gateway 的 ChannelManager 中注册
```

#### 步骤3：启动通道 (`gateway/server-channels.ts`)
```
Gateway 启动
    │
    ▼
ChannelManager.startChannels()
    │
    ▼ 对每个 plugin 调用 startAccount()
    │
    ▼ feishuPlugin.gateway.startAccount()
        │
        ▼
    monitorFeishuProvider()  ← 核心启动函数
```

#### 步骤4：建立 WebSocket 连接 (`feishu/monitor.ts`)
```
monitorFeishuProvider()
    │
    ├─▶ 创建 Lark.Client (API 调用)
    │
    ├─▶ 创建 EventDispatcher 注册消息处理
    │       │
    │       ▼
    │   "im.message.receive_v1" 事件
    │       │
    │       ▼
    │   processFeishuMessage()
    │
    └─▶ 创建 WSClient 并启动 WebSocket
            │
            ▼
        wsClient.start({ eventDispatcher })
            │
            ▼
        等待消息 (长连接)
```

### 3.3 消息数据流（接收 → 处理 → 回复）

#### 消息接收流程

```
飞书开放平台                    OpenClaw 内部
     │                              │
     │  WebSocket 长连接            │
     │ ─────────────────────────▶   │
     │                              │
     │  im.message.receive_v1       │
     │  (JSON 事件 payload)         │
     │                              │
     ▼                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  message.ts: processFeishuMessage()                                 │
│                                                                     │
│  1. 解析 payload                                                   │
│     ├─ message.message_id                                           │
│     ├─ message.chat_id (群/私聊)                                    │
│     ├─ message.chat_type ("group"/"dm")                            │
│     ├─ message.message_type ("text"/"image"/"file"...)             │
│     └─ sender.sender_id (open_id/user_id/union_id)                 │
│                                                                     │
│  2. 访问控制检查 (access.ts)                                        │
│     ├─ 群组: groupPolicy + groupAllowFrom + requireMention         │
│     └─ 私聊: dmPolicy + allowFrom + pairing 机制                   │
│                                                                     │
│  3. 媒体处理 (download.ts)                                           │
│     ├─ 图片/文件/音频/视频                                           │
│     └─ 调用 messageResource.get API 下载                           │
│                                                                     │
│  4. 构建 Context                                                   │
│     ctx = {                                                         │
│       Body: "用户消息内容",                                         │
│       From: senderId,                                               │
│       To: chatId,                                                    │
│       ChatType: "group"/"dm",                                       │
│       Provider: "feishu",                                           │
│       MediaPath: media?.path,                                       │
│       ...                                                           │
│     }                                                               │
│                                                                     │
│  5. 分发给 Reply 引擎                                               │
│     └─▶ dispatchReplyWithBufferedBlockDispatcher()                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
```

#### 消息回复流程

```
Reply 引擎                     飞书发送模块
     │                              │
     │  生成回复内容                │
     │  (text / media)             │
     │                              │
     │  dispatcherOptions.deliver()│
     │ ──────────────────────────▶  │
     │                              │
     │  send.ts: sendMessageFeishu()│
     │                              │
     │  处理流程:                   │
     │  ├─ Markdown 转飞书 post 格式 │
     │  ├─ 图片/视频: 先上传到飞书    │
     │  │     (uploadImage/uploadFile)│
     │  └─ 发送消息                  │
     │      (im.message.create)     │
     │                              │
     │  可选: 流式卡片               │
     │  (streaming-card.ts)        │
     │                              │
     ▼                              ▼
```

---

## 四、飞书插件完整示例

```typescript
// extensions/feishu/src/channel.ts
export const feishuPlugin: ChannelPlugin<ResolvedFeishuAccount> = {
  // ========== 基础信息 ==========
  id: "feishu",
  meta: {
    id: "feishu",
    label: "Feishu",
    docsPath: "/channels/feishu",
    aliases: ["lark"],
    // ...
  },
  
  // ========== 能力声明 ==========
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: false,
    threads: false,
    blockStreaming: true,  // 支持流式卡片
  },
  
  // ========== 配置适配器 ==========
  config: {
    listAccountIds: (cfg) => listFeishuAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveFeishuAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultFeishuAccountId(cfg),
    isConfigured: (account) => account.tokenSource !== "none",
    // ...
  },
  
  // ========== 消息发送 ==========
  outbound: feishuOutbound,  // 发送文本/图片/文件
  messaging: {
    normalizeTarget: normalizeFeishuTarget,
    // ...
  },
  
  // ========== 访问控制 ==========
  security: { /* 权限策略 */ },
  pairing: { /* 配对机制 */ },
  groups: { /* 群组配置 */ },
  
  // ========== 生命周期（核心） ==========
  gateway: {
    startAccount: async (ctx) => {
      const { account, log, setStatus, abortSignal, cfg, runtime } = ctx;
      const { appId, appSecret, domain } = account.config;
      
      // 1. 探针检查
      const probe = await probeFeishu(appId, appSecret, 5000, domain);
      
      // 2. 设置状态
      setStatus({ running: true, lastStartAt: Date.now() });
      
      // 3. 启动消息监听
      await monitorFeishuProvider({
        appId, appSecret, accountId: account.accountId,
        config: cfg, runtime, abortSignal
      });
    },
    
    stopAccount: async (ctx) => {
      // 清理资源、关闭连接
    },
  },
  
  // ========== 状态探针 ==========
  status: {
    probeAccount: async ({ account, timeoutMs, cfg }) => { /* ... */ },
    buildAccountSnapshot: async ({ account, cfg, runtime }) => { /* ... */ },
  },
  
  // ========== 其他适配器 ==========
  onboarding: feishuOnboardingAdapter,
  commands: { /* 自定义命令 */ },
  // ...
};
```

---

## 五、总结

### 5.1 架构分层

| 层次 | 职责 | 关键文件 |
|------|------|----------|
| **Plugin** | 扩展单元，定义插件的注册和激活方式 | `src/plugins/types.ts` |
| **Channel** | Plugin 的子类，专用于 IM 平台接入 | `src/channels/plugins/types.plugin.ts` |
| **ChannelManager** | 管理所有 Channel 的生命周期 | `src/gateway/server-channels.ts` |
| **Gateway** | 主服务，协调所有插件和通道 | `src/gateway/` |
| **ChannelPlugin (飞书)** | 具体平台实现 | `extensions/feishu/src/channel.ts` |

### 5.2 设计模式

- **Adapter 模式**: 每种能力独立抽象，通过组合实现不同平台的差异化接入
- **生命周期钩子**: register → activate → run → stop
- **配置驱动**: 通过配置文件控制多账号、访问策略等

### 5.3 关键配置项

```yaml
channels:
  feishu:
    appId: "cli_xxx"           # 应用 ID
    appSecret: "yyy"           # 应用密钥
    domain: "feishu"           # 域名 (feishu/lark)
    dmPolicy: "pairing"       # 私聊策略: open/allowlist/pairing/disabled
    groupPolicy: "open"        # 群聊策略: open/allowlist/disabled
    allowFrom: ["ou_xxx"]      # 白名单用户 ID
    requireMention: true       # 群聊是否必须 @机器人
    streaming: true            # 启用流式卡片
    historyLimit: 10           # 群聊历史消息数
    mediaMaxMb: 30             # 媒体文件大小限制
    accounts:
      bot1:
        appId: "cli_aaa"
        appSecret: "bbb"
```

---

## 参考资料

- 源码目录: `thirdparty/openclaw/src/feishu/`
- 插件定义: `thirdparty/openclaw/extensions/feishu/src/channel.ts`
- Plugin 核心: `thirdparty/openclaw/src/plugins/types.ts`
- Channel 适配器: `thirdparty/openclaw/src/channels/plugins/types.plugin.ts`
- Gateway 管理: `thirdparty/openclaw/src/gateway/server-channels.ts`
