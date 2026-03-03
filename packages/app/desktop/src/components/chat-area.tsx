'use client'

import { useApp } from '@/lib/store'
import type { Message } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Terminal,
  FileText,
  Bot,
  User,
  Brain,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import { useState, useRef, useEffect, useCallback } from 'react'

function FormattedTime({ timestamp }: { timestamp: string }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return <span>&nbsp;</span>
  return <>{new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</>
}

// ============================================
// Markdown Renderer (Simplified)
// ============================================

function renderMarkdown(content: string) {
  if (!content) return null

  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let inCodeBlock = false
  let codeBlockLang = ''
  let codeBlockContent: string[] = []
  let inTable = false
  let tableRows: string[][] = []
  let tableHeader: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Code block
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeBlockLang = line.slice(3).trim()
        codeBlockContent = []
      } else {
        elements.push(
          <CodeBlock key={`code-${i}`} language={codeBlockLang} code={codeBlockContent.join('\n')} />
        )
        inCodeBlock = false
        codeBlockLang = ''
        codeBlockContent = []
      }
      continue
    }

    if (inCodeBlock) {
      codeBlockContent.push(line)
      continue
    }

    // Table
    if (line.includes('|') && line.trim().startsWith('|')) {
      const cells = line.split('|').filter(c => c.trim()).map(c => c.trim())
      if (!inTable) {
        inTable = true
        tableHeader = cells
        tableRows = []
      } else if (line.match(/^\|[\s-|]+\|$/)) {
        // separator row, skip
        continue
      } else {
        tableRows.push(cells)
      }
      // Check if next line ends the table
      const nextLine = lines[i + 1]
      if (!nextLine || !nextLine.includes('|') || !nextLine.trim().startsWith('|')) {
        elements.push(
          <div key={`table-${i}`} className="my-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  {tableHeader.map((h, hi) => (
                    <th key={hi} className="px-3 py-2 text-left font-medium text-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, ri) => (
                  <tr key={ri} className="border-b border-border/50 last:border-0">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 text-muted-foreground">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
        inTable = false
        tableHeader = []
        tableRows = []
      }
      continue
    }

    // Headers
    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-base font-semibold text-foreground mt-4 mb-2">{line.slice(4)}</h3>)
      continue
    }
    if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-lg font-semibold text-foreground mt-4 mb-2">{line.slice(3)}</h2>)
      continue
    }
    if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-xl font-bold text-foreground mt-4 mb-2">{line.slice(2)}</h1>)
      continue
    }

    // Blockquote
    if (line.startsWith('> ')) {
      elements.push(
        <blockquote key={i} className="border-l-2 border-primary/50 pl-3 my-2 text-muted-foreground italic">
          {renderInline(line.slice(2))}
        </blockquote>
      )
      continue
    }

    // Unordered list
    if (line.match(/^[-*] /)) {
      elements.push(
        <li key={i} className="ml-4 text-sm leading-relaxed text-foreground/90 list-disc">
          {renderInline(line.slice(2))}
        </li>
      )
      continue
    }

    // Ordered list
    if (line.match(/^\d+\. /)) {
      const text = line.replace(/^\d+\.\s/, '')
      elements.push(
        <li key={i} className="ml-4 text-sm leading-relaxed text-foreground/90 list-decimal">
          {renderInline(text)}
        </li>
      )
      continue
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />)
      continue
    }

    // Regular paragraph
    elements.push(
      <p key={i} className="text-sm leading-relaxed text-foreground/90">
        {renderInline(line)}
      </p>
    )
  }

  return <>{elements}</>
}

function renderInline(text: string): React.ReactNode {
  // Bold
  const parts: React.ReactNode[] = []
  const regex = /(\*\*(.+?)\*\*)|(`(.+?)`)/g
  let lastIdx = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index))
    }
    if (match[2]) {
      parts.push(<strong key={match.index} className="font-semibold text-foreground">{match[2]}</strong>)
    } else if (match[4]) {
      parts.push(
        <code key={match.index} className="rounded bg-secondary px-1.5 py-0.5 text-xs font-mono text-primary">
          {match[4]}
        </code>
      )
    }
    lastIdx = match.index + match[0].length
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx))
  }

  return parts.length > 0 ? parts : text
}

// ============================================
// Code Block Component
// ============================================

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)

  const copyCode = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-3 rounded-lg border border-border overflow-hidden bg-[oklch(0.10_0.005_260)]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/30 border-b border-border">
        <span className="text-[11px] font-mono text-muted-foreground">{language || 'text'}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={copyCode}
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? '已复制' : '复制代码'}</TooltipContent>
        </Tooltip>
      </div>
      <pre className="p-3 overflow-x-auto">
        <code className="text-xs font-mono leading-relaxed text-foreground/90">{code}</code>
      </pre>
    </div>
  )
}

// ============================================
// Thinking Block
// ============================================

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className="mb-2 rounded-lg border border-border/50 bg-secondary/20 overflow-hidden cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <Brain className="size-3.5 text-primary" />
        <span className="text-xs font-medium text-primary">思考过程</span>
        {expanded ? (
          <ChevronDown className="size-3 text-muted-foreground ml-auto" />
        ) : (
          <ChevronRight className="size-3 text-muted-foreground ml-auto" />
        )}
      </div>
      {expanded && (
        <div className="px-3 pb-2 text-xs text-muted-foreground leading-relaxed border-t border-border/30 pt-2">
          {content}
        </div>
      )}
    </div>
  )
}

// ============================================
// Tool Call Block
// ============================================

function ToolCallBlock({ toolCall }: { toolCall: NonNullable<Message['toolCalls']>[number] }) {
  const [expanded, setExpanded] = useState(false)

  const statusIcon = {
    pending: <Loader2 className="size-3 text-muted-foreground animate-spin" />,
    running: <Loader2 className="size-3 text-primary animate-spin" />,
    completed: <CheckCircle2 className="size-3 text-success" />,
    error: <AlertCircle className="size-3 text-destructive" />,
  }

  const toolIcon = toolCall.name.includes('file') || toolCall.name.includes('read')
    ? <FileText className="size-3" />
    : <Terminal className="size-3" />

  return (
    <div className="my-1.5 rounded-lg border border-border/50 bg-secondary/20 overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-secondary/40 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {statusIcon[toolCall.status]}
        <span className="text-muted-foreground">{toolIcon}</span>
        <span className="text-xs font-mono text-foreground/80">{toolCall.name}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </span>
      </div>
      {expanded && (
        <div className="px-3 pb-2 border-t border-border/30 pt-2 space-y-1">
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">参数</span>
            <pre className="mt-0.5 text-xs font-mono text-foreground/70 bg-[oklch(0.10_0.005_260)] rounded px-2 py-1 overflow-x-auto">
              {toolCall.arguments}
            </pre>
          </div>
          {toolCall.result && (
            <div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">结果</span>
              <pre className="mt-0.5 text-xs font-mono text-foreground/70 bg-[oklch(0.10_0.005_260)] rounded px-2 py-1 overflow-x-auto">
                {toolCall.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================
// Message Bubble
// ============================================

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex gap-3 px-4 py-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="size-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="size-4 text-primary" />
        </div>
      )}
      <div className={cn('max-w-[80%] min-w-0', isUser ? 'order-1' : '')}>
        {/* Thinking */}
        {!isUser && message.thinking && (
          <ThinkingBlock content={message.thinking} />
        )}

        {/* Tool calls */}
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-2">
            {message.toolCalls.map(tc => (
              <ToolCallBlock key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}

        {/* Content */}
        <div
          className={cn(
            'rounded-2xl px-4 py-3',
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-card'
          )}
        >
          {isUser ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div>
              {renderMarkdown(message.content)}
              {message.isStreaming && (
                <span className="inline-block w-1.5 h-4 bg-primary ml-0.5 animate-blink" />
              )}
            </div>
          )}
        </div>

        {/* Timestamp */}
        <div className={cn('mt-1 text-[10px] text-muted-foreground', isUser ? 'text-right' : 'text-left')}>
          <FormattedTime timestamp={message.timestamp} />
        </div>
      </div>

      {isUser && (
        <div className="size-7 rounded-lg bg-secondary flex items-center justify-center shrink-0 mt-0.5">
          <User className="size-4 text-muted-foreground" />
        </div>
      )}
    </div>
  )
}

// ============================================
// Chat Area (Main Export)
// ============================================

export function ChatArea() {
  const { state, sendMessage } = useApp()
  const [inputValue, setInputValue] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const activeSession = state.sessions.find(s => s.id === state.activeSessionId)
  const messages = state.activeSessionId ? (state.messages[state.activeSessionId] || []) : []

  // Auto scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector('[data-slot="scroll-area-viewport"]')
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight
      }
    }
  }, [messages])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [inputValue])

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim()
    if (!trimmed || state.isStreaming) return
    sendMessage(trimmed)
    setInputValue('')
  }, [inputValue, state.isStreaming, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!activeSession) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="size-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Sparkles className="size-8 text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Agent Core</h2>
          <p className="text-sm text-muted-foreground">选择一个会话或创建新的会话开始对话</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-background min-w-0">
      {/* Messages */}
      <ScrollArea ref={scrollRef} className="flex-1">
        <div className="max-w-3xl mx-auto py-4">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center space-y-3">
                <div className="size-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                  <Bot className="size-6 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">发送消息开始对话</p>
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))
          )}
          {state.isStreaming && (
            <div className="flex items-center gap-2 px-4 py-2">
              <div className="flex gap-1 items-center">
                <div className="size-1.5 rounded-full bg-primary animate-streaming" style={{ animationDelay: '0s' }} />
                <div className="size-1.5 rounded-full bg-primary animate-streaming" style={{ animationDelay: '0.3s' }} />
                <div className="size-1.5 rounded-full bg-primary animate-streaming" style={{ animationDelay: '0.6s' }} />
              </div>
              <span className="text-xs text-muted-foreground">AI 正在思考...</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t border-border p-4">
        <div className="max-w-3xl mx-auto">
          <div className="relative rounded-xl border border-border bg-card focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息... (输入 / 触发命令)"
              rows={1}
              className="w-full resize-none bg-transparent px-4 pt-3 pb-10 text-sm text-foreground placeholder:text-muted-foreground outline-none min-h-[44px] max-h-[200px]"
            />
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-secondary">
                  Shift+Enter 换行
                </span>
              </div>
              <Button
                size="sm"
                className="h-7 px-3 gap-1.5"
                disabled={!inputValue.trim() || state.isStreaming}
                onClick={handleSend}
              >
                发送
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Sparkles(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" /><path d="M22 5h-4" />
    </svg>
  )
}
