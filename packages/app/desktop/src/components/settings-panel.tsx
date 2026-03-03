'use client'

import { useApp } from '@/lib/store'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Key,
  Server,
  Palette,
  Type,
  Shield,
  Plus,
  Trash2,
  Eye,
  EyeOff,
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

type SettingsTab = 'providers' | 'appearance' | 'about'

export function SettingsPanel() {
  const { state, dispatch } = useApp()
  const [activeTab, setActiveTab] = useState<SettingsTab>('providers')

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'providers', label: 'Provider 配置', icon: <Server className="size-4" /> },
    { id: 'appearance', label: '外观', icon: <Palette className="size-4" /> },
    { id: 'about', label: '关于', icon: <Shield className="size-4" /> },
  ]

  return (
    <Dialog
      open={state.settingsOpen}
      onOpenChange={(open) => dispatch({ type: 'SET_SETTINGS_OPEN', payload: open })}
    >
      <DialogContent className="sm:max-w-2xl p-0 gap-0 h-[520px]">
        <div className="flex h-full">
          {/* Sidebar */}
          <div className="w-48 border-r border-border p-3 space-y-1">
            <DialogHeader className="mb-4 px-2">
              <DialogTitle className="text-sm">设置</DialogTitle>
              <DialogDescription className="text-xs">管理应用配置</DialogDescription>
            </DialogHeader>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                  activeTab === tab.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                )}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <ScrollArea className="flex-1">
            <div className="p-6">
              {activeTab === 'providers' && <ProvidersSettings />}
              {activeTab === 'appearance' && <AppearanceSettings />}
              {activeTab === 'about' && <AboutSettings />}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ProvidersSettings() {
  const { state } = useApp()
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({})

  const toggleKeyVisibility = (providerId: string) => {
    setVisibleKeys(prev => ({ ...prev, [providerId]: !prev[providerId] }))
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">API Provider</h3>
        <p className="text-xs text-muted-foreground">配置 AI 模型的 Provider 和 API Key</p>
      </div>

      <div className="space-y-4">
        {state.providers.map((provider) => (
          <div key={provider.id} className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-secondary flex items-center justify-center">
                  <Server className="size-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{provider.name}</p>
                  <p className="text-[11px] text-muted-foreground">{provider.models.length} 个模型</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <div className="size-2 rounded-full bg-success" />
                <span className="text-[11px] text-muted-foreground">已连接</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`key-${provider.id}`} className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Key className="size-3" />
                API Key
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`key-${provider.id}`}
                  type={visibleKeys[provider.id] ? 'text' : 'password'}
                  placeholder="sk-..."
                  defaultValue="sk-••••••••••••••••••••"
                  className="flex-1 text-xs font-mono bg-secondary/30"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => toggleKeyVisibility(provider.id)}
                >
                  {visibleKeys[provider.id] ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Button variant="outline" className="w-full gap-2 border-dashed">
        <Plus className="size-4" />
        添加 Provider
      </Button>
    </div>
  )
}

function AppearanceSettings() {
  const [fontSize, setFontSize] = useState(14)
  const [isDark, setIsDark] = useState(true)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">外观</h3>
        <p className="text-xs text-muted-foreground">自定义应用的外观和显示设置</p>
      </div>

      {/* Theme */}
      <div className="space-y-3">
        <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Palette className="size-3" />
          主题
        </Label>
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium text-foreground">{isDark ? '深色主题' : '浅色主题'}</p>
            <p className="text-xs text-muted-foreground">切换应用显示主题</p>
          </div>
          <Switch checked={isDark} onCheckedChange={setIsDark} />
        </div>
      </div>

      <Separator />

      {/* Font Size */}
      <div className="space-y-3">
        <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Type className="size-3" />
          字体大小
        </Label>
        <div className="flex items-center gap-4">
          <span className="text-xs text-muted-foreground">A</span>
          <input
            type="range"
            min={12}
            max={20}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="flex-1 accent-primary"
          />
          <span className="text-base text-muted-foreground">A</span>
          <span className="text-xs text-muted-foreground min-w-[30px]">{fontSize}px</span>
        </div>
      </div>
    </div>
  )
}

function AboutSettings() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">关于</h3>
        <p className="text-xs text-muted-foreground">应用信息和版本</p>
      </div>

      <div className="rounded-lg border border-border p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="size-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-6 text-primary">
              <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
            </svg>
          </div>
          <div>
            <h4 className="text-base font-semibold text-foreground">Agent Core Desktop</h4>
            <p className="text-xs text-muted-foreground">AI Agent 桌面客户端</p>
          </div>
        </div>

        <Separator />

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">版本</span>
            <span className="text-foreground font-mono text-xs">1.0.0-beta</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">运行时</span>
            <span className="text-foreground font-mono text-xs">Tauri 2.x</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">UI 框架</span>
            <span className="text-foreground font-mono text-xs">React + Tailwind CSS</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Server 状态</span>
            <div className="flex items-center gap-1.5">
              <div className="size-2 rounded-full bg-success" />
              <span className="text-foreground text-xs">已连接</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
