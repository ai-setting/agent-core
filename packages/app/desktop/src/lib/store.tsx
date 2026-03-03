'use client'

import { createContext, useContext, useReducer, useCallback, type ReactNode } from 'react'
import type { Session, Message, Model, Provider, AgentEvent } from '@/lib/types'

// ============================================
// Mock Data
// ============================================

const MOCK_PROVIDERS: Provider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', providerId: 'openai', providerName: 'OpenAI', isFavorite: true },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', providerId: 'openai', providerName: 'OpenAI' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', providerId: 'anthropic', providerName: 'Anthropic', isFavorite: true },
      { id: 'claude-3-haiku', name: 'Claude 3 Haiku', providerId: 'anthropic', providerName: 'Anthropic' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', providerId: 'deepseek', providerName: 'DeepSeek' },
      { id: 'deepseek-coder', name: 'DeepSeek Coder', providerId: 'deepseek', providerName: 'DeepSeek', isFavorite: true },
    ],
  },
]

const MOCK_SESSIONS: Session[] = [
  {
    id: '1',
    title: 'React 项目架构讨论',
    createdAt: '2026-03-02T10:00:00Z',
    updatedAt: '2026-03-02T10:30:00Z',
    modelId: 'claude-3-5-sonnet',
    messageCount: 12,
  },
  {
    id: '2',
    title: '数据库查询优化方案',
    createdAt: '2026-03-01T15:00:00Z',
    updatedAt: '2026-03-01T16:00:00Z',
    modelId: 'gpt-4o',
    messageCount: 8,
  },
]

const MOCK_EVENTS: AgentEvent[] = [
  {
    id: '1',
    type: 'file_edit',
    title: '修改文件',
    description: 'src/components/Header.tsx',
    timestamp: '2026-03-02T10:25:00Z',
    read: false,
    filePath: 'src/components/Header.tsx',
    diff: [
      {
        oldStart: 1,
        oldLines: 5,
        newStart: 1,
        newLines: 7,
        lines: [
          { type: 'context', content: 'interface HeaderProps {' },
          { type: 'context', content: '  title: string' },
          { type: 'add', content: '  subtitle?: string', newLineNumber: 3 },
          { type: 'add', content: '  onLogout?: () => void', newLineNumber: 4 },
          { type: 'context', content: '}' },
          { type: 'add', content: '', newLineNumber: 6 },
          { type: 'add', content: 'export function Header({ title, subtitle, onLogout }: HeaderProps) {', newLineNumber: 7 },
        ],
      },
    ],
    language: 'typescript',
  },
  {
    id: '2',
    type: 'command_exec',
    title: '执行命令',
    description: 'npm run build',
    timestamp: '2026-03-02T10:20:00Z',
    read: false,
    command: 'npm run build',
    output: '> build\n> tsc\n> next build\n✓ 325 modules compiled.',
    exitCode: 0,
  },
  {
    id: '3',
    type: 'file_create',
    title: '创建文件',
    description: 'src/utils/logger.ts',
    timestamp: '2026-03-02T10:15:00Z',
    read: true,
    filePath: 'src/utils/logger.ts',
    fileContent: `export function createLogger(name: string) {
  return {
    debug: (msg: string) => console.debug(\`[\${name}] \${msg}\`),
    info: (msg: string) => console.info(\`[\${name}] \${msg}\`),
    warn: (msg: string) => console.warn(\`[\${name}] \${msg}\`),
    error: (msg: string) => console.error(\`[\${name}] \${msg}\`),
  }
}`,
    language: 'typescript',
  },
  {
    id: '4',
    type: 'tool_start',
    title: '工具调用',
    description: '读取文件 src/app/page.tsx',
    timestamp: '2026-03-02T10:10:00Z',
    read: true,
  },
  {
    id: '5',
    type: 'error',
    title: '错误',
    description: 'npm install 失败',
    timestamp: '2026-03-02T10:05:00Z',
    read: true,
    errorMessage: 'ERR_MODULE_NOT_FOUND',
    errorStack: 'Cannot find module @some/package',
  },
]

// ============================================
// State & Actions
// ============================================

interface AppState {
  sessions: Session[]
  activeSessionId: string | null
  messages: Record<string, Message[]>
  providers: Provider[]
  selectedModelId: string
  sidebarOpen: boolean
  settingsOpen: boolean
  commandPaletteOpen: boolean
  modelSelectorOpen: boolean
  isStreaming: boolean
  events: AgentEvent[]
  eventPanelOpen: boolean
  selectedEventId: string | null
  serverConnected: boolean
  serverUrl: string
}

type AppAction =
  | { type: 'SET_ACTIVE_SESSION'; payload: string }
  | { type: 'CREATE_SESSION' }
  | { type: 'DELETE_SESSION'; payload: string }
  | { type: 'ADD_MESSAGE'; payload: { sessionId: string; message: Message } }
  | { type: 'UPDATE_MESSAGE'; payload: { sessionId: string; messageId: string; content: string } }
  | { type: 'SET_MODEL'; payload: string }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SIDEBAR'; payload: boolean }
  | { type: 'SET_SETTINGS_OPEN'; payload: boolean }
  | { type: 'SET_COMMAND_PALETTE_OPEN'; payload: boolean }
  | { type: 'SET_MODEL_SELECTOR_OPEN'; payload: boolean }
  | { type: 'SET_STREAMING'; payload: boolean }
  | { type: 'FINISH_STREAM'; payload: { sessionId: string; messageId: string } }
  | { type: 'TOGGLE_FAVORITE'; payload: string }
  | { type: 'TOGGLE_EVENT_PANEL' }
  | { type: 'SET_EVENT_PANEL'; payload: boolean }
  | { type: 'SELECT_EVENT'; payload: string | null }
  | { type: 'MARK_EVENT_READ'; payload: string }
  | { type: 'MARK_ALL_EVENTS_READ' }
  | { type: 'ADD_EVENT'; payload: AgentEvent }
  | { type: 'SET_SERVER_CONNECTED'; payload: boolean }
  | { type: 'SET_SERVER_URL'; payload: string }

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_ACTIVE_SESSION':
      return { ...state, activeSessionId: action.payload }
    case 'CREATE_SESSION': {
      const newSession: Session = {
        id: Date.now().toString(),
        title: '新会话',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        modelId: state.selectedModelId,
        messageCount: 0,
      }
      return {
        ...state,
        sessions: [newSession, ...state.sessions],
        activeSessionId: newSession.id,
        messages: { ...state.messages, [newSession.id]: [] },
      }
    }
    case 'DELETE_SESSION': {
      const filtered = state.sessions.filter(s => s.id !== action.payload)
      const newMessages = { ...state.messages }
      delete newMessages[action.payload]
      return {
        ...state,
        sessions: filtered,
        activeSessionId: state.activeSessionId === action.payload
          ? (filtered[0]?.id || null)
          : state.activeSessionId,
        messages: newMessages,
      }
    }
    case 'ADD_MESSAGE': {
      const existing = state.messages[action.payload.sessionId] || []
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.payload.sessionId]: [...existing, action.payload.message],
        },
        sessions: state.sessions.map(s =>
          s.id === action.payload.sessionId
            ? { ...s, messageCount: s.messageCount + 1, updatedAt: new Date().toISOString() }
            : s
        ),
      }
    }
    case 'UPDATE_MESSAGE': {
      const msgs = state.messages[action.payload.sessionId] || []
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.payload.sessionId]: msgs.map(m =>
            m.id === action.payload.messageId
              ? { ...m, content: m.content + action.payload.content }
              : m
          ),
        },
      }
    }
    case 'FINISH_STREAM': {
      const streamMsgs = state.messages[action.payload.sessionId] || []
      return {
        ...state,
        isStreaming: false,
        messages: {
          ...state.messages,
          [action.payload.sessionId]: streamMsgs.map(m =>
            m.id === action.payload.messageId
              ? { ...m, isStreaming: false }
              : m
          ),
        },
      }
    }
    case 'SET_MODEL':
      return { ...state, selectedModelId: action.payload }
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarOpen: !state.sidebarOpen }
    case 'SET_SIDEBAR':
      return { ...state, sidebarOpen: action.payload }
    case 'SET_SETTINGS_OPEN':
      return { ...state, settingsOpen: action.payload }
    case 'SET_COMMAND_PALETTE_OPEN':
      return { ...state, commandPaletteOpen: action.payload }
    case 'SET_MODEL_SELECTOR_OPEN':
      return { ...state, modelSelectorOpen: action.payload }
    case 'SET_STREAMING':
      return { ...state, isStreaming: action.payload }
    case 'TOGGLE_FAVORITE': {
      return {
        ...state,
        providers: state.providers.map(p => ({
          ...p,
          models: p.models.map(m =>
            m.id === action.payload ? { ...m, isFavorite: !m.isFavorite } : m
          ),
        })),
      }
    }
    case 'TOGGLE_EVENT_PANEL':
      return { ...state, eventPanelOpen: !state.eventPanelOpen }
    case 'SET_EVENT_PANEL':
      return { ...state, eventPanelOpen: action.payload }
    case 'SELECT_EVENT':
      return {
        ...state,
        selectedEventId: action.payload,
        events: action.payload
          ? state.events.map(e => e.id === action.payload ? { ...e, read: true } : e)
          : state.events,
      }
    case 'MARK_EVENT_READ':
      return {
        ...state,
        events: state.events.map(e => e.id === action.payload ? { ...e, read: true } : e),
      }
    case 'MARK_ALL_EVENTS_READ':
      return {
        ...state,
        events: state.events.map(e => ({ ...e, read: true })),
      }
    case 'ADD_EVENT':
      return {
        ...state,
        events: [action.payload, ...state.events],
      }
    case 'SET_SERVER_CONNECTED':
      return { ...state, serverConnected: action.payload }
    case 'SET_SERVER_URL':
      return { ...state, serverUrl: action.payload }
    default:
      return state
  }
}

const initialState: AppState = {
  sessions: MOCK_SESSIONS,
  activeSessionId: '1',
  messages: {},
  providers: MOCK_PROVIDERS,
  selectedModelId: 'claude-3-5-sonnet',
  sidebarOpen: true,
  settingsOpen: false,
  commandPaletteOpen: false,
  modelSelectorOpen: false,
  isStreaming: false,
  events: MOCK_EVENTS,
  eventPanelOpen: false,
  selectedEventId: null,
  serverConnected: false,
  serverUrl: 'http://localhost:3000',
}

// ============================================
// Context
// ============================================

interface AppContextType {
  state: AppState
  dispatch: React.Dispatch<AppAction>
  sendMessage: (content: string) => void
  allModels: Model[]
  currentModel: Model | undefined
}

const AppContext = createContext<AppContextType | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState)

  const allModels = state.providers.flatMap(p => p.models)
  const currentModel = allModels.find(m => m.id === state.selectedModelId)

  const sendMessage = useCallback((content: string) => {
    if (!state.activeSessionId || state.isStreaming) return

    const sessionId = state.activeSessionId

    // Add user message
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    }
    dispatch({ type: 'ADD_MESSAGE', payload: { sessionId, message: userMsg } })

    // Simulate AI response with streaming
    const aiMsgId = `ai-${Date.now()}`
    const aiMsg: Message = {
      id: aiMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
      thinking: '正在分析你的问题，让我思考一下最佳的回答方式...',
    }
    dispatch({ type: 'ADD_MESSAGE', payload: { sessionId, message: aiMsg } })
    dispatch({ type: 'SET_STREAMING', payload: true })

    // Simulate streaming response
    const responseText = `收到你的消息："${content}"

这是一个模拟的流式响应。在实际应用中，这里会通过 SSE (Server-Sent Events) 连接到 agent-core Server，实时接收 AI 的回复。

\`\`\`typescript
// 连接示例
const eventSource = new EventSource(
  \`/events?session=\${sessionId}\`
);

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // 处理流式数据
};
\`\`\`

当前使用的模型是 **${currentModel?.name || state.selectedModelId}**。`

    let i = 0
    const interval = setInterval(() => {
      if (i < responseText.length) {
        const chunkSize = Math.floor(Math.random() * 4) + 1
        const chunk = responseText.slice(i, i + chunkSize)
        dispatch({
          type: 'UPDATE_MESSAGE',
          payload: { sessionId, messageId: aiMsgId, content: chunk },
        })
        i += chunkSize
      } else {
        clearInterval(interval)
        dispatch({ type: 'FINISH_STREAM', payload: { sessionId, messageId: aiMsgId } })
      }
    }, 30)
  }, [state.activeSessionId, state.isStreaming, currentModel])

  return (
    <AppContext.Provider value={{ state, dispatch, sendMessage, allModels, currentModel }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used within AppProvider')
  return context
}
