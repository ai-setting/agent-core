'use client'

import { useApp } from '@/lib/store'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Star, Search, Clock, Cpu, Check } from 'lucide-react'
import { useState, useMemo } from 'react'

export function ModelSelector() {
  const { state, dispatch, allModels, currentModel } = useApp()
  const [searchTerm, setSearchTerm] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'favorites' | 'recent'>('all')

  const filteredModels = useMemo(() => {
    let models = allModels

    if (activeTab === 'favorites') {
      models = models.filter(m => m.isFavorite)
    }

    if (searchTerm) {
      models = models.filter(m =>
        m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.providerName.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    return models
  }, [allModels, activeTab, searchTerm])

  // Group by provider
  const grouped = useMemo(() => {
    const groups: Record<string, typeof filteredModels> = {}
    for (const model of filteredModels) {
      if (!groups[model.providerName]) groups[model.providerName] = []
      groups[model.providerName].push(model)
    }
    return groups
  }, [filteredModels])

  return (
    <Dialog
      open={state.modelSelectorOpen}
      onOpenChange={(open) => dispatch({ type: 'SET_MODEL_SELECTOR_OPEN', payload: open })}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="text-base">选择模型</DialogTitle>
          <DialogDescription className="text-xs">
            当前: {currentModel?.name || state.selectedModelId}
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 rounded-md bg-secondary/50 px-3 py-2">
            <Search className="size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索模型..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 pb-2">
          <TabButton
            active={activeTab === 'all'}
            onClick={() => setActiveTab('all')}
            icon={<Cpu className="size-3" />}
            label="全部"
          />
          <TabButton
            active={activeTab === 'favorites'}
            onClick={() => setActiveTab('favorites')}
            icon={<Star className="size-3" />}
            label="收藏"
          />
          <TabButton
            active={activeTab === 'recent'}
            onClick={() => setActiveTab('recent')}
            icon={<Clock className="size-3" />}
            label="最近使用"
          />
        </div>

        {/* Model List */}
        <ScrollArea className="max-h-[400px]">
          <div className="px-2 pb-3">
            {Object.entries(grouped).map(([provider, models]) => (
              <div key={provider} className="mb-2">
                <p className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  {provider}
                </p>
                {models.map((model) => (
                  <div
                    key={model.id}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors',
                      state.selectedModelId === model.id
                        ? 'bg-primary/10 text-foreground'
                        : 'text-foreground/80 hover:bg-secondary/50'
                    )}
                    onClick={() => {
                      dispatch({ type: 'SET_MODEL', payload: model.id })
                      dispatch({ type: 'SET_MODEL_SELECTOR_OPEN', payload: false })
                    }}
                  >
                    <div className="size-8 rounded-lg bg-secondary flex items-center justify-center">
                      <Cpu className="size-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{model.name}</p>
                      <p className="text-[11px] text-muted-foreground">{model.providerName}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {state.selectedModelId === model.id && (
                        <Check className="size-4 text-primary" />
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={(e) => {
                              e.stopPropagation()
                              dispatch({ type: 'TOGGLE_FAVORITE', payload: model.id })
                            }}
                          >
                            <Star
                              className={cn(
                                'size-3.5',
                                model.isFavorite ? 'fill-warning text-warning' : 'text-muted-foreground'
                              )}
                            />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{model.isFavorite ? '取消收藏' : '收藏'}</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                ))}
              </div>
            ))}

            {filteredModels.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">暂无匹配的模型</p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}
