'use client'

import { AppProvider } from '@/lib/store'
import { SessionSidebar } from '@/components/session-sidebar'
import { ChatArea } from '@/components/chat-area'
import { TopToolbar } from '@/components/top-toolbar'
import { CommandPalette } from '@/components/command-palette'
import { ModelSelector } from '@/components/model-selector'
import { SettingsPanel } from '@/components/settings-panel'
import { EventPanel } from '@/components/event-panel'
import { TooltipProvider } from '@/components/ui/tooltip'

export default function DeskApp() {
  return (
    <AppProvider>
      <TooltipProvider delayDuration={200}>
        <div className="flex h-screen w-screen overflow-hidden bg-background">
          {/* Sidebar */}
          <SessionSidebar />

          {/* Main Area */}
          <div className="flex-1 flex flex-col min-w-0">
            <TopToolbar />
            <ChatArea />
          </div>

          {/* Event Panel (Right Side) */}
          <EventPanel />

          {/* Overlays */}
          <CommandPalette />
          <ModelSelector />
          <SettingsPanel />
        </div>
      </TooltipProvider>
    </AppProvider>
  )
}
