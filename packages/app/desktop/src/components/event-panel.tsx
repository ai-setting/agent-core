'use client'

import { useApp } from '@/lib/store'
import type { AgentEvent, DiffLine, FileDiffHunk } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  PanelRight,
  FileEdit,
  FilePlus2,
  FileX2,
  TerminalSquare,
  Wrench,
  CheckCircle2,
  AlertTriangle,
  Info,
  ArrowLeft,
  CheckCheck,
  X,
} from 'lucide-react'
import { useState, useEffect } from 'react'

// ============================================
// Event Icon Map
// ============================================

function EventIcon({ type, className }: { type: AgentEvent['type']; className?: string }) {
  const icons: Record<AgentEvent['type'], React.ReactNode> = {
    file_edit: <FileEdit className={cn('size-3.5', className)} />,
    file_create: <FilePlus2 className={cn('size-3.5', className)} />,
    file_delete: <FileX2 className={cn('size-3.5', className)} />,
    command_exec: <TerminalSquare className={cn('size-3.5', className)} />,
    tool_start: <Wrench className={cn('size-3.5 animate-spin', className)} />,
    tool_end: <CheckCircle2 className={cn('size-3.5', className)} />,
    error: <AlertTriangle className={cn('size-3.5', className)} />,
    info: <Info className={cn('size-3.5', className)} />,
  }
  return <>{icons[type]}</>
}

function eventIconColor(type: AgentEvent['type']): string {
  switch (type) {
    case 'file_edit': return 'text-[oklch(0.75_0.15_200)]'
    case 'file_create': return 'text-success'
    case 'file_delete': return 'text-destructive'
    case 'command_exec': return 'text-warning'
    case 'tool_start': return 'text-primary'
    case 'tool_end': return 'text-success'
    case 'error': return 'text-destructive'
    case 'info': return 'text-muted-foreground'
  }
}

function eventBgColor(type: AgentEvent['type']): string {
  switch (type) {
    case 'file_edit': return 'bg-[oklch(0.75_0.15_200/0.1)]'
    case 'file_create': return 'bg-success/10'
    case 'file_delete': return 'bg-destructive/10'
    case 'command_exec': return 'bg-warning/10'
    case 'tool_start': return 'bg-primary/10'
    case 'tool_end': return 'bg-success/10'
    case 'error': return 'bg-destructive/10'
    case 'info': return 'bg-muted/50'
  }
}

// ============================================
// Formatted Time (client-only)
// ============================================

function EventTime({ timestamp }: { timestamp: string }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return <span>&nbsp;</span>
  return <>{new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</>
}

// ============================================
// Diff Viewer Component
// ============================================

function DiffViewer({ hunks }: { hunks: FileDiffHunk[] }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden bg-[oklch(0.10_0.005_260)]">
      {hunks.map((hunk, hi) => (
        <div key={hi}>
          {/* Hunk header */}
          <div className="px-3 py-1 bg-primary/5 border-b border-border text-[11px] font-mono text-primary/70">
            {'@@ -'}{hunk.oldStart},{hunk.oldLines}{' +'}{hunk.newStart},{hunk.newLines}{' @@'}
          </div>
          {/* Diff lines */}
          <div className="font-mono text-xs leading-5">
            {hunk.lines.map((line, li) => (
              <DiffLineRow key={li} line={line} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function DiffLineRow({ line }: { line: DiffLine }) {
  const bgClass = line.type === 'add'
    ? 'bg-success/8'
    : line.type === 'remove'
      ? 'bg-destructive/8'
      : ''

  const textClass = line.type === 'add'
    ? 'text-success'
    : line.type === 'remove'
      ? 'text-destructive'
      : 'text-foreground/60'

  const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '
  const oldNum = line.oldLineNumber ?? ''
  const newNum = line.newLineNumber ?? ''

  return (
    <div className={cn('flex', bgClass, 'hover:brightness-125 transition-all')}>
      <span className="w-10 shrink-0 text-right pr-1 text-muted-foreground/40 select-none border-r border-border/30 text-[10px] leading-5">
        {oldNum}
      </span>
      <span className="w-10 shrink-0 text-right pr-1 text-muted-foreground/40 select-none border-r border-border/30 text-[10px] leading-5">
        {newNum}
      </span>
      <span className={cn('w-5 shrink-0 text-center select-none font-bold', textClass)}>
        {prefix}
      </span>
      <span className={cn('flex-1 pr-3 whitespace-pre', textClass)}>
        {line.content}
      </span>
    </div>
  )
}

// ============================================
// File Content Viewer (for created files)
// ============================================

function FileContentViewer({ content, language }: { content: string; language?: string }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden bg-[oklch(0.10_0.005_260)]">
      <div className="px-3 py-1.5 bg-success/5 border-b border-border flex items-center gap-2">
        <FilePlus2 className="size-3 text-success" />
        <span className="text-[11px] font-mono text-success/70">新文件 ({language || 'text'})</span>
      </div>
      <pre className="p-3 overflow-x-auto">
        <code className="text-xs font-mono leading-relaxed text-foreground/80">
          {content.split('\n').map((line, i) => (
            <div key={i} className="flex">
              <span className="w-8 shrink-0 text-right pr-2 text-muted-foreground/30 select-none text-[10px]">{i + 1}</span>
              <span className="text-success/80">{line}</span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  )
}

// ============================================
// Command Output Viewer
// ============================================

function CommandOutputViewer({ command, output, exitCode }: { command: string; output?: string; exitCode?: number }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden bg-[oklch(0.10_0.005_260)]">
      <div className="px-3 py-1.5 bg-warning/5 border-b border-border flex items-center gap-2">
        <TerminalSquare className="size-3 text-warning" />
        <span className="text-[11px] font-mono text-warning/70 flex-1 truncate">{'$ '}{command}</span>
        {exitCode !== undefined && (
          <span className={cn(
            'text-[10px] px-1.5 py-0.5 rounded font-mono',
            exitCode === 0 ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
          )}>
            exit {exitCode}
          </span>
        )}
      </div>
      {output && (
        <pre className="p-3 overflow-x-auto">
          <code className="text-xs font-mono leading-relaxed text-foreground/70 whitespace-pre-wrap">{output}</code>
        </pre>
      )}
    </div>
  )
}

// ============================================
// Error Viewer
// ============================================

function ErrorViewer({ message, stack }: { message: string; stack?: string }) {
  return (
    <div className="rounded-lg border border-destructive/30 overflow-hidden bg-destructive/5">
      <div className="px-3 py-2 border-b border-destructive/20">
        <p className="text-sm font-medium text-destructive">{message}</p>
      </div>
      {stack && (
        <pre className="p-3 overflow-x-auto">
          <code className="text-[11px] font-mono leading-relaxed text-destructive/70 whitespace-pre-wrap">{stack}</code>
        </pre>
      )}
    </div>
  )
}

// ============================================
// Event Detail View
// ============================================

function EventDetail({ event, onBack }: { event: AgentEvent; onBack: () => void }) {
  return (
    <div className="flex flex-col h-full">
      {/* Detail Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <Button variant="ghost" size="icon" className="size-6" onClick={onBack}>
          <ArrowLeft className="size-3.5" />
        </Button>
        <div className={cn('size-6 rounded-md flex items-center justify-center', eventBgColor(event.type))}>
          <EventIcon type={event.type} className={eventIconColor(event.type)} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground truncate">{event.title}</p>
          <p className="text-[10px] text-muted-foreground truncate">{event.description}</p>
        </div>
      </div>

      {/* Detail Content */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {/* Metadata */}
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span><EventTime timestamp={event.timestamp} /></span>
            {event.filePath && (
              <span className="font-mono bg-secondary/50 px-1.5 py-0.5 rounded truncate max-w-[200px]">
                {event.filePath}
              </span>
            )}
          </div>

          {/* File edit diff */}
          {event.type === 'file_edit' && event.diff && (
            <DiffViewer hunks={event.diff} />
          )}

          {/* File create content */}
          {event.type === 'file_create' && event.fileContent && (
            <FileContentViewer content={event.fileContent} language={event.language} />
          )}

          {/* File delete */}
          {event.type === 'file_delete' && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
              <FileX2 className="size-8 text-destructive/50 mx-auto mb-2" />
              <p className="text-sm text-destructive/80">文件已删除</p>
              <p className="text-xs text-muted-foreground mt-1 font-mono">{event.filePath}</p>
            </div>
          )}

          {/* Command execution */}
          {event.type === 'command_exec' && event.command && (
            <CommandOutputViewer command={event.command} output={event.output} exitCode={event.exitCode} />
          )}

          {/* Error */}
          {event.type === 'error' && event.errorMessage && (
            <ErrorViewer message={event.errorMessage} stack={event.errorStack} />
          )}

          {/* Info / tool_start / tool_end */}
          {(event.type === 'info' || event.type === 'tool_start' || event.type === 'tool_end') && (
            <div className="rounded-lg border border-border bg-secondary/20 p-4 text-center">
              <div className={cn('size-8 rounded-full flex items-center justify-center mx-auto mb-2', eventBgColor(event.type))}>
                <EventIcon type={event.type} className={cn('size-4', eventIconColor(event.type))} />
              </div>
              <p className="text-sm text-foreground/80">{event.description}</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ============================================
// Event List Item
// ============================================

function EventListItem({ event, onSelect }: { event: AgentEvent; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full text-left px-3 py-2.5 flex items-start gap-2.5 hover:bg-secondary/50 transition-colors border-b border-border/30',
        !event.read && 'bg-primary/[0.03]'
      )}
    >
      {/* Icon */}
      <div className={cn('size-7 rounded-md flex items-center justify-center shrink-0 mt-0.5', eventBgColor(event.type))}>
        <EventIcon type={event.type} className={eventIconColor(event.type)} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={cn('text-xs font-medium truncate', event.read ? 'text-foreground/70' : 'text-foreground')}>
            {event.title}
          </span>
          {!event.read && (
            <span className="size-1.5 rounded-full bg-primary shrink-0" />
          )}
        </div>
        <p className="text-[11px] text-muted-foreground truncate mt-0.5 font-mono">
          {event.description}
        </p>
        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
          <EventTime timestamp={event.timestamp} />
        </p>
      </div>
    </button>
  )
}

// ============================================
// Collapsed Toggle Button
// ============================================

export function EventPanelToggle() {
  const { state, dispatch } = useApp()
  const unreadCount = state.events.filter(e => !e.read).length

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 relative"
          onClick={() => dispatch({ type: 'TOGGLE_EVENT_PANEL' })}
        >
          <PanelRight className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 size-4 rounded-full bg-destructive text-destructive-foreground text-[9px] flex items-center justify-center font-medium">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>事件面板 {unreadCount > 0 && `(${unreadCount} 条未读)`}</TooltipContent>
    </Tooltip>
  )
}

// ============================================
// Main Event Panel
// ============================================

export function EventPanel() {
  const { state, dispatch } = useApp()
  const unreadCount = state.events.filter(e => !e.read).length

  const selectedEvent = state.selectedEventId
    ? state.events.find(e => e.id === state.selectedEventId)
    : null

  if (!state.eventPanelOpen) return null

  return (
    <div className="w-[340px] shrink-0 border-l border-border bg-background flex flex-col h-full">
      {selectedEvent ? (
        <EventDetail
          event={selectedEvent}
          onBack={() => dispatch({ type: 'SELECT_EVENT', payload: null })}
        />
      ) : (
        <>
          {/* Panel Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-foreground">事件</h3>
              {unreadCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                  {unreadCount} 条未读
                </span>
              )}
            </div>
            <div className="flex items-center gap-0.5">
              {unreadCount > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-foreground"
                      onClick={() => dispatch({ type: 'MARK_ALL_EVENTS_READ' })}
                    >
                      <CheckCheck className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>全部标记已读</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    onClick={() => dispatch({ type: 'SET_EVENT_PANEL', payload: false })}
                  >
                    <X className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>关闭面板</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Event List */}
          <ScrollArea className="flex-1">
            {state.events.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <div className="text-center space-y-2">
                  <div className="size-10 rounded-xl bg-secondary/50 flex items-center justify-center mx-auto">
                    <Info className="size-5 text-muted-foreground/50" />
                  </div>
                  <p className="text-xs text-muted-foreground">暂无事件</p>
                </div>
              </div>
            ) : (
              state.events.map((evt) => (
                <EventListItem
                  key={evt.id}
                  event={evt}
                  onSelect={() => dispatch({ type: 'SELECT_EVENT', payload: evt.id })}
                />
              ))
            )}
          </ScrollArea>
        </>
      )}
    </div>
  )
}
