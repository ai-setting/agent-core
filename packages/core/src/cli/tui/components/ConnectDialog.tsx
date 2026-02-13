/**
 * @fileoverview ConnectDialog Component - Provider Connection Dialog
 *
 * Allows users to manage LLM provider connections and API keys
 * - View configured providers
 * - Add new providers
 * - Set API keys
 */

import { createSignal, createMemo, For, Show, onMount } from "solid-js";
import { useCommand, useDialog, useTheme } from "../contexts/index.js";
import { tuiLogger } from "../logger.js";

interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  baseURL?: string;
  hasKey: boolean;
}

type DialogState =
  | { type: "list" }
  | { type: "add_custom"; baseURL?: string }
  | { type: "set_api_key"; provider: ProviderInfo };

export function ConnectDialog() {
  const command = useCommand();
  const dialog = useDialog();
  const theme = useTheme();

  const [state, setState] = createSignal<DialogState>({ type: "list" });
  const [providers, setProviders] = createSignal<ProviderInfo[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [filter, setFilter] = createSignal("");
  const [customName, setCustomName] = createSignal("");
  const [customBaseURL, setCustomBaseURL] = createSignal("");
  const [customModels, setCustomModels] = createSignal("");
  const [apiKey, setApiKey] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Refs for custom provider form - need to be at component level to be accessible by global handler
  let customNameRef: any = null;
  let customBaseURLRef: any = null;
  let customModelsRef: any = null;
  let filterInputRef: any = null;

  const handleAddCustomProvider = () => {
    const name = customNameRef?.value || customNameRef?.plainText || "";
    const baseURL = customBaseURLRef?.value || customBaseURLRef?.plainText || "";
    const modelsText = customModelsRef?.value || customModelsRef?.plainText || "";
    
    // Parse models (comma or newline separated)
    const models = modelsText
      .split(/[\n,]/)
      .map((m: string) => m.trim())
      .filter((m: string) => m.length > 0);
    
    tuiLogger.info("[ConnectDialog] handleAddCustomProvider from refs", { 
      name, 
      baseURL,
      modelsCount: models.length,
      models,
      nameLength: name.length,
      baseURLLength: baseURL.length 
    });
    
    setCustomName(name);
    setCustomBaseURL(baseURL);
    setCustomModels(modelsText);
    
    const trimmedName = name.trim();
    const trimmedBaseURL = baseURL.trim();
    
    if (!trimmedName) {
      setError("Provider name is required");
      return;
    }

    const providerId = trimmedName.toLowerCase().replace(/\s+/g, "-");
    
    tuiLogger.info("[ConnectDialog] Adding custom provider from refs", { 
      providerId, 
      name: trimmedName, 
      baseURL: trimmedBaseURL,
      models 
    });

    setIsLoading(true);
    command.executeCommand(
      "connect",
      JSON.stringify({
        type: "add",
        providerId,
        providerName: trimmedName,
        baseURL: trimmedBaseURL || undefined,
        models: models.length > 0 ? models : undefined,
        description: `Custom provider ${trimmedName}`,
      })
    ).then((result) => {
      if (result.success) {
        tuiLogger.info("[ConnectDialog] Custom provider added", { providerId });
        loadProviders();
        setState({ type: "list" });
        setCustomName("");
        setCustomBaseURL("");
        setCustomModels("");
        setError(null);
      } else {
        setError(result.message || "Failed to add provider");
      }
    }).catch((err) => {
      tuiLogger.error("[ConnectDialog] Failed to add provider", { error: String(err) });
      setError("Failed to add provider");
    }).finally(() => {
      setIsLoading(false);
    });
  };

  const loadProviders = async () => {
    setIsLoading(true);
    try {
      const result = await command.executeCommand("connect", JSON.stringify({ type: "list" }));
      if (result.success && result.data && typeof result.data === "object" && "providers" in result.data) {
        const loadedProviders = (result.data as { providers: ProviderInfo[] }).providers;
        setProviders(loadedProviders);
        tuiLogger.info("[ConnectDialog] Loaded providers", { 
          count: loadedProviders.length,
          providerIds: loadedProviders.map(p => p.id),
          customProviders: loadedProviders.filter(p => !p.description?.includes("built-in")).map(p => ({ id: p.id, name: p.name }))
        });
      }
    } catch (err) {
      tuiLogger.error("[ConnectDialog] Failed to load providers", { error: String(err) });
      setError("Failed to load providers");
    } finally {
      setIsLoading(false);
    }
  };

  onMount(() => {
    tuiLogger.info("[ConnectDialog] Mounting, loading providers");
    loadProviders();
  });

  const filteredProviders = createMemo(() => {
    const f = filter().toLowerCase().trim();
    const list = providers();
    if (!f) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(f) ||
        p.description.toLowerCase().includes(f) ||
        p.id.toLowerCase().includes(f)
    );
  });

  const moveSelection = (direction: -1 | 1) => {
    const list = filteredProviders();
    if (list.length === 0) return;

    let next = selectedIndex() + direction;
    if (next < 0) next = list.length - 1;
    if (next >= list.length) next = 0;

    setSelectedIndex(next);
  };

  const handleListKeyDown = (key: string): boolean => {
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
        selectProvider();
        return true;
      case "escape":
        dialog.pop();
        return true;
      default:
        return false;
    }
  };

  const handleInputKeyDown = (key: string): boolean => {
    switch (key.toLowerCase()) {
      case "escape":
        if (state().type === "add_custom") {
          setState({ type: "list" });
          setCustomName("");
          setCustomBaseURL("");
        } else if (state().type === "set_api_key") {
          setState({ type: "list" });
          setApiKey("");
        }
        return true;
      case "return":
      case "enter":
        tuiLogger.info("[ConnectDialog] Enter pressed in global handler", { stateType: state().type });
        if (state().type === "add_custom") {
          tuiLogger.info("[ConnectDialog] Calling handleAddCustomProvider from global handler");
          handleAddCustomProvider();
        } else if (state().type === "set_api_key") {
          tuiLogger.info("[ConnectDialog] Calling saveApiKey");
          saveApiKey();
        }
        return true;
      default:
        return false;
    }
  };

  const selectProvider = async () => {
    const list = filteredProviders();
    if (list.length === 0) return;

    const selected = list[selectedIndex()];
    if (!selected) return;

    if (selected.id === "custom") {
      setState({ type: "add_custom" });
      setSelectedIndex(0);
    } else {
      setState({ type: "set_api_key", provider: selected });
      setSelectedIndex(0);
    }
  };

  const addCustomProvider = async () => {
    const name = customName().trim();
    const baseURL = customBaseURL().trim();

    tuiLogger.info("[ConnectDialog] addCustomProvider called", { 
      name, 
      baseURL,
      nameLength: name.length,
      baseURLLength: baseURL.length 
    });

    if (!name) {
      setError("Provider name is required");
      return;
    }

    const providerId = name.toLowerCase().replace(/\s+/g, "-");

    tuiLogger.info("[ConnectDialog] Adding custom provider", { providerId, name, baseURL });

    setIsLoading(true);
    try {
      const payload = {
        type: "add",
        providerId,
        providerName: name,
        baseURL: baseURL || undefined,
      };
      tuiLogger.info("[ConnectDialog] Sending add command", { payload });

      const result = await command.executeCommand(
        "connect",
        JSON.stringify(payload)
      );

      if (result.success) {
        tuiLogger.info("[ConnectDialog] Custom provider added", { providerId });
        await loadProviders();
        setState({ type: "list" });
        setCustomName("");
        setCustomBaseURL("");
        setError(null);
      } else {
        setError(result.message || "Failed to add provider");
      }
    } catch (err) {
      tuiLogger.error("[ConnectDialog] Failed to add provider", { error: String(err) });
      setError("Failed to add provider");
    } finally {
      setIsLoading(false);
    }
  };

  const saveApiKey = async (keyValue?: string) => {
    const key = (keyValue || apiKey()).trim();
    const currentState = state();

    tuiLogger.info("[ConnectDialog] saveApiKey called", { 
      keyLength: key.length,
      hasKey: !!key,
      stateType: currentState.type,
      fromParam: !!keyValue
    });

    if (currentState.type !== "set_api_key") return;

    if (!key) {
      tuiLogger.warn("[ConnectDialog] API key is empty");
      setError("API key is required");
      return;
    }

    setIsLoading(true);
    try {
      const providerBaseURL = currentState.provider.baseURL;
      tuiLogger.info("[ConnectDialog] Saving API key with baseURL", {
        providerId: currentState.provider.id,
        baseURL: providerBaseURL,
      });

      const result = await command.executeCommand(
        "connect",
        JSON.stringify({
          type: "set_key",
          providerId: currentState.provider.id,
          apiKey: key,
          baseURL: providerBaseURL,
        })
      );

      if (result.success) {
        tuiLogger.info("[ConnectDialog] API key saved", { providerId: currentState.provider.id });
        await loadProviders();
        setState({ type: "list" });
        setApiKey("");
        setError(null);
      } else {
        setError(result.message || "Failed to save API key");
      }
    } catch (err) {
      tuiLogger.error("[ConnectDialog] Failed to save API key", { error: String(err) });
      setError("Failed to save API key");
    } finally {
      setIsLoading(false);
    }
  };

  const renderListView = () => (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      <box flexDirection="row" height={1} marginBottom={1}>
        <text fg={theme.theme().primary}>&gt; </text>
        <input
          ref={(ref: any) => { filterInputRef = ref; }}
          flexGrow={1}
          value={filter()}
          onContentChange={(event: any) => {
            const value = filterInputRef?.plainText || filterInputRef?.value || "";
            tuiLogger.info("[ConnectDialog] Filter changed from ref", { value, hasRef: !!filterInputRef });
            setFilter(value);
          }}
          placeholder="Search providers..."
          focused={true}
          onKeyDown={(e: any) => {
            if (handleListKeyDown(e.name || e.key)) {
              e.preventDefault();
            }
          }}
        />
      </box>

      <box height={1} borderStyle="single" borderColor={theme.theme().border} />

      <box flexGrow={1} flexDirection="column" overflow="scroll" marginTop={1}>
        <Show when={!isLoading()} fallback={<text fg={theme.theme().muted}>Loading...</text>}>
          <Show when={filteredProviders().length > 0} fallback={<text fg={theme.theme().muted}>No providers found</text>}>
            <For each={filteredProviders()}>
              {(provider, index) => {
                const isSelected = () => index() === selectedIndex();
                const displayIndex = filteredProviders().indexOf(provider);

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
                      fg={isSelected() ? theme.theme().background : theme.theme().primary}
                    >
                      {provider.name}
                    </text>
                    <Show when={provider.hasKey}>
                      <text
                        fg={isSelected() ? theme.theme().background : theme.theme().success}
                        marginLeft={1}
                      >
                        [Configured]
                      </text>
                    </Show>
                    <box flexGrow={1} />
                    <text
                      fg={isSelected() ? theme.theme().background : theme.theme().muted}
                    >
                      {provider.description}
                    </text>
                  </box>
                );
              }}
            </For>
          </Show>
        </Show>
      </box>

      <box flexDirection="row" height={1} marginTop={1}>
        <text fg={theme.theme().muted}>
          ↑↓ navigate • Enter select • Esc close • {filteredProviders().length} providers
        </text>
      </box>
    </box>
  );

  const renderAddCustomView = () => (
    <box flexDirection="column" width="100%" height="100%" padding={2}>
      <text fg={theme.theme().foreground} marginBottom={1}>
        Add Custom Provider
      </text>

      <box flexDirection="column" marginBottom={1}>
        <text fg={theme.theme().muted} marginBottom={1}>
          Provider Name:
        </text>
        <input
          ref={(ref: any) => { customNameRef = ref; }}
          value={customName()}
          onChange={(value: string) => {
            tuiLogger.info("[ConnectDialog] Provider name input changed", { valueLength: value?.length || 0, value });
            setCustomName(value || "");
          }}
          placeholder="e.g., My Custom Provider"
          focused={true}
          onKeyDown={(e: any) => {
            const key = e.name || e.key;
            if (key === "escape" || key === "Escape") {
              setState({ type: "list" });
              setCustomName("");
              setCustomBaseURL("");
            } else if (key === "return" || key === "Enter") {
              handleAddCustomProvider();
            }
          }}
        />
      </box>

      <box flexDirection="column" marginBottom={1}>
        <text fg={theme.theme().muted} marginBottom={1}>
          Base URL (optional):
        </text>
        <input
          ref={(ref: any) => { customBaseURLRef = ref; }}
          value={customBaseURL()}
          onChange={(value: string) => {
            tuiLogger.info("[ConnectDialog] Base URL input changed", { valueLength: value?.length || 0, value });
            setCustomBaseURL(value || "");
          }}
          placeholder="e.g., https://api.example.com/v1"
          onKeyDown={(e: any) => {
            const key = e.name || e.key;
            if (key === "escape" || key === "Escape") {
              setState({ type: "list" });
              setCustomName("");
              setCustomBaseURL("");
              setCustomModels("");
            } else if (key === "return" || key === "Enter") {
              handleAddCustomProvider();
            }
          }}
        />
      </box>

      <box flexDirection="column" marginBottom={1}>
        <text fg={theme.theme().muted} marginBottom={1}>
          Models (optional, comma separated):
        </text>
        <input
          ref={(ref: any) => { customModelsRef = ref; }}
          value={customModels()}
          onChange={(value: string) => {
            tuiLogger.info("[ConnectDialog] Models input changed", { valueLength: value?.length || 0 });
            setCustomModels(value || "");
          }}
          placeholder="e.g., gpt-4, gpt-3.5-turbo, claude-3"
          onKeyDown={(e: any) => {
            const key = e.name || e.key;
            if (key === "escape" || key === "Escape") {
              setState({ type: "list" });
              setCustomName("");
              setCustomBaseURL("");
              setCustomModels("");
            } else if (key === "return" || key === "Enter") {
              handleAddCustomProvider();
            }
          }}
        />
      </box>

      <Show when={error()}>
        <text fg={theme.theme().error} marginTop={1}>
          {error()}
        </text>
      </Show>

      <box flexDirection="row" height={1} marginTop={2}>
        <text fg={theme.theme().muted}>Enter save • Esc cancel</text>
      </box>
    </box>
  );

  const renderSetApiKeyView = () => {
    const currentState = state();
    const provider = currentState.type === "set_api_key" ? currentState.provider : null;
    let inputRef: any = null;

    tuiLogger.info("[ConnectDialog] Rendering set_api_key view", {
      providerId: provider?.id,
      providerName: provider?.name,
      providerBaseURL: provider?.baseURL,
      fullProvider: provider,
    });

    const handleSave = () => {
      const value = inputRef?.value || inputRef?.plainText || "";
      tuiLogger.info("[ConnectDialog] Getting API key from ref", {
        valueLength: value.length,
        providerBaseURL: provider?.baseURL,
      });
      setApiKey(value);
      saveApiKey(value);
    };

    return (
      <box flexDirection="column" width="100%" height="100%" padding={2}>
        <text fg={theme.theme().foreground} marginBottom={1}>
          Set API Key for {provider?.name}
        </text>

        <Show when={provider?.baseURL}>
          <text fg={theme.theme().muted} marginBottom={1}>
            Base URL: {provider?.baseURL}
          </text>
        </Show>

        <box flexDirection="column" marginBottom={1}>
          <text fg={theme.theme().muted} marginBottom={1}>
            API Key:
          </text>
          <input
            ref={(ref: any) => {
              inputRef = ref;
              tuiLogger.info("[ConnectDialog] Input ref set", { hasRef: !!ref });
            }}
            value={apiKey()}
            onChange={(value: string) => {
              tuiLogger.info("[ConnectDialog] API Key input changed", { valueLength: value?.length || 0 });
              setApiKey(value || "");
            }}
            placeholder="Enter your API key"
            focused={true}
            onKeyDown={(e: any) => {
              const key = e.name || e.key;
              tuiLogger.info("[ConnectDialog] Input onKeyDown", { key });
              if (key === "escape" || key === "Escape") {
                setState({ type: "list" });
                setApiKey("");
              } else if (key === "return" || key === "Enter") {
                handleSave();
              }
            }}
          />
        </box>

        <Show when={error()}>
          <text fg={theme.theme().error} marginTop={1}>
            {error()}
          </text>
        </Show>

        <box flexDirection="row" height={1} marginTop={2}>
          <text fg={theme.theme().muted}>Enter save • Esc cancel</text>
        </box>
      </box>
    );
  };

  const currentView = () => {
    const s = state();
    switch (s.type) {
      case "list":
        return renderListView();
      case "add_custom":
        return renderAddCustomView();
      case "set_api_key":
        return renderSetApiKeyView();
    }
  };

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box
        flexDirection="row"
        alignItems="center"
        height={1}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.theme().border}
      >
        <text fg={theme.theme().foreground}>Connect</text>
        <box flexGrow={1} />
        <text fg={theme.theme().muted}>Esc to close</text>
      </box>

      {currentView()}
    </box>
  );
}
