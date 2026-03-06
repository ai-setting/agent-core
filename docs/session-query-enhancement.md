# Session 查询增强方案

## 一、目标

增强 session 的查询能力，支持：
1. 根据 metadata 精确匹配查询 session
2. 分页获取 session 列表（支持时间区间过滤）
3. 分页获取 session 的消息
4. EventHandlerAgent 创建 session 时自动记录创建时间，并在处理事件时可获取相关历史消息

---

## 二、SQLite 存储层 (`session/sqlite/index.ts`)

### 2.1 新增方法

```typescript
interface SessionFilter {
  metadata?: Record<string, unknown>;
  timeRange?: {
    start?: number;  // 毫秒时间戳
    end?: number;
  };
}

interface ListOptions {
  offset?: number;
  limit?: number;
}

/**
 * 分页获取 session 列表（支持时间和 metadata 过滤）
 * @param filter - 过滤条件
 * @param options - 分页选项
 */
async listSessions(
  filter?: SessionFilter,
  options?: ListOptions
): Promise<{ total: number; sessions: SessionInfo[] }>

/**
 * 根据 metadata 精确匹配查询，返回 sessionId 列表
 * @param metadata - 需要精确匹配的 key-value 对
 */
async findSessionIdsByMetadata(
  metadata: Record<string, unknown>
): Promise<string[]>

/**
 * 分页获取指定 session 的消息
 * @param sessionId - 会话 ID
 * @param options - 分页选项
 */
async getSessionMessages(
  sessionId: string,
  options?: ListOptions
): Promise<{ total: number; messages: MessageInfo[] }>
```

### 2.2 SQL 查询逻辑

```sql
-- findSessionIdsByMetadata
-- 条件：session.metadata 包含所有传入的 key-value
-- 例如传入 { chat_id: "xxx", trigger_type: "event" }
SELECT id FROM session 
WHERE metadata IS NOT NULL
  AND json_extract(metadata, '$.chat_id') = 'xxx'
  AND json_extract(metadata, '$.trigger_type') = 'event'
ORDER BY time_updated DESC

-- listSessions 带时间过滤
SELECT * FROM session 
WHERE time_created >= ? AND time_created <= ?
ORDER BY time_updated DESC
LIMIT ? OFFSET ?

-- getSessionMessages
SELECT id, role, content, timestamp FROM message 
WHERE session_id = ?
ORDER BY timestamp ASC
LIMIT ? OFFSET ?
```

---

## 三、Storage 层 (`session/storage.ts`)

### 3.1 新增方法

```typescript
/**
 * 根据 metadata 精确匹配查询
 */
findSessionIdsByMetadata(metadata: Record<string, unknown>): string[]

/**
 * 分页获取 session（支持时间和 metadata 过滤）
 */
listSessionInfos(
  filter?: SessionFilter,
  options?: ListOptions
): { total: number; sessions: SessionInfo[] }

/**
 * 分页获取 session 消息
 */
getSessionMessages(
  sessionId: string,
  options?: ListOptions
): { total: number; messages: MessageWithParts[] }
```

### 3.2 现有方法改造

```typescript
// 改造 listSessions 支持 filter
listSessions(filter?: SessionFilter, options?: ListOptions): Session[]

// 改造 listSessionInfos 支持 filter  
listSessionInfos(filter?: SessionFilter, options?: ListOptions): SessionInfo[]
```

---

## 四、Environment 接口 (`core/environment/index.ts`)

### 4.1 新增接口

```typescript
/**
 * 分页获取 session 列表（支持时间和 metadata 过滤）
 */
listSessionInfos?(
  filter?: {
    metadata?: Record<string, unknown>;
    timeRange?: { start?: number; end?: number };
  },
  options?: { offset?: number; limit?: number }
): Promise<{
  total: number;
  sessions: Array<{
    id: string;
    title: string;
    metadata?: Record<string, unknown>;
    created_at: string;  // ISO 格式
    updated_at: string;
  }>;
}>

/**
 * 根据 metadata 查找 sessionIds
 */
findSessionsByMetadata?(
  metadata: Record<string, unknown>
): Promise<string[]>

/**
 * 分页获取 session 消息
 */
getSessionMessages?(
  sessionId: string,
  options?: { offset?: number; limit?: number }
): Promise<{
  total: number;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    timestamp: string;
  }>;
}>
```

---

## 五、ServerEnvironment 实现 (`server/environment.ts`)

### 5.1 实现接口

实现 `listSessionInfos`, `findSessionsByMetadata`, `getSessionMessages` 三个方法。

### 5.2 注册 Tool（可选，未来实现）

预留 tool 接口定义，暂不实现。

---

## 六、EventHandlerAgent 集成 (`core/agent/event-handler-agent.ts`)

### 6.1 创建 session 时自动记录创建时间

```typescript
private async createFallbackSession<T>(event: EnvEvent<T>): Promise<any> {
  const metadata: Record<string, unknown> = {
    trigger_type: "event",
    created_at: Date.now(),  // 新增：记录创建时间
    event_type: event.type,
    event_id: event.id,
    ...event.metadata,  // 包含 chat_id 等
  };
  
  const newSession = await this.env.createSession?.({ 
    title: fallbackTitle,
    metadata,
  });
  
  return newSession;
}
```

### 6.2 获取相关历史消息（新增逻辑）

```typescript
private async getRelatedSessionHistory<T>(event: EnvEvent<T>): Promise<void> {
  // 如果有 chat_id，尝试获取相关历史消息
  const chatId = event.metadata?.chat_id as string | undefined;
  if (!chatId || !this.env.findSessionsByMetadata) {
    return;
  }
  
  // 查找相关 sessionIds
  const relatedSessionIds = await this.env.findSessionsByMetadata({
    chat_id: chatId,
  });
  
  if (relatedSessionIds.length === 0) {
    return;
  }
  
  // 获取最近的相关 session 的历史消息
  const recentSessionId = relatedSessionIds[0];
  const result = await this.env.getSessionMessages?.(recentSessionId, {
    offset: 0,
    limit: 50,
  });
  
  if (result && result.messages.length > 0) {
    // 将历史消息加入 context
    // ...
  }
}
```

---

## 七、查询流程（过滤顺序）

```
输入: { 
  metadata: { chat_id: "xxx", trigger_type: "event" },
  timeRange: { start: 1700000000000, end: 1700100000000 },
  offset: 0, 
  limit: 10 
}

执行顺序:
1. 构建 SQL WHERE 条件：
   - json_extract(metadata, '$.chat_id') = 'xxx'
   - AND json_extract(metadata, '$.trigger_type') = 'event'
   - AND time_created >= start_timestamp
   - AND time_created <= end_timestamp
2. 执行查询，获取 total 和分页数据
3. 转换时间格式为 ISO 字符串返回
```

---

## 八、单测设计

### 8.1 SQLite 层 (`sqlite/index.test.ts`)

```typescript
describe("listSessions with filter", () => {
  it("should filter by time range", async () => {
    // 1. 插入不同时间的 session
    // 2. 查询特定时间区间
    // 3. 验证返回结果只包含区间内的 session
  });
  
  it("should filter by metadata", async () => {
    // 1. 插入带有不同 metadata 的 session
    // 2. 查询特定 metadata
    // 3. 验证精确匹配
  });
  
  it("should return total count regardless of pagination", async () => {
    // 1. 插入 100 条 session
    // 2. limit=10
    // 3. 验证 total=100, sessions.length=10
  });
  
  it("should apply offset and limit correctly", async () => {
    // 1. 插入 20 条 session
    // 2. offset=10, limit=5
    // 3. 验证返回第 11-15 条
  });
});

describe("findSessionIdsByMetadata", () => {
  it("should find sessions by single metadata key", async () => {
    // 1. 插入 session with metadata: { chat_id: "xxx" }
    // 2. 查询 { chat_id: "xxx" }
    // 3. 验证返回正确的 sessionIds
  });
  
  it("should find sessions by multiple metadata keys", async () => {
    // 1. 插入 session with metadata: { chat_id: "xxx", trigger_type: "event" }
    // 2. 查询 { chat_id: "xxx", trigger_type: "event" }
    // 3. 验证精确匹配
  });
  
  it("should return empty for non-matching metadata", async () => {
    // 1. 插入 session with metadata: { chat_id: "xxx" }
    // 2. 查询 { chat_id: "yyy" }
    // 3. 验证返回空数组
  });
});

describe("getSessionMessages", () => {
  it("should return paginated messages", async () => {
    // 1. 插入 50 条消息到 session
    // 2. offset=10, limit=10
    // 3. 验证 total=50, messages.length=10
    // 4. 验证返回的是第 11-20 条
  });
  
  it("should return empty for non-existent session", async () => {
    // 1. 查询不存在的 session
    // 2. 验证返回 total=0, messages=[]
  });
});
```

### 8.2 Storage 层 (`storage.test.ts`)

```typescript
describe("listSessionInfos", () => {
  it("should filter by time range", () => {
    // 验证时间过滤
  });
  
  it("should filter by metadata", () => {
    // 验证 metadata 过滤
  });
  
  it("should return correct pagination info", () => {
    // 验证 total 和分页
  });
});

describe("findSessionIdsByMetadata", () => {
  it("should return session ids matching metadata", () => {
    // 验证返回正确的 id 列表
  });
});

describe("getSessionMessages", () => {
  it("should return formatted message info", () => {
    // 验证返回格式正确
  });
});
```

### 8.3 EventHandlerAgent (`event-handler-agent.test.ts`)

```typescript
describe("createFallbackSession", () => {
  it("should include created_at in metadata", async () => {
    // 1. 创建 fallback session
    // 2. 验证 metadata 中包含 created_at
  });
  
  it("should include event metadata in session metadata", async () => {
    // 1. 创建带有 chat_id 的 event
    // 2. 创建 fallback session
    // 3. 验证 session.metadata 包含 chat_id
  });
});

describe("getRelatedSessionHistory", () => {
  it("should fetch related sessions by chat_id", async () => {
    // 1. 预设相关 session
    // 2. 传入带 chat_id 的 event
    // 3. 验证获取到相关历史消息
  });
  
  it("should do nothing when no chat_id", async () => {
    // 1. 传入不带 chat_id 的 event
    // 2. 验证不调用 findSessionsByMetadata
  });
  
  it("should do nothing when no related sessions found", async () => {
    // 1. 传入带 chat_id 的 event
    // 2. 但没有相关 session
    // 3. 验证正常处理，不报错
  });
});
```

### 8.4 Environment 接口 (`environment.test.ts`)

```typescript
describe("listSessionInfos", () => {
  it("should return formatted session info with ISO dates", async () => {
    // 1. 调用 listSessionInfos
    // 2. 验证返回的日期是 ISO 格式字符串
  });
  
  it("should pass filter and options to storage", async () => {
    // 1. 调用带 filter 和 options
    // 2. 验证传递给 storage 层
  });
});

describe("findSessionsByMetadata", () => {
  it("should return session ids", async () => {
    // 1. 调用 findSessionsByMetadata
    // 2. 验证返回 string[]
  });
});

describe("getSessionMessages", () => {
  it("should return formatted messages with ISO dates", async () => {
    // 1. 调用 getSessionMessages
    // 2. 验证返回格式和 ISO 日期
  });
});
```

---

## 九、文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `session/sqlite/index.ts` | 新增 3 个查询方法：`listSessions`, `findSessionIdsByMetadata`, `getSessionMessages` |
| `session/storage.ts` | 新增 3 个查询方法，改造 `listSessions`/`listSessionInfos` 支持 filter |
| `session/types.ts` | 新增 `SessionFilter`, `ListOptions` 类型定义 |
| `environment/index.ts` | 新增 3 个接口定义 |
| `server/environment.ts` | 实现 3 个接口方法 |
| `core/agent/event-handler-agent.ts` | 创建 session 时添加 created_at，获取相关历史消息 |

---

## 十、注意事项

1. **时间过滤**：使用 `time_created` 字段进行过滤，与 SQLite 中的 `time_created` 列对应
2. **Metadata 过滤**：使用 `json_extract` 进行精确匹配
3. **分页**：offset 和 limit 都需要传入，避免默认值导致的边界问题
4. **返回值**：所有时间字段返回 ISO 格式字符串，便于前端展示
5. **向后兼容**：现有 `listSessions` 方法保持兼容，新增 `listSessionInfos` 提供更丰富的返回格式
