'use client'

import { useApp } from '@/lib/store'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/components/ui/command'
import {
  MessageSquare,
  Settings,
  Cpu,
  Link,
  Plus,
} from 'lucide-react'
import { useEffect } from 'react'

export function CommandPalette() {
  const { state, dispatch } = useApp()

  // Ctrl+P to open
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault()
        dispatch({ type: 'SET_COMMAND_PALETTE_OPEN', payload: !state.commandPaletteOpen })
      }
      // Ctrl+N for new session
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault()
        dispatch({ type: 'CREATE_SESSION' })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state.commandPaletteOpen, dispatch])

  return (
    <CommandDialog
      open={state.commandPaletteOpen}
      onOpenChange={(open) => dispatch({ type: 'SET_COMMAND_PALETTE_OPEN', payload: open })}
      title="命令面板"
      description="搜索命令..."
    >
      <CommandInput placeholder="输入命令..." />
      <CommandList>
        <CommandEmpty>未找到匹配的命令</CommandEmpty>

        <CommandGroup heading="会话">
          <CommandItem
            onSelect={() => {
              dispatch({ type: 'CREATE_SESSION' })
              dispatch({ type: 'SET_COMMAND_PALETTE_OPEN', payload: false })
            }}
          >
            <Plus className="size-4" />
            <span>新建会话</span>
            <CommandShortcut>Ctrl+N</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              dispatch({ type: 'TOGGLE_SIDEBAR' })
              dispatch({ type: 'SET_COMMAND_PALETTE_OPEN', payload: false })
            }}
          >
            <MessageSquare className="size-4" />
            <span>切换会话列表</span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="模型">
          <CommandItem
            onSelect={() => {
              dispatch({ type: 'SET_MODEL_SELECTOR_OPEN', payload: true })
              dispatch({ type: 'SET_COMMAND_PALETTE_OPEN', payload: false })
            }}
          >
            <Cpu className="size-4" />
            <span>选择模型</span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="设置">
          <CommandItem
            onSelect={() => {
              dispatch({ type: 'SET_SETTINGS_OPEN', payload: true })
              dispatch({ type: 'SET_COMMAND_PALETTE_OPEN', payload: false })
            }}
          >
            <Settings className="size-4" />
            <span>打开设置</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              dispatch({ type: 'SET_COMMAND_PALETTE_OPEN', payload: false })
            }}
          >
            <Link className="size-4" />
            <span>连接配置</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
