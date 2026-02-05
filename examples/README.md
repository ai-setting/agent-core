# Agent Core Examples

This directory contains example scripts demonstrating how to use the Agent Core framework.

## Setup

Before running any example, make sure to configure your `.env` file:

```env
# LLM Configuration
LLM_MODEL=openai/gpt-4o
LLM_API_KEY=sk-your-api-key
```

## Examples

### demo.ts - Quick Demo

Run a single query to test your configuration.

```bash
bun run examples/demo.ts
```

**Output:**
```
Model: openai/gpt-4o

Query: What is 2 + 2?
Thinking...
Answer: 2 + 2 = 4

Query: Say hello in exactly one word.
Thinking...
Answer: Hello

Demo complete! 👋
```

### chat.ts - Interactive Chat

Single query mode:

```bash
bun run examples/chat.ts "What is 2 + 2?"
```

## Supported Providers

The Agent Core automatically detects the provider from `LLM_MODEL`:

| Model | Provider | Default Base URL |
|-------|----------|-----------------|
| `openai/gpt-4o` | OpenAI | api.openai.com/v1 |
| `kimi/kimi-k2.5` | Kimi | api.moonshot.cn/v1 |
| `deepseek/deepseek-chat` | DeepSeek | api.deepseek.com |
| `groq/llama-3.3-70b-versatile` | Groq | api.groq.com/openai/v1 |
| `anthropic/claude-sonnet-4-20250514` | Anthropic | api.anthropic.com |
| `google/gemini-2.0-flash` | Google | api.google.com |
| And more... | | |

All providers use `LLM_API_KEY` or their specific environment variable (e.g., `OPENAI_API_KEY`).

## Available Tools

The OsEnv automatically registers these tools:

- **bash** - Execute bash commands
- **read_file** - Read file contents
- **write_file** - Write content to files
- **glob** - Find files by pattern
- **grep** - Search text in files
- **invoke_llm** - Internal LLM invocation (framework use)
- **system1_intuitive_reasoning** - Direct LLM calls for simple tasks
