# agent-core 飞书接入方案设计

## 一、概述

本文档设计 agent-core 项目接入飞书（Feishu/Lark）即时通讯平台的实现方案。方案参考 OpenClaw 的设计思路，但根据 agent-core 项目的架构特点进行适配。

## 二、架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      agent-core                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                     Server (Hono)                        │   │
│  │   - HTTP Server                                          │   │
│  │   - SSE 流式响应                                         │   │
│  │   - WebSocket 支持                                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                    │
│  ┌───────────────────────────┼───────────────────────────┐     │
│  │                    Feishu Channel                      │     │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │     │
│  │  │  FeishuBot   │  │  MessageHub  │  │  Sender    │  │     │
│  │  │  (机器人管理)  │  │  (消息路由)   │  │  (消息发送)  │  │     │
│  │  └──────────────┘  └──────────────┘  └────────────┘  │     │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │     │
│  │  │  AccessCtrl │  │  Formatter    │  │  Config    │  │     │
│  │  │  (访问控制)   │  │  (格式转换)   │  │  (配置管理)  │  │     │
│  │  └──────────────┘  └──────────────┘  └────────────┘  │     │
│  └───────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                  ┌────────────────────────┐
                  │   飞书开放平台           │
                  │   (WebSocket 长连接)    │
                  └────────────────────────┘
```

### 2.2 模块职责

| 模块 | 职责 | 位置 |
|------|------|------|
| **FeishuBot** | 机器人生命周期管理、WebSocket 连接维护 | `src/channels/feishu/bot.ts` |
| **MessageHub** | 消息接收、路由、分发给 Agent | `src/channels/feishu/hub.ts` |
| **Sender** | 消息发送（文本、图片、文件、卡片） | `src/channels/feishu/sender.ts` |
| **Formatter** | Markdown 与飞书富文本格式转换 | `src/channels/feishu/formatter.ts` |
| **AccessCtrl** | 访问控制（白名单、配对机制） | `src/channels/feishu/access.ts` |
| **Config** | 配置解析、多账号管理 | `src/channels/feishu/config.ts` |

## 三、技术选型

### 3.1 依赖库

| 库 | 版本 | 用途 |
|---|------|------|
| `@larksuiteoapi/node-sdk` | ^1.58.0 | 飞书官方 SDK |
| `ws` | ^8.0.0 | WebSocket 客户端（备用） |

### 3.2 通信方式

- **消息接收**: WebSocket 长连接（通过 EventDispatcher）
- **消息发送**: HTTP API 调用

## 四、核心模块设计

### 4.1 配置模块 (`config.ts`)

```typescript
// 配置文件结构
export interface FeishuConfig {
  enabled: boolean;
  accounts: FeishuAccount[];
  policies: FeishuPolicies;
  streaming?: boolean;
  historyLimit?: number;
}

export interface FeishuAccount {
  id: string;
  appId: string;
  appSecret: string;
  domain?: 'feishu' | 'lark';
}

export interface FeishuPolicies {
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'disabled';
  groupPolicy: 'open' | 'allowlist' | 'disabled';
  requireMention?: boolean;
  allowFrom?: string[];
}
```

### 4.2 机器人模块 (`bot.ts`)

```typescript
import { EventDispatcher, Event, WSClient, Lark } from '@larksuiteoapi/node-sdk';

export interface FeishuBotOptions {
  appId: string;
  appSecret: string;
  domain?: 'feishu' | 'lark';
}

export class FeishuBot {
  private client: Lark;
  private wsClient?: WSClient;
  private messageHandler?: (msg: FeishuMessage) => void;

  constructor(options: FeishuBotOptions) {
    this.client = new Lark({
      appId: options.appId,
      appSecret: options.appSecret,
      domain: options.domain || 'feishu',
    });
  }

  // 启动 WebSocket 长连接
  async start(onMessage: (msg: FeishuMessage) => void): Promise<void> {
    this.messageHandler = onMessage;
    
    const eventDispatcher = new EventDispatcher({
      'im.message.receive_v1': (event: Event) => this.handleMessage(event),
    });

    this.wsClient = new WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
    });

    await this.wsClient.start({ eventDispatcher });
  }

  // 停止连接
  async stop(): Promise<void> {
    await this.wsClient?.stop();
  }

  private handleMessage(event: Event): void {
    // 解析消息并触发回调
    const message = parseMessage(event);
    this.messageHandler?.(message);
  }
}
```

### 4.3 消息中心 (`hub.ts`)

```typescript
import type { Session } from '../../core/session/index.js';

export interface FeishuMessage {
  messageId: string;
  chatId: string;
  chatType: 'group' | 'dm';
  messageType: 'text' | 'image' | 'file' | 'audio';
  content: string;
  senderId: string;
  senderType: 'user' | 'bot';
}

export class MessageHub {
  private sessionManager: SessionManager;
  private sender: MessageSender;
  private accessCtrl: AccessController;

  constructor(
    sessionManager: SessionManager,
    sender: MessageSender,
    accessCtrl: AccessController
  ) {}

  // 处理接收到的消息
  async handleMessage(msg: FeishuMessage): Promise<void> {
    // 1. 访问控制检查
    const allowed = await this.accessCtrl.check(msg);
    if (!allowed) {
      return;
    }

    // 2. 获取或创建会话
    const session = await this.getOrCreateSession(msg);

    // 3. 发送用户消息到 Agent
    await session.send({
      type: 'message',
      content: msg.content,
      metadata: {
        provider: 'feishu',
        chatId: msg.chatId,
        chatType: msg.chatType,
        messageId: msg.messageId,
      },
    });

    // 4. 订阅 Agent 响应
    session.on('response', (response) => {
      this.sender.send(msg.chatId, response.content);
    });
  }

  private async getOrCreateSession(msg: FeishuMessage): Promise<Session> {
    // 根据 chatId 映射到对应的 session
    // 私聊: 每个用户一个 session
    // 群聊: 每个群一个 session
  }
}
```

### 4.4 消息发送 (`sender.ts`)

```typescript
export class MessageSender {
  private client: Lark;

  async sendText(chatId: string, text: string): Promise<void> {
    await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });
  }

  async sendRichText(chatId: string, markdown: string): Promise<void> {
    const postContent = this.markdownToFeishuPost(markdown);
    
    await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'post',
        content: JSON.stringify(postContent),
      },
    });
  }

  async sendInteractiveCard(chatId: string, card: Card): Promise<void> {
    await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    });
  }

  // Markdown 转飞书 post 格式
  private markdownToFeishuPost(markdown: string): object {
    // 实现转换逻辑
  }
}
```

### 4.5 访问控制 (`access.ts`)

```typescript
export type Policy = 'open' | 'allowlist' | 'pairing' | 'disabled';

export class AccessController {
  private config: FeishuPolicies;
  private pairingStore: Map<string, PairingRequest>;

  async check(msg: FeishuMessage): Promise<boolean> {
    const policy = msg.chatType === 'dm' 
      ? this.config.dmPolicy 
      : this.config.groupPolicy;

    switch (policy) {
      case 'open':
        return true;
      case 'disabled':
        return false;
      case 'allowlist':
        return this.checkAllowlist(msg.senderId);
      case 'pairing':
        return this.checkPairing(msg);
    }
  }

  private async checkPairing(msg: FeishuMessage): Promise<boolean> {
    // 配对机制实现
    // 1. 检查是否已在白名单
    // 2. 检查是否有待审批的配对请求
    // 3. 发送配对引导消息
  }
}
```

## 五、与现有系统集成

### 5.1 Server 集成

在 `AgentServer` 中添加飞书通道支持：

```typescript
// src/server/server.ts
import { FeishuChannel } from '../channels/feishu/index.js';

export class AgentServer {
  private feishuChannel?: FeishuChannel;

  async start(): Promise<void> {
    // 启动 HTTP Server
    await super.start();

    // 启动飞书通道
    if (this.env.feishuConfig?.enabled) {
      this.feishuChannel = new FeishuChannel(this.env);
      await this.feishuChannel.start();
    }
  }

  async stop(): Promise<void> {
    await this.feishuChannel?.stop();
    await super.stop();
  }
}
```

### 5.2 Session 集成

飞书消息通过 `MessageHub` 映射到 `Session`：

```typescript
// 群聊: chatId -> session
// 私聊: senderId -> session
// 支持多账号: accountId + chatId -> session
```

### 5.3 环境配置

```typescript
// src/server/environment.ts
export interface ServerEnvironment {
  // 现有配置...
  
  // 飞书配置
  feishu?: FeishuConfig;
}
```

## 六、实施计划

### 阶段一：基础框架（1-2天）

1. 创建 `src/channels/feishu/` 目录结构
2. 实现配置模块 (`config.ts`)
3. 实现机器人模块 (`bot.ts`)，支持 WebSocket 连接
4. 基础消息接收

### 阶段二：消息处理（2-3天）

1. 实现消息解析 (`message.ts`)
2. 实现消息中心 (`hub.ts`)
3. 与 Session 模块集成
4. 实现消息发送 (`sender.ts`)
5. 格式转换 (`formatter.ts`)

### 阶段三：访问控制（1-2天）

1. 白名单机制
2. 配对机制
3. 群聊 @mention 处理

### 阶段四：高级功能（1-2天）

1. 流式卡片响应
2. 媒体文件处理
3. 多账号支持
4. 健康检查与监控

## 七、配置示例

### 7.1 环境变量

```bash
# 飞书配置
FEISHU_ENABLED=true
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=yyy
FEISHU_DOMAIN=feishu

# 访问策略
FEISHU_DM_POLICY=pairing
FEISHU_GROUP_POLICY=open
FEISHU_REQUIRE_MENTION=true

# 功能开关
FEISHU_STREAMING=true
FEISHU_HISTORY_LIMIT=10
```

### 7.2 代码配置

```typescript
// src/env.ts
export const feishuConfig = {
  enabled: process.env.FEISHU_ENABLED === 'true',
  accounts: [{
    id: 'default',
    appId: process.env.FEISHU_APP_ID!,
    appSecret: process.env.FEISHU_APP_SECRET!,
    domain: process.env.FEISHU_DOMAIN as 'feishu' | 'lark' || 'feishu',
  }],
  policies: {
    dmPolicy: process.env.FEISHU_DM_POLICY as Policy || 'pairing',
    groupPolicy: process.env.FEISHU_GROUP_POLICY as Policy || 'open',
    requireMention: process.env.FEISHU_REQUIRE_MENTION === 'true',
  },
  streaming: process.env.FEISHU_STREAMING === 'true',
  historyLimit: parseInt(process.env.FEISHU_HISTORY_LIMIT || '10'),
};
```

## 八、关键差异对比

| 特性 | OpenClaw | agent-core 方案 |
|------|----------|----------------|
| 架构 | 插件化 (Plugin/Channel) | 模块化 (Channel 模块) |
| 框架 | 自研 | Hono |
| 消息处理 | dispatchReplyWithBufferedBlockDispatcher | Session.send() + 事件订阅 |
| 配置 | YAML 文件 | 环境变量 + 代码配置 |
| 复杂度 | 高（17种适配器） | 中（精简为6个模块） |

## 九、总结

本方案将飞书接入设计为一个独立的 Channel 模块，通过以下方式与 agent-core 集成：

1. **模块化设计**: 独立的 `FeishuChannel`，职责清晰
2. **Hono 集成**: 利用现有 HTTP Server 基础设施
3. **Session 映射**: 消息通过 Session 与 Agent 交互
4. **配置驱动**: 通过环境变量或代码配置控制

方案保留了 OpenClaw 的核心特性（多账号、访问控制、流式卡片），同时适配了 agent-core 的架构特点，降低了实现复杂度。
