'use client'

import { useApp } from '@/lib/store'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Plus,
  MessageSquare,
  MoreHorizontal,
  Trash2,
  PanelLeftClose,
  Search,
  Settings,
  Sparkles,
} from 'lucide-react'
import { useState, useEffect } from 'react'

function formatRelativeTime(dateStr: string) {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffHours < 1) return '刚刚'
  if (diffHours < 24) return `${diffHours} 小时前`
  if (diffDays < 7) return `${diffDays} 天前`
  return date.toLocaleDateString('zh-CN')
}

function RelativeTime({ dateStr }: { dateStr: string }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return <span className="text-[11px] text-muted-foreground">&nbsp;</span>
  return <span>{formatRelativeTime(dateStr)}</span>
}

export function SessionSidebar() {
  const { state, dispatch } = useApp()
  const [searchTerm, setSearchTerm] = useState('')
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const filteredSessions = state.sessions.filter(s =>
    s.title.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Group sessions by date (only compute on client)
  const { todaySessions, yesterdaySessions, olderSessions } = (() => {
    if (!mounted) return { todaySessions: [], yesterdaySessions: [], olderSessions: filteredSessions }
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    return {
      todaySessions: filteredSessions.filter(s => new Date(s.updatedAt) >= today),
      yesterdaySessions: filteredSessions.filter(s => {
        const d = new Date(s.updatedAt)
        return d >= yesterday && d < today
      }),
      olderSessions: filteredSessions.filter(s => new Date(s.updatedAt) < yesterday),
    }
  })()

  return (
    <aside
      className={cn(
        'flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-in-out',
        state.sidebarOpen ? 'w-72' : 'w-0 overflow-hidden border-0'
      )}
    >
      {/* Sidebar Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <span className="text-sm font-semibold text-sidebar-foreground">Agent Core</span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-sidebar-foreground"
              onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
            >
              <PanelLeftClose className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">收起侧边栏</TooltipContent>
        </Tooltip>
      </div>

      {/* New Session Button */}
      <div className="p-3">
        <Button
          className="w-full justify-start gap-2 bg-primary/10 text-primary hover:bg-primary/20 border-0"
          variant="outline"
          onClick={() => dispatch({ type: 'CREATE_SESSION' })}
        >
          <Plus className="size-4" />
          新建会话
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-md bg-sidebar-accent/50 px-2.5 py-1.5">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索会话..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 bg-transparent text-xs text-sidebar-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
      </div>

      {/* Session List */}
      <ScrollArea className="flex-1">
        <div className="px-2 pb-2">
          {todaySessions.length > 0 && (
            <SessionGroup label="今天" sessions={todaySessions} />
          )}
          {yesterdaySessions.length > 0 && (
            <SessionGroup label="昨天" sessions={yesterdaySessions} />
          )}
          {olderSessions.length > 0 && (
            <SessionGroup label="更早" sessions={olderSessions} />
          )}
          {filteredSessions.length === 0 && (
            <p className="px-3 py-6 text-xs text-muted-foreground text-center">暂无会话</p>
          )}
        </div>
      </ScrollArea>

      {/* Sidebar Footer */}
      <div className="border-t border-sidebar-border p-2">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-sidebar-foreground"
          onClick={() => dispatch({ type: 'SET_SETTINGS_OPEN', payload: true })}
        >
          <Settings className="size-3.5" />
          设置
        </Button>
      </div>
    </aside>
  )
}

function SessionGroup({ label, sessions }: { label: string; sessions: typeof MOCK_SESSIONS_TYPE }) {
  const { state, dispatch } = useApp()

  return (
    <div className="mb-1">
      <p className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </p>
      {sessions.map((session) => (
        <div
          key={session.id}
          className={cn(
            'group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-colors',
            state.activeSessionId === session.id
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
          )}
          onClick={() => dispatch({ type: 'SET_ACTIVE_SESSION', payload: session.id })}
        >
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">{session.title}</p>
            <p className="text-[11px] text-muted-foreground"><RelativeTime dateStr={session.updatedAt} /></p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-sidebar-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={(e) => {
                  e.stopPropagation()
                  dispatch({ type: 'DELETE_SESSION', payload: session.id })
                }}
              >
                <Trash2 className="size-4" />
                删除会话
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
    </div>
  )
}

// Type helper
type MOCK_SESSIONS_TYPE = { id: string; title: string; createdAt: string; updatedAt: string; modelId: string; messageCount: number }[]
