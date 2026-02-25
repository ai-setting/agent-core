# agent-core Channel 插件体系设计方案

## 一、概述

本文档设计 agent-core 项目的 Channel 插件体系，参考 OpenClaw 的 Plugin/Channel 架构，支持多平台 IM 接入（如飞书、Telegram、Discord 等）。

## 二、Channel 插件体系架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              agent-core                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      Plugin Manager                                  │    │
│  │   - 插件加载 (load)                                                  │    │
│  │   - 插件注册 (register)                                             │    │
│  │   - 插件激活 (activate)                                              │    │
│  │   - 生命周期管理                                                    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                    │                         │                               │
│    ┌───────────────┼───────────────┐         │                               │
│    │               │               │         │                               │
│    ▼               ▼               ▼         ▼                               │
│ ┌────────┐   ┌──────────┐   ┌──────────┐ ┌──────────┐                       │
│ │ Feishu │   │ Telegram │   │ Discord  │ │  ...  │  (可扩展)                │
│ │Channel │   │ Channel  │   │ Channel  │ │Channel │                         │
│ └────────┘   └──────────┘   └──────────┘ └──────────┘                         │
│        │           │           │                                               │
│        └───────────┴───────────┘                                               │
│                        │                                                        │
│                        ▼                                                        │
│              ┌─────────────────────┐                                          │
│              │    Message Router   │                                           │
│              └─────────────────────┘                                          │
│                        │                                                        │
│                        ▼                                                        │
│              ┌─────────────────────┐                                          │
│              │      Session        │ ◄── 与 Agent 交互                         │
│              └─────────────────────┘                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 插件类型定义

```typescript
// src/plugins/types.ts

/**
 * 插件类型
 */
export enum PluginKind {
  CHANNEL = 'channel',
  PROVIDER = 'provider',
  TOOL = 'tool',
}

/**
 * 插件定义
 */
export interface PluginDefinition<T = any> {
  id: string;
  name: string;
  description?: string;
  version?: string;
  kind: PluginKind;
  
  // 配置
  configSchema?: ConfigSchema;
  
  // 生命周期
  register?: (api: PluginApi) => void;
  activate?: (context: PluginContext) => Promise<void>;
  deactivate?: (context: PluginContext) => Promise<void>;
}

/**
 * 插件 API - 插件可用的能力
 */
export interface PluginApi {
  // 注册工具
  registerTool: (tool: ToolDefinition, handler: ToolHandler) => void;
  
  // 注册钩子
  registerHook: (event: string, handler: HookHandler) => void;
  
  // 注册 Channel (Channel Plugin 专用)
  registerChannel: (channel: ChannelPlugin) => void;
  
  // 注册 Provider (Provider Plugin 专用)
  registerProvider: (provider: ProviderPlugin) => void;
  
  // 注册 HTTP 路由
  registerHttpRoute: (route: HttpRoute) => void;
  
  // 注册命令
  registerCommand: (command: CommandDefinition) => void;
  
  // 获取配置
  getConfig: <T = any>(key: string, defaultValue?: T) => T;
}

/**
 * 插件上下文
 */
export interface PluginContext {
  pluginId: string;
  config: any;
  logger: Logger;
}
```

## 三、Channel 插件接口设计

### 3.1 Channel 基础接口

```typescript
// src/channels/types.ts

import type { Session } from '../session/index.js';

/**
 * Channel ID 类型
 */
export type ChannelId = string;

/**
 * Channel 元信息
 */
export interface ChannelMeta {
  id: ChannelId;
  name: string;
  description?: string;
  icon?: string;
  documentation?: string;
}

/**
 * Channel 能力声明
 */
export interface ChannelCapabilities {
  // 消息
  supportsText: boolean;
  supportsRichText: boolean;
  supportsImage: boolean;
  supportsFile: boolean;
  supportsCard: boolean;
  
  // 交互
  supportsMention: boolean;
  supportsReaction: boolean;
  supportsThread: boolean;
  
  // 高级
  supportsStreaming: boolean;
  supportsWebhooks: boolean;
  supportsWebSocket: boolean;
  
  // 群组
  supportsGroup: boolean;
  supportsDM: boolean;
}

/**
 * 消息源
 */
export interface MessageSource {
  channelId: string;
  accountId: string;
  chatId: string;
  chatType: 'group' | 'dm';
  messageId: string;
  senderId: string;
  senderName?: string;
  timestamp: number;
}

/**
 * 消息内容
 */
export interface MessageContent {
  type: 'text' | 'image' | 'file' | 'audio' | 'rich_text';
  content: string;
  raw?: any;
}

/**
 * 接收到的消息
 */
export interface ChannelMessage {
  id: string;
  source: MessageSource;
  content: MessageContent;
}

/**
 * 发送消息选项
 */
export interface SendOptions {
  chatId: string;
  content: string;
  type?: 'text' | 'rich_text' | 'image' | 'file' | 'card';
  replyTo?: string;
  mentionIds?: string[];
}

/**
 * Channel 配置
 */
export interface ChannelAccount {
  id: string;
  name?: string;
  enabled: boolean;
  config: Record<string, any>;
}

export interface ChannelConfig {
  enabled: boolean;
  accounts: ChannelAccount[];
}
```

### 3.2 Channel 适配器接口（17种）

```typescript
// src/channels/adapters/types.ts

/**
 * ==================== 核心适配器 ====================
 */

/**
 * Gateway 适配器 - 生命周期管理
 */
export interface ChannelGatewayAdapter {
  // 启动账号
  startAccount(account: ChannelAccount): Promise<void>;
  
  // 停止账号
  stopAccount(accountId: string): Promise<void>;
  
  // 登录（扫码等方式）
  login?(account: ChannelAccount): Promise<void>;
  
  // 获取连接状态
  getStatus?(accountId: string): Promise<ChannelStatus>;
}

/**
 * Config 适配器 - 配置管理
 */
export interface ChannelConfigAdapter {
  // 列出所有账号
  listAccountIds(): string[];
  
  // 解析账号配置
  resolveAccount(accountId: string): ChannelAccount | undefined;
  
  // 是否已配置
  isConfigured(): boolean;
  
  // 重载配置
  reload?(): void;
}

/**
 * Messaging 适配器 - 消息接收
 */
export interface ChannelMessagingAdapter {
  // 消息处理器
  onMessage(handler: ChannelMessageHandler): void;
}

export type ChannelMessageHandler = (
  message: ChannelMessage,
  context: MessageContext
) => Promise<void>;

/**
 * Outbound 适配器 - 消息发送
 */
export interface ChannelOutboundAdapter {
  // 发送文本
  sendText(chatId: string, text: string): Promise<string>; // 返回消息ID
  
  // 发送富文本
  sendRichText(chatId: string, content: string): Promise<string>;
  
  // 发送图片
  sendImage(chatId: string, imageUrl: string): Promise<string>;
  
  // 发送文件
  sendFile(chatId: string, fileUrl: string, filename?: string): Promise<string>;
  
  // 发送卡片
  sendCard(chatId: string, card: CardContent): Promise<string>;
  
  // 回复消息
  reply(messageId: string, content: string): Promise<string>;
}

/**
 * Streaming 适配器 - 流式响应
 */
export interface ChannelStreamingAdapter {
  // 流式发送（打字机效果）
  stream(
    chatId: string, 
    content: string, 
    onChunk?: (chunk: string) => void
  ): Promise<string>;
  
  // 结束流式发送
  finishStream?(messageId: string): Promise<void>;
  
  // 更新消息（追加内容）
  updateMessage?(messageId: string, newContent: string): Promise<void>;
}

/**
 * ==================== 安全适配器 ====================
 */

/**
 * Security 适配器 - 访问控制
 */
export interface ChannelSecurityAdapter {
  // 检查访问权限
  checkAllow(source: MessageSource): Promise<SecurityCheckResult>;
  
  // 解析 DM 策略
  resolveDmPolicy(): AccessPolicy;
  
  // 解析群组策略
  resolveGroupPolicy(): AccessPolicy;
}

export type AccessPolicy = 'open' | 'allowlist' | 'pairing' | 'disabled';

export interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
  metadata?: Record<string, any>;
}

/**
 * Pairing 配对适配器
 */
export interface ChannelPairingAdapter {
  // 发起配对请求
  requestPairing(source: MessageSource): Promise<PairingRequest>;
  
  // 审批配对
  approvePairing(source: MessageSource, approved: boolean): Promise<void>;
  
  // 获取配对状态
  getPairingStatus(userId: string): Promise<PairingStatus>;
}

export interface PairingRequest {
  requestId: string;
  userId: string;
  userName?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
}

export type PairingStatus = 'unpaired' | 'pending' | 'paired';

/**
 * Groups 群组适配器
 */
export interface ChannelGroupAdapter {
  // 是否需要 @mention
  resolveRequireMention(): boolean;
  
  // 获取群成员
  listMembers(chatId: string): Promise<GroupMember[]>;
  
  // 获取群信息
  getGroupInfo(chatId: string): Promise<GroupInfo>;
}

export interface GroupMember {
  id: string;
  name: string;
  role: 'admin' | 'member' | 'bot';
}

export interface GroupInfo {
  id: string;
  name: string;
  memberCount: number;
}

/**
 * ==================== 辅助适配器 ====================
 */

/**
 * Status 状态探针
 */
export interface ChannelStatusAdapter {
  // 检测账号状态
  probeAccount(accountId: string): Promise<AccountProbeResult>;
  
  // 构建账号快照
  buildAccountSnapshot(): Promise<AccountSnapshot>;
}

export type ChannelStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

export interface AccountProbeResult {
  status: ChannelStatus;
  latency?: number;
  error?: string;
}

export interface AccountSnapshot {
  accountId: string;
  status: ChannelStatus;
  uptime?: number;
  lastMessageAt?: number;
}

/**
 * Directory 目录适配器
 */
export interface ChannelDirectoryAdapter {
  // 获取机器人信息
  self(): Promise<UserInfo>;
  
  // 列出用户
  listUsers(query?: ListQuery): Promise<UserInfo[]>;
  
  // 列出群组
  listGroups(query?: ListQuery): Promise<GroupInfo[]>;
}

export interface UserInfo {
  id: string;
  name: string;
  avatar?: string;
  isBot: boolean;
}

export interface ListQuery {
  limit?: number;
  offset?: number;
}

/**
 * Resolver 目标解析
 */
export interface ChannelResolverAdapter {
  // 解析消息中的目标（如 @mentions）
  resolveTargets(content: string): Promise<TargetInfo[]>;
  
  // 解析消息链接
  resolveMessageLink(chatId: string, messageId: string): Promise<string>;
}

export interface TargetInfo {
  type: 'user' | 'channel' | 'role';
  id: string;
  name: string;
}

/**
 * Auth 认证适配器
 */
export interface ChannelAuthAdapter {
  // 登录
  login(account: ChannelAccount): Promise<AuthResult>;
  
  // 登出
  logout(accountId: string): Promise<void>;
  
  // 刷新令牌
  refreshToken?(accountId: string): Promise<void>;
}

export interface AuthResult {
  success: boolean;
  token?: string;
  expiresAt?: number;
}

/**
 * Heartbeat 心跳检查
 */
export interface ChannelHeartbeatAdapter {
  // 检查就绪状态
  checkReady(): Promise<boolean>;
  
  // 发送心跳
  ping(): Promise<boolean>;
}

/**
 * Commands 命令适配器
 */
export interface ChannelCommandAdapter {
  // 注册命令
  registerCommands(commands: CommandDefinition[]): void;
  
  // 处理命令
  handleCommand(command: string, message: ChannelMessage): Promise<CommandResult>;
}

export interface CommandDefinition {
  name: string;
  description: string;
  usage?: string;
  aliases?: string[];
}

export interface CommandResult {
  handled: boolean;
  response?: string;
}

/**
 * AgentTools Agent工具适配器
 */
export interface ChannelAgentToolAdapter {
  // 获取 Channel 特有工具
  getTools(): ToolDefinition[];
  
  // 处理工具调用
  handleToolCall(toolName: string, args: any): Promise<ToolResult>;
}

/**
 * Onboarding 入站引导
 */
export interface ChannelOnboardingAdapter {
  // 获取引导消息
  getOnboardingMessage(): Promise<OnboardingContent>;
  
  // 处理引导反馈
  handleOnboardingAction(action: string, source: MessageSource): Promise<void>;
}

export interface OnboardingContent {
  title: string;
  description: string;
  steps: OnboardingStep[];
}

export interface OnboardingStep {
  title: string;
  content: string;
  action?: string;
}
```

### 3.3 Channel 插件完整类型

```typescript
// src/channels/channel.ts

import type {
  ChannelMeta,
  ChannelCapabilities,
  ChannelConfig,
  ChannelGatewayAdapter,
  ChannelConfigAdapter,
  ChannelMessagingAdapter,
  ChannelOutboundAdapter,
  ChannelStreamingAdapter,
  ChannelSecurityAdapter,
  ChannelPairingAdapter,
  ChannelGroupAdapter,
  ChannelStatusAdapter,
  ChannelDirectoryAdapter,
  ChannelResolverAdapter,
  ChannelAuthAdapter,
  ChannelHeartbeatAdapter,
  ChannelCommandAdapter,
  ChannelAgentToolAdapter,
  ChannelOnboardingAdapter,
} from './adapters/types.js';

/**
 * Channel 插件完整接口
 */
export interface ChannelPlugin {
  // 基础信息
  id: ChannelId;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;
  
  // 配置
  config: ChannelConfigAdapter;
  configSchema?: any;
  
  // 核心功能
  gateway?: ChannelGatewayAdapter;
  messaging?: ChannelMessagingAdapter;
  outbound?: ChannelOutboundAdapter;
  streaming?: ChannelStreamingAdapter;
  
  // 安全
  security?: ChannelSecurityAdapter;
  pairing?: ChannelPairingAdapter;
  groups?: ChannelGroupAdapter;
  
  // 辅助
  status?: ChannelStatusAdapter;
  auth?: ChannelAuthAdapter;
  heartbeat?: ChannelHeartbeatAdapter;
  directory?: ChannelDirectoryAdapter;
  resolver?: ChannelResolverAdapter;
  
  // 扩展
  commands?: ChannelCommandAdapter;
  agentTools?: ChannelAgentToolAdapter;
  onboarding?: ChannelOnboardingAdapter;
  
  // 生命周期
  hooks?: {
    onStart?: () => Promise<void>;
    onStop?: () => Promise<void>;
    onMessage?: (msg: ChannelMessage) => Promise<void>;
    onError?: (error: Error) => Promise<void>;
  };
}
```

## 四、飞书 Channel 插件实现

### 4.1 目录结构

```
src/channels/
├── types.ts                    # 类型定义
├── channel.ts                  # Channel 接口
├── adapters/
│   └── types.ts                # 适配器类型定义
├── base/
│   └── base-channel.ts         # Channel 基类
├── manager.ts                  # Channel 管理器
├── router.ts                   # 消息路由器
├── registry.ts                 # Channel 注册表
└── implementations/
    ├── feishu/
    │   ├── index.ts            # 入口
    │   ├── config.ts           # 配置
    │   ├── bot.ts              # 机器人
    │   ├── gateway.ts          # Gateway 适配器
    │   ├── messaging.ts        # Messaging 适配器
    │   ├── outbound.ts         # Outbound 适配器
    │   ├── streaming.ts        # Streaming 适配器
    │   ├── security.ts         # Security 适配器
    │   ├── pairing.ts          # Pairing 适配器
    │   ├── groups.ts           # Groups 适配器
    │   ├── status.ts           # Status 适配器
    │   ├── directory.ts        # Directory 适配器
    │   ├── commands.ts         # Commands 适配器
    │   ├── formatter.ts        # 格式转换
    │   └── types.ts            # 飞书特有类型
    └── telegram/
        └── ...                 # 其他 Channel 实现
```

### 4.2 飞书 Channel 实现

```typescript
// src/channels/implementations/feishu/index.ts

import { Lark } from '@larksuiteoapi/node-sdk';
import { FeishuGateway } from './gateway.js';
import { FeishuMessaging } from './messaging.js';
import { FeishuOutbound } from './outbound.js';
import { FeishuStreaming } from './streaming.js';
import { FeishuSecurity } from './security.js';
import { FeishuPairing } from './pairing.js';
import { FeishuGroups } from './groups.js';
import { FeishuStatus } from './status.js';
import { FeishuDirectory } from './directory.js';
import { FeishuCommands } from './commands.js';
import type { ChannelPlugin, ChannelConfig } from '../../types.js';
import type { FeishuChannelConfig, FeishuAccount } from './types.js';

/**
 * 飞书 Channel 插件
 */
export class FeishuChannel implements ChannelPlugin {
  readonly id = 'feishu';
  
  readonly meta = {
    id: 'feishu',
    name: '飞书',
    description: '飞书 (Feishu/Lark) IM 平台接入',
    icon: '🐦',
    documentation: 'https://open.feishu.cn/',
  };
  
  readonly capabilities = {
    supportsText: true,
    supportsRichText: true,
    supportsImage: true,
    supportsFile: true,
    supportsCard: true,
    supportsMention: true,
    supportsReaction: false,
    supportsThread: false,
    supportsStreaming: true,
    supportsWebhooks: true,
    supportsWebSocket: true,
    supportsGroup: true,
    supportsDM: true,
  };
  
  // 内部状态
  private clients: Map<string, Lark> = new Map();
  private accounts: Map<string, FeishuAccount> = new Map();
  
  // 适配器实例
  readonly config: FeishuChannelConfig;
  readonly gateway: FeishuGateway;
  readonly messaging: FeishuMessaging;
  readonly outbound: FeishuOutbound;
  readonly streaming: FeishuStreaming;
  readonly security: FeishuSecurity;
  readonly pairing: FeishuPairing;
  readonly groups: FeishuGroups;
  readonly status: FeishuStatus;
  readonly directory: FeishuDirectory;
  readonly commands: FeishuCommands;
  
  constructor(config: FeishuChannelConfig) {
    this.config = config;
    
    // 初始化账号客户端
    for (const account of config.accounts) {
      if (account.enabled) {
        const client = new Lark({
          appId: account.appId,
          appSecret: account.appSecret,
          domain: account.domain || 'feishu',
        });
        this.clients.set(account.id, client);
        this.accounts.set(account.id, account);
      }
    }
    
    // 初始化适配器
    this.gateway = new FeishuGateway(this.clients, this.accounts);
    this.messaging = new FeishuMessaging();
    this.outbound = new FeishuOutbound(this.clients);
    this.streaming = new FeishuStreaming(this.clients);
    this.security = new FeishuSecurity(config.policies);
    this.pairing = new FeishuPairing();
    this.groups = new FeishuGroups(this.clients);
    this.status = new FeishuStatus(this.clients);
    this.directory = new FeishuDirectory(this.clients);
    this.commands = new FeishuCommands();
    
    // 绑定消息处理
    this.messaging.onMessage(async (message) => {
      // 消息通过 router 分发给 Agent
      console.log('[Feishu] Received message:', message);
    });
  }
  
  // 启动所有账号
  async start(): Promise<void> {
    for (const accountId of this.config.listAccountIds()) {
      await this.gateway.startAccount(accountId);
    }
  }
  
  // 停止所有账号
  async stop(): Promise<void> {
    for (const accountId of this.config.listAccountIds()) {
      await this.gateway.stopAccount(accountId);
    }
  }
}

/**
 * 飞书 Channel 配置
 */
export class FeishuChannelConfigAdapter {
  private config: FeishuChannelConfig;
  
  constructor(config: FeishuChannelConfig) {
    this.config = config;
  }
  
  listAccountIds(): string[] {
    return this.config.accounts
      .filter(a => a.enabled)
      .map(a => a.id);
  }
  
  resolveAccount(accountId: string): FeishuAccount | undefined {
    return this.config.accounts.find(a => a.id === accountId);
  }
  
  isConfigured(): boolean {
    return this.config.enabled && this.config.accounts.length > 0;
  }
}
```

### 4.3 飞书 Gateway 适配器

```typescript
// src/channels/implementations/feishu/gateway.ts

import { EventDispatcher, WSClient, Lark } from '@larksuiteoapi/node-sdk';
import type { ChannelGatewayAdapter, ChannelStatus } from '../../adapters/types.js';
import type { FeishuAccount } from './types.js';

export class FeishuGateway implements ChannelGatewayAdapter {
  private clients: Map<string, Lark>;
  private accounts: Map<string, FeishuAccount>;
  private wsClients: Map<string, WSClient> = new Map();
  private statuses: Map<string, ChannelStatus> = new Map();
  
  constructor(clients: Map<string, Lark>, accounts: Map<string, FeishuAccount>) {
    this.clients = clients;
    this.accounts = accounts;
  }
  
  async startAccount(accountId: string): Promise<void> {
    const account = this.accounts.get(accountId);
    const client = this.clients.get(accountId);
    
    if (!account || !client) {
      throw new Error(`Account ${accountId} not found`);
    }
    
    this.statuses.set(accountId, 'connecting');
    
    // 创建 WebSocket 客户端
    const wsClient = new WSClient({
      appId: account.appId,
      appSecret: account.appSecret,
    });
    
    // 设置事件分发器
    const eventDispatcher = new EventDispatcher({
      'im.message.receive_v1': (event) => {
        // 触发消息事件
        console.log('[Feishu] Message received:', event);
      },
    });
    
    // 启动 WebSocket 连接
    await wsClient.start({ eventDispatcher });
    
    this.wsClients.set(accountId, wsClient);
    this.statuses.set(accountId, 'connected');
    
    console.log(`[Feishu] Account ${accountId} started`);
  }
  
  async stopAccount(accountId: string): Promise<void> {
    const wsClient = this.wsClients.get(accountId);
    
    if (wsClient) {
      await wsClient.stop();
      this.wsClients.delete(accountId);
    }
    
    this.statuses.set(accountId, 'disconnected');
    console.log(`[Feishu] Account ${accountId} stopped`);
  }
  
  getStatus(accountId: string): ChannelStatus {
    return this.statuses.get(accountId) || 'disconnected';
  }
}
```

### 4.4 飞书 Outbound 适配器

```typescript
// src/channels/implementations/feishu/outbound.ts

import { Lark } from '@larksuiteoapi/node-sdk';
import type { ChannelOutboundAdapter } from '../../adapters/types.js';

export class FeishuOutbound implements ChannelOutboundAdapter {
  private clients: Map<string, Lark>;
  
  constructor(clients: Map<string, Lark>) {
    this.clients = clients;
  }
  
  private getClient(accountId: string = 'default'): Lark {
    const client = this.clients.get(accountId);
    if (!client) {
      throw new Error(`Client for account ${accountId} not found`);
    }
    return client;
  }
  
  async sendText(chatId: string, text: string, accountId?: string): Promise<string> {
    const client = this.getClient(accountId);
    
    const result = await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });
    
    return result.data?.message_id || '';
  }
  
  async sendRichText(chatId: string, content: string, accountId?: string): Promise<string> {
    const client = this.getClient(accountId);
    
    // Markdown 转飞书 post 格式
    const postContent = this.markdownToPost(content);
    
    const result = await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'post',
        content: JSON.stringify({ post: postContent }),
      },
    });
    
    return result.data?.message_id || '';
  }
  
  async sendImage(chatId: string, imageKey: string, accountId?: string): Promise<string> {
    const client = this.getClient(accountId);
    
    const result = await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'image',
        content: JSON.stringify({ image_key: imageKey }),
      },
    });
    
    return result.data?.message_id || '';
  }
  
  async sendFile(chatId: string, fileKey: string, accountId?: string): Promise<string> {
    const client = this.getClient(accountId);
    
    const result = await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'file',
        content: JSON.stringify({ file_key: fileKey }),
      },
    });
    
    return result.data?.message_id || '';
  }
  
  async sendCard(chatId: string, card: any, accountId?: string): Promise<string> {
    const client = this.getClient(accountId);
    
    const result = await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    });
    
    return result.data?.message_id || '';
  }
  
  async reply(messageId: string, content: string, accountId?: string): Promise<string> {
    const client = this.getClient(accountId);
    
    const result = await client.im.message.reply({
      path: { message_id: messageId },
      data: {
        msg_type: 'text',
        content: JSON.stringify({ text: content }),
      },
    });
    
    return result.data?.message_id || '';
  }
  
  // Markdown 转飞书 post 格式
  private markdownToPost(markdown: string): object {
    // 简化实现：按行转换为飞书元素
    const lines = markdown.split('\n');
    const elements: any[] = [];
    
    for (const line of lines) {
      if (line.startsWith('# ')) {
        elements.push({ tag: 'h1', text: { tag: 'text', content: line.slice(2) } });
      } else if (line.startsWith('## ')) {
        elements.push({ tag: 'h2', text: { tag: 'text', content: line.slice(3) } });
      } else if (line.startsWith('### ')) {
        elements.push({ tag: 'h3', text: { tag: 'text', content: line.slice(4) } });
      } else if (line.trim()) {
        elements.push({ tag: 'div', text: { tag: 'text', content: line } });
      }
    }
    
    return {
      zh_cn: {
        title: '',
        elements,
      },
    };
  }
}
```

## 五、Channel 管理器

### 5.1 Channel 注册表

```typescript
// src/channels/registry.ts

import type { ChannelPlugin } from './types.js';

export class ChannelRegistry {
  private channels: Map<string, ChannelPlugin> = new Map();
  
  // 注册 Channel
  register(channel: ChannelPlugin): void {
    if (this.channels.has(channel.id)) {
      console.warn(`Channel ${channel.id} already registered, overwriting...`);
    }
    this.channels.set(channel.id, channel);
    console.log(`[ChannelRegistry] Registered: ${channel.id}`);
  }
  
  // 获取 Channel
  get(id: string): ChannelPlugin | undefined {
    return this.channels.get(id);
  }
  
  // 获取所有 Channel
  getAll(): ChannelPlugin[] {
    return Array.from(this.channels.values());
  }
  
  // 检查是否已注册
  has(id: string): boolean {
    return this.channels.has(id);
  }
  
  // 列出所有 Channel ID
  listIds(): string[] {
    return Array.from(this.channels.keys());
  }
}
```

### 5.2 Channel 管理器

```typescript
// src/channels/manager.ts

import { ChannelRegistry } from './registry.js';
import { MessageRouter } from './router.js';
import type { ChannelPlugin, ChannelMessage, MessageSource } from './types.js';
import type { SessionManager } from '../session/manager.js';

export class ChannelManager {
  private registry: ChannelRegistry;
  private router: MessageRouter;
  private sessionManager: SessionManager;
  private startedChannels: Set<string> = new Set();
  
  constructor(sessionManager: SessionManager) {
    this.registry = new ChannelRegistry();
    this.router = new MessageRouter(sessionManager);
    this.sessionManager = sessionManager;
  }
  
  // 注册 Channel
  register(channel: ChannelPlugin): void {
    this.registry.register(channel);
    
    // 如果 Channel 有消息处理，设置路由
    if (channel.messaging) {
      // 设置消息处理器
      console.log(`[ChannelManager] Channel ${channel.id} ready`);
    }
  }
  
  // 启动所有 Channel
  async startAll(): Promise<void> {
    const channels = this.registry.getAll();
    
    for (const channel of channels) {
      if (channel.config.isConfigured()) {
        try {
          await channel.start();
          this.startedChannels.add(channel.id);
          console.log(`[ChannelManager] Started: ${channel.id}`);
        } catch (error) {
          console.error(`[ChannelManager] Failed to start ${channel.id}:`, error);
        }
      }
    }
  }
  
  // 停止所有 Channel
  async stopAll(): Promise<void> {
    const channels = this.registry.getAll();
    
    for (const channel of channels) {
      try {
        await channel.stop();
        this.startedChannels.delete(channel.id);
        console.log(`[ChannelManager] Stopped: ${channel.id}`);
      } catch (error) {
        console.error(`[ChannelManager] Failed to stop ${channel.id}:`, error);
      }
    }
  }
  
  // 获取 Channel
  get(id: string): ChannelPlugin | undefined {
    return this.registry.get(id);
  }
  
  // 列出所有 Channel
  list(): ChannelPlugin[] {
    return this.registry.getAll();
  }
  
  // 发送消息到指定 Channel
  async sendMessage(
    channelId: string, 
    chatId: string, 
    content: string,
    options?: { type?: string; accountId?: string }
  ): Promise<string> {
    const channel = this.registry.get(channelId);
    if (!channel || !channel.outbound) {
      throw new Error(`Channel ${channelId} or outbound not available`);
    }
    
    switch (options?.type) {
      case 'rich_text':
        return channel.outbound.sendRichText(chatId, content, options.accountId);
      case 'image':
        return channel.outbound.sendImage(chatId, content, options.accountId);
      case 'file':
        return channel.outbound.sendFile(chatId, content, options.accountId);
      case 'card':
        return channel.outbound.sendCard(chatId, JSON.parse(content), options.accountId);
      default:
        return channel.outbound.sendText(chatId, content, options.accountId);
    }
  }
}
```

### 5.3 消息路由器

```typescript
// src/channels/router.ts

import type { ChannelMessage, MessageSource, ChannelPlugin } from './types.js';
import type { SessionManager, Session } from '../session/index.js';

export class MessageRouter {
  private sessionManager: SessionManager;
  private channelSessions: Map<string, Session> = new Map(); // channel:chatId -> session
  
  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }
  
  // 处理收到的消息
  async route(message: ChannelMessage, channel: ChannelPlugin): Promise<void> {
    const { source } = message;
    
    // 1. 安全检查
    if (channel.security) {
      const checkResult = await channel.security.checkAllow(source);
      if (!checkResult.allowed) {
        console.log(`[MessageRouter] Message blocked: ${checkResult.reason}`);
        return;
      }
    }
    
    // 2. 获取或创建会话
    const session = await this.getOrCreateSession(source, channel);
    
    // 3. 发送消息到 Agent
    await session.send({
      type: 'message',
      content: message.content.content,
      metadata: {
        channelId: source.channelId,
        chatId: source.chatId,
        chatType: source.chatType,
        messageId: source.messageId,
        senderId: source.senderId,
      },
    });
    
    // 4. 订阅 Agent 响应
    session.on('response', async (response) => {
      await this.sendResponse(source, response.content, channel);
    });
  }
  
  private async getOrCreateSession(
    source: MessageSource, 
    channel: ChannelPlugin
  ): Promise<Session> {
    // 生成会话 key
    const sessionKey = `${source.channelId}:${source.accountId}:${source.chatId}`;
    
    // 尝试获取已有会话
    let session = this.channelSessions.get(sessionKey);
    
    if (!session) {
      // 创建新会话
      session = await this.sessionManager.createSession({
        provider: source.channelId,
        context: {
          chatId: source.chatId,
          chatType: source.chatType,
          accountId: source.accountId,
        },
      });
      
      this.channelSessions.set(sessionKey, session);
    }
    
    return session;
  }
  
  private async sendResponse(
    source: MessageSource, 
    content: string,
    channel: ChannelPlugin
  ): Promise<void> {
    if (!channel.outbound) return;
    
    // 如果支持流式响应
    if (channel.streaming) {
      // 流式发送
      await channel.streaming.stream(source.chatId, content);
    } else {
      // 普通发送
      await channel.outbound.sendRichText(source.chatId, content);
    }
  }
}
```

## 六、与现有系统集成

### 6.1 Server 集成

```typescript
// src/server/server.ts

import { ChannelManager } from '../channels/manager.js';
import { FeishuChannel } from '../channels/implementations/feishu/index.js';

export class AgentServer {
  private channelManager: ChannelManager;
  
  constructor(options: ServerOptions) {
    super(options);
    
    // 初始化 Channel 管理器
    this.channelManager = new ChannelManager(this.sessionManager);
    
    // 注册 Channel 插件
    this.registerChannels();
  }
  
  private registerChannels(): void {
    // 注册飞书
    if (this.env.feishu?.enabled) {
      const feishuChannel = new FeishuChannel(this.env.feishu);
      this.channelManager.register(feishuChannel);
    }
    
    // 注册 Telegram（未来扩展）
    // if (this.env.telegram?.enabled) { ... }
    
    // 注册 Discord（未来扩展）
    // if (this.env.discord?.enabled) { ... }
  }
  
  async start(): Promise<void> {
    // 启动 HTTP Server
    await super.start();
    
    // 启动所有 Channel
    await this.channelManager.startAll();
  }
  
  async stop(): Promise<void> {
    // 停止所有 Channel
    await this.channelManager.stopAll();
    
    // 停止 HTTP Server
    await super.stop();
  }
  
  // 发送消息到指定 Channel
  async sendToChannel(
    channelId: string,
    chatId: string,
    content: string,
    options?: SendOptions
  ): Promise<string> {
    return this.channelManager.sendMessage(channelId, chatId, content, options);
  }
}
```

### 6.2 配置结构

```typescript
// src/server/environment.ts

export interface ServerEnvironment {
  // 飞书配置
  feishu?: FeishuEnvConfig;
  
  // Telegram 配置（未来）
  telegram?: TelegramEnvConfig;
  
  // Discord 配置（未来）
  discord?: DiscordEnvConfig;
}

export interface FeishuEnvConfig {
  enabled: boolean;
  accounts: FeishuAccountConfig[];
  policies?: FeishuPolicies;
  streaming?: boolean;
}

export interface FeishuAccountConfig {
  id: string;
  appId: string;
  appSecret: string;
  domain?: 'feishu' | 'lark';
}

export interface FeishuPolicies {
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'disabled';
  groupPolicy: 'open' | 'allowlist' | 'disabled';
  allowFrom?: string[];
  requireMention?: boolean;
}
```

## 七、实施计划

### 阶段一：Channel 框架（2-3天）

| 任务 | 内容 |
|------|------|
| 定义类型 | `src/channels/types.ts` |
| 定义适配器接口 | `src/channels/adapters/types.ts` |
| Channel 基类 | `src/channels/base/base-channel.ts` |
| Channel 注册表 | `src/channels/registry.ts` |
| Channel 管理器 | `src/channels/manager.ts` |
| 消息路由器 | `src/channels/router.ts` |

### 阶段二：飞书 Channel（3-5天）

| 任务 | 内容 |
|------|------|
| 配置模块 | `implementations/feishu/config.ts` |
| Gateway 适配器 | `implementations/feishu/gateway.ts` |
| Messaging 适配器 | `implementations/feishu/messaging.ts` |
| Outbound 适配器 | `implementations/feishu/outbound.ts` |
| Streaming 适配器 | `implementations/feishu/streaming.ts` |
| Security 适配器 | `implementations/feishu/security.ts` |
| 飞书 Channel 入口 | `implementations/feishu/index.ts` |

### 阶段三：访问控制（1-2天）

| 任务 | 内容 |
|------|------|
| Pairing 适配器 | `implementations/feishu/pairing.ts` |
| Groups 适配器 | `implementations/feishu/groups.ts` |
| Commands 适配器 | `implementations/feishu/commands.ts` |

### 阶段四：辅助功能（1-2天）

| 任务 | 内容 |
|------|------|
| Status 适配器 | `implementations/feishu/status.ts` |
| Directory 适配器 | `implementations/feishu/directory.ts` |
| Server 集成 | `src/server/server.ts` |
| 环境配置 | 环境变量支持 |

### 阶段五：扩展其他 Channel（后续）

| 任务 | 内容 |
|------|------|
| Telegram Channel | `implementations/telegram/` |
| Discord Channel | `implementations/discord/` |

## 八、关键设计原则

| 原则 | 说明 |
|------|------|
| **接口驱动** | 通过 Channel 适配器接口定义能力，具体实现可按需实现 |
| **按需实现** | Channel 插件只需实现必要的适配器，不需要全部17种 |
| **统一管理** | 通过 ChannelManager 统一管理所有 Channel 的生命周期 |
| **消息路由** | MessageRouter 负责消息分发，支持会话管理 |
| **配置驱动** | 通过环境变量或配置文件控制 Channel 的启用和参数 |
| **错误隔离** | 单个 Channel 的错误不影响其他 Channel |

## 九、与 OpenClaw 对比

| 特性 | OpenClaw | agent-core |
|------|----------|------------|
| 架构 | 完整 Plugin 体系 | 精简 Channel 框架 |
| 适配器 | 17种（强制实现） | 17种（按需实现） |
| 配置 | YAML 文件 | 环境变量 + 代码 |
| 消息处理 | dispatchReplyWithBufferedBlockDispatcher | Session.send() + 事件订阅 |
| 复杂度 | 高 | 中 |
| 扩展性 | 高 | 高 |
| 学习成本 | 较高 | 较低 |
