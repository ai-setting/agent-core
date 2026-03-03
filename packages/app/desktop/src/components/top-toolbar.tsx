'use client'

import { useApp } from '@/lib/store'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  PanelLeft,
  Cpu,
  ChevronDown,
  Command,
  Settings,
  Circle,
  PanelRight,
} from 'lucide-react'

export function TopToolbar() {
  const { state, dispatch, currentModel } = useApp()

  return (
    <header className="flex items-center justify-between h-12 px-3 border-b border-border bg-card/50 shrink-0">
      {/* Left section */}
      <div className="flex items-center gap-1">
        {/* Toggle sidebar */}
        {!state.sidebarOpen && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground"
                onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
              >
                <PanelLeft className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>展开侧边栏</TooltipContent>
          </Tooltip>
        )}

        {/* Session title */}
        <div className="flex items-center gap-2 ml-1">
          {state.activeSessionId && (
            <h1 className="text-sm font-medium text-foreground truncate max-w-[300px]">
              {state.sessions.find(s => s.id === state.activeSessionId)?.title || '新会话'}
            </h1>
          )}
        </div>
      </div>

      {/* Center - Model Selector */}
      <button
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs hover:bg-secondary/50 transition-colors"
        onClick={() => dispatch({ type: 'SET_MODEL_SELECTOR_OPEN', payload: true })}
      >
        <Cpu className="size-3.5 text-primary" />
        <span className="text-foreground/80 font-medium">{currentModel?.name || '选择模型'}</span>
        <ChevronDown className="size-3 text-muted-foreground" />
      </button>

      {/* Right section */}
      <div className="flex items-center gap-1">
        {/* Connection Status */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs">
              <Circle className="size-2 fill-success text-success" />
              <span className="text-muted-foreground">已连接</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>Server 连接状态: 正常</TooltipContent>
        </Tooltip>

        {/* Command Palette */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              onClick={() => dispatch({ type: 'SET_COMMAND_PALETTE_OPEN', payload: true })}
            >
              <Command className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>命令面板 (Ctrl+P)</TooltipContent>
        </Tooltip>

        {/* Event Panel */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              onClick={() => dispatch({ type: 'TOGGLE_EVENT_PANEL' })}
            >
              <PanelRight className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>事件面板</TooltipContent>
        </Tooltip>

        {/* Settings */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              onClick={() => dispatch({ type: 'SET_SETTINGS_OPEN', payload: true })}
            >
              <Settings className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>设置</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
