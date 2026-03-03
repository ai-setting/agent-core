// ============================================
// Agent Core Desktop - Type Definitions
// ============================================

export interface Session {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  modelId: string
  messageCount: number
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  thinking?: string
  toolCalls?: ToolCall[]
  isStreaming?: boolean
}

export interface ToolCall {
  id: string
  name: string
  arguments: string
  result?: string
  status: 'pending' | 'running' | 'completed' | 'error'
}

export interface Provider {
  id: string
  name: string
  models: Model[]
}

export interface Model {
  id: string
  name: string
  providerId: string
  providerName: string
  isFavorite?: boolean
  lastUsed?: string
}

export interface CommandItem {
  id: string
  name: string
  description: string
  icon: string
  shortcut?: string
  action: () => void
}

export interface AppSettings {
  theme: 'dark' | 'light'
  fontSize: number
  apiKeys: Record<string, string>
  providers: Provider[]
  defaultModel: string
}

// ============================================
// Agent Events
// ============================================

export type AgentEventType =
  | 'file_edit'
  | 'file_create'
  | 'file_delete'
  | 'command_exec'
  | 'tool_start'
  | 'tool_end'
  | 'error'
  | 'info'

export interface FileDiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

export interface AgentEvent {
  id: string
  type: AgentEventType
  title: string
  description: string
  timestamp: string
  read: boolean
  filePath?: string
  diff?: FileDiffHunk[]
  fileContent?: string
  language?: string
  command?: string
  output?: string
  exitCode?: number
  errorMessage?: string
  errorStack?: string
}

// ============================================
// Stream Events (from Server SSE)
// ============================================

export type StreamEventType =
  | 'stream.start'
  | 'stream.text'
  | 'stream.reasoning'
  | 'stream.tool.call'
  | 'stream.tool.result'
  | 'stream.completed'
  | 'stream.error'
  | 'server.connected'
  | 'server.heartbeat'

export interface StreamEvent {
  type: StreamEventType
  sessionId?: string
  messageId?: string
  content?: string
  delta?: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolCallId?: string
  result?: unknown
  success?: boolean
  error?: string
  code?: string
  model?: string
}
