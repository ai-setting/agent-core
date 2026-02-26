# Provider System with AI SDK - End-to-End Testing Guide

## 测试检查清单

### Phase 1: 环境检查

- [ ] 确认 `providers.jsonc` 配置正确
- [ ] 确认环境变量已设置（至少一个 Provider 的 API Key）
- [ ] 运行 `bun run typecheck` 无错误
- [ ] 运行 `bun test` 所有测试通过

### Phase 2: ProviderManager 初始化测试

启动服务器，检查日志输出：

```bash
bun run start
```

期望看到日志：
```
[ServerEnvironment] ProviderManager initialized with X providers
```

### Phase 3: 基础对话测试

#### 测试 1: 简单文本生成（zhipuai）

1. 启动 TUI: `bun run attach http://localhost:3000`
2. 发送消息: "你好"
3. 期望结果:
   - 看到流式文本输出
   - 无报错
   - 日志中显示 `[invokeLLM] Starting with AI SDK`

#### 测试 2: Tool Call 测试

发送消息: "列出当前目录的文件"

期望结果:
   - LLM 调用 `glob` 工具
   - 正确显示工具调用结果
   - Stream events: `start` → `tool_call` → `completed`

#### 测试 3: 多轮对话

发送消息:
1. "创建一个名为 test.txt 的文件"
2. "现在删除它"

期望结果:
   - 第一轮创建文件
   - 第二轮正确引用 context 删除文件

### Phase 4: Provider 切换测试

#### 测试 4: 切换不同 Provider

修改 `~/.config/tong_work/agent-core/config.json`:

```json
{
  "defaultModel": "anthropic/claude-3-5-sonnet"
}
```

重启服务器，发送测试消息，确认使用新 Provider。

### Phase 5: Transform 层测试

#### 测试 5: Anthropic Provider（如有 API Key）

配置 anthropic provider，测试消息包含空内容的情况。

期望 Transform 层自动过滤空消息。

#### 测试 6: Mistral Model（如有 API Key）

测试 tool calls，验证 toolCallId 被正确规范化为 9 位。

### Phase 6: 错误处理测试

#### 测试 7: 无效 Provider

配置不存在的 provider ID，期望友好错误提示。

#### 测试 8: 无效 API Key

配置错误的 API Key，期望捕获错误并显示在 TUI。

#### 测试 9: 网络超时

断开网络，测试超时和重试机制。

## 性能测试

### 测试 10: 并发请求

同时打开多个会话，发送消息，检查：
- 响应时间
- 内存使用
- 无资源泄漏

## 日志检查

检查日志文件 `~/.local/share/tong_work/logs/server.log`：

```bash
# 检查 ProviderManager 初始化
grep "ProviderManager initialized" server.log

# 检查 AI SDK 调用
grep "invokeLLM\] Starting with AI SDK" server.log

# 检查 Transform 处理
grep "llm:transform" server.log

# 检查错误
grep "ERROR" server.log
```

## 调试技巧

### 1. 启用详细日志

设置环境变量：
```bash
LOG_LEVEL=debug bun run start
```

### 2. 测试特定 Provider

创建测试脚本 `test-provider.ts`：

```typescript
import { providerManager } from "./packages/core/src/llm/provider-manager.js";

async function test() {
  await providerManager.initialize();
  
  const provider = providerManager.getProvider("zhipuai");
  console.log("Provider:", provider?.metadata.name);
  console.log("Models:", provider?.metadata.models.map(m => m.id));
  
  // 测试调用
  const model = provider?.sdk.languageModel("glm-4");
  console.log("Model:", model);
}

test();
```

### 3. 检查 Transform 输出

在 `invoke-llm.ts` 中添加调试日志：

```typescript
console.log("Messages before transform:", JSON.stringify(messages, null, 2));
messages = LLMTransform.normalizeMessages(messages, provider.metadata, modelMetadata);
console.log("Messages after transform:", JSON.stringify(messages, null, 2));
```

## 已知限制

1. **首次启动**: ProviderManager 初始化可能需要几秒钟
2. **API Key**: 至少需要一个 Provider 的 API Key 才能正常工作
3. **模型缓存**: 模型元数据缓存在内存中，重启后重新加载

## 回滚计划

如果测试发现问题，可以回滚到旧版本：

```bash
# 查看提交历史
git log --oneline

# 回滚到 AI SDK 集成之前的版本
git checkout <commit-hash-before-ai-sdk>

# 或者使用备份文件
# invoke-llm.ts 有完整的旧版实现备份
```

## 成功标准

- [x] 所有单元测试通过 (25/25)
- [ ] 至少一个 Provider 能正常工作
- [ ] Tool calls 流程完整
- [ ] Stream events 正常触发
- [ ] 无内存泄漏
- [ ] TUI 界面响应正常
- [ ] 日志无 ERROR 级别错误

## 反馈收集

测试完成后，请记录：

1. 使用的 Provider 和 Model
2. 平均响应时间
3. 遇到的问题
4. 改进建议
