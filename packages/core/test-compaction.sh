#!/bin/bash
# 自动发送多个请求到同一个 session 来触发压缩

SESSION_ID="test-compaction-$$"
PORT=4096

echo "=== 测试自动压缩功能 ==="
echo "Session ID: $SESSION_ID"
echo ""

# 发送多个请求来积累消息和 token 使用量
# 每次请求都会调用 invokeLLM，从而触发 updateContextUsage

echo "📝 发送第1个请求..."
curl -s -X POST "http://localhost:$PORT/sessions/$SESSION_ID/prompt" \
  -H "Content-Type: application/json" \
  -d '{"message": "我想学习 TypeScript，请给我介绍泛型的基本概念，并给出一个实际例子"}' | head -20

echo ""
echo "📝 发送第2个请求..."
curl -s -X POST "http://localhost:$PORT/sessions/$SESSION_ID/prompt" \
  -H "Content-Type: application/json" \
  -d '{"message": "很好，那能再解释一下泛型约束吗？"}' | head -20

echo ""
echo "📝 发送第3个请求..."
curl -s -X POST "http://localhost:$PORT/sessions/$SESSION_ID/prompt" \
  -H "Content-Type: application/json" \
  -d '{"message": "能否举一个完整的泛型实际项目例子？"}' | head -20

echo ""
echo "📝 发送第4个请求..."
curl -s -X POST "http://localhost:$PORT/sessions/$SESSION_ID/prompt" \
  -H "Content-Type: application/json" \
  -d '{"message": "最后问一下，如何处理 API 错误？"}' | head -20

echo ""
echo "📝 发送第5个请求..."
curl -s -X POST "http://localhost:$PORT/sessions/$SESSION_ID/prompt" \
  -H "Content-Type: application/json" \
  -d '{"message": "谢谢，请总结一下今天学习的内容"}' | head -20

echo ""
echo "=== 检查 session 状态 ==="
curl -s "http://localhost:$PORT/sessions/$SESSION_ID" | head -50

echo ""
echo "=== 完成 ==="
