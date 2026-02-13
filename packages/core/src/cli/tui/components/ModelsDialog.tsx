/**
 * @fileoverview ModelsDialog Component - Model selection dialog
 */

import { createSignal, createMemo, For, Show, onMount } from "solid-js";
import { useCommand, useDialog, useTheme } from "../contexts/index.js";
import { tuiLogger } from "../logger.js";

interface ModelInfo {
  providerID: string;
  providerName: string;
  modelID: string;
  modelName: string;
  isFavorite: boolean;
}

interface ProviderModels {
  providerID: string;
  providerName: string;
  models: ModelInfo[];
}

interface ModelsDialogData {
  recent: Array<{ providerID: string; modelID: string }>;
  favorites: Array<{ providerID: string; modelID: string }>;
  providers: ProviderModels[];
}

interface ModelsDialogProps {
  data: ModelsDialogData;
}

export function ModelsDialog(props: ModelsDialogProps) {
  const command = useCommand();
  const dialog = useDialog();
  const theme = useTheme();

  const [filter, setFilter] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [favorites, setFavorites] = createSignal<Set<string>>(new Set());
  
  // Ref for input element
  let inputRef: any = null;

  onMount(() => {
    const favSet = new Set(
      props.data.favorites.map((f) => `${f.providerID}/${f.modelID}`)
    );
    setFavorites(favSet);
    tuiLogger.info("[ModelsDialog] Mounted", {
      recentCount: props.data.recent.length,
      favoritesCount: props.data.favorites.length,
      providersCount: props.data.providers.length,
    });
  });

  // Build flat model list (no headers, just models for simplicity)
  const filteredModels = createMemo(() => {
    const f = filter().toLowerCase().trim();
    const models: (ModelInfo & { group: string })[] = [];

    // Add all models from all providers
    for (const provider of props.data.providers) {
      for (const model of provider.models) {
        const key = `${provider.providerID}/${model.modelID}`;
        const isFav = favorites().has(key);
        
        if (f && !model.modelID.toLowerCase().includes(f) && !provider.providerName.toLowerCase().includes(f)) {
          continue;
        }
        
        models.push({
          ...model,
          providerID: provider.providerID,
          providerName: provider.providerName,
          isFavorite: isFav,
          group: provider.providerName,
        });
      }
    }

    tuiLogger.info("[ModelsDialog] Filtered models", { count: models.length, filter: f });
    return models;
  });

  const moveSelection = (direction: -1 | 1) => {
    const list = filteredModels();
    if (list.length === 0) return;

    let next = selectedIndex() + direction;
    if (next < 0) next = list.length - 1;
    if (next >= list.length) next = 0;

    setSelectedIndex(next);
    tuiLogger.info("[ModelsDialog] Selection moved", { direction, newIndex: next });
  };

  const handleListKeyDown = (key: string): boolean => {
    tuiLogger.info("[ModelsDialog] handleListKeyDown", { key });
    
    switch (key.toLowerCase()) {
      case "up":
      case "arrowup":
        moveSelection(-1);
        return true;
      case "down":
      case "arrowdown":
        moveSelection(1);
        return true;
      case "return":
      case "enter":
        selectModel();
        return true;
      case "escape":
        dialog.pop();
        return true;
      case "f":
        toggleFavorite();
        return true;
      default:
        return false;
    }
  };

  const selectModel = async () => {
    const list = filteredModels();
    if (list.length === 0) return;

    const selected = list[selectedIndex()];
    if (!selected) return;

    tuiLogger.info("[ModelsDialog] Selecting model", {
      providerID: selected.providerID,
      modelID: selected.modelID,
    });

    const result = await command.executeCommand(
      "models",
      JSON.stringify({
        type: "select",
        providerID: selected.providerID,
        modelID: selected.modelID,
      })
    );

    if (result.success) {
      tuiLogger.info("[ModelsDialog] Model selected successfully");
      dialog.pop();
    } else {
      tuiLogger.error("[ModelsDialog] Failed to select model", {
        message: result.message,
      });
    }
  };

  const toggleFavorite = async () => {
    const list = filteredModels();
    if (list.length === 0) return;

    const selected = list[selectedIndex()];
    if (!selected) return;

    const result = await command.executeCommand(
      "models",
      JSON.stringify({
        type: "toggle_favorite",
        providerID: selected.providerID,
        modelID: selected.modelID,
      })
    );

    if (result.success) {
      const key = `${selected.providerID}/${selected.modelID}`;
      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
      tuiLogger.info("[ModelsDialog] Favorite toggled", { key });
    }
  };

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      {/* Search box */}
      <box flexDirection="row" height={1} marginBottom={1}>
        <text fg={theme.theme().primary}>&gt; </text>
        <input
          ref={(ref: any) => { inputRef = ref; }}
          flexGrow={1}
          value={filter()}
          onContentChange={(event: any) => {
            // Get value from ref (like InputBox does)
            const value = inputRef?.plainText || inputRef?.value || "";
            tuiLogger.info("[ModelsDialog] Filter changed from ref", { value, hasRef: !!inputRef });
            setFilter(value);
            setSelectedIndex(0);
          }}
          placeholder="Filter models..."
          focused={true}
          onKeyDown={(e: any) => {
            if (handleListKeyDown(e.name || e.key)) {
              e.preventDefault();
            }
          }}
        />
      </box>

      <box height={1} borderStyle="single" borderColor={theme.theme().border} />

      {/* Model list */}
      <box flexGrow={1} flexDirection="column" overflow="scroll" marginTop={1}>
        <Show
          when={filteredModels().length > 0}
          fallback={
            <text fg={theme.theme().muted}>
              No models found{filter() ? ` (filter: "${filter()}")` : ""}
            </text>
          }
        >
          <For each={filteredModels()}>
            {(model, index) => {
              const isSelected = () => index() === selectedIndex();

              return (
                <box
                  flexDirection="row"
                  alignItems="center"
                  paddingLeft={2}
                  paddingRight={1}
                  height={1}
                  backgroundColor={isSelected() ? theme.theme().primary : undefined}
                >
                  <text
                    fg={isSelected() ? theme.theme().background : theme.theme().foreground}
                  >
                    {model.modelID}
                  </text>
                  <Show when={model.isFavorite}>
                    <text
                      fg={isSelected() ? theme.theme().background : theme.theme().success}
                      marginLeft={1}
                    >
                      ★
                    </text>
                  </Show>
                  <box flexGrow={1} />
                  <text
                    fg={isSelected() ? theme.theme().background : theme.theme().muted}
                  >
                    {model.group}
                  </text>
                </box>
              );
            }}
          </For>
        </Show>
      </box>

      {/* Footer */}
      <box flexDirection="row" height={1} marginTop={1}>
        <text fg={theme.theme().muted}>
          ↑↓ navigate • Enter select • F favorite • Esc close • {filteredModels().length} models
        </text>
      </box>
    </box>
  );
}
