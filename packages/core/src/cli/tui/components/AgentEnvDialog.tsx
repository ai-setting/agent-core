/**
 * @fileoverview AgentEnvDialog Component - Environment management dialog
 */

import { createSignal, createMemo, For, Show, onMount } from "solid-js";
import { useCommand, useDialog, useTheme } from "../contexts/index.js";
import { tuiLogger } from "../logger.js";

interface EnvironmentInfo {
  id: string;
  displayName: string;
  description?: string;
  isActive: boolean;
  configPath: string;
  createdAt?: string;
  updatedAt?: string;
}

interface AgentEnvDialogData {
  environments: EnvironmentInfo[];
  activeEnvironment?: string;
}

interface AgentEnvDialogProps {
  data: AgentEnvDialogData;
}

type DialogView = 
  | { type: "list" }
  | { type: "create" }
  | { type: "edit"; env: EnvironmentInfo }
  | { type: "confirm_delete"; env: EnvironmentInfo };

export function AgentEnvDialog(props: AgentEnvDialogProps) {
  const command = useCommand();
  const dialog = useDialog();
  const theme = useTheme();

  const [view, setView] = createSignal<DialogView>({ type: "list" });
  const [filter, setFilter] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [environments, setEnvironments] = createSignal(props.data.environments || []);
  const [message, setMessage] = createSignal<{ text: string; type: "success" | "error" } | null>(null);

  // Form state for create/edit
  const [formName, setFormName] = createSignal("");
  const [formDisplayName, setFormDisplayName] = createSignal("");
  const [formDescription, setFormDescription] = createSignal("");

  let inputRef: any = null;

  onMount(() => {
    tuiLogger.info("[AgentEnvDialog] Mounted", {
      envCount: props.data.environments?.length || 0,
      activeEnv: props.data.activeEnvironment,
      hasData: !!props.data,
      dataKeys: props.data ? Object.keys(props.data) : [],
    });
  });

  // Filtered environments
  const filteredEnvs = createMemo(() => {
    const f = filter().toLowerCase().trim();
    if (!f) return environments();
    return environments().filter(env => 
      env.displayName.toLowerCase().includes(f) ||
      env.id.toLowerCase().includes(f) ||
      (env.description && env.description.toLowerCase().includes(f))
    );
  });

  const moveSelection = (direction: -1 | 1) => {
    const list = filteredEnvs();
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
        selectEnv();
        return true;
      case "escape":
        dialog.pop();
        return true;
      case "n":
        // N key to create new
        setView({ type: "create" });
        setFormName("");
        setFormDisplayName("");
        setFormDescription("");
        setMessage(null);
        return true;
      case "d":
        // D key to delete
        const env = filteredEnvs()[selectedIndex()];
        if (env && !env.isActive) {
          setView({ type: "confirm_delete", env });
          setMessage(null);
        } else if (env?.isActive) {
          setMessage({ text: "Cannot delete active environment", type: "error" });
        }
        return true;
      case "e":
        // E key to edit
        const editEnv = filteredEnvs()[selectedIndex()];
        if (editEnv) {
          setView({ type: "edit", env: editEnv });
          setFormDisplayName(editEnv.displayName);
          setFormDescription(editEnv.description || "");
          setMessage(null);
        }
        return true;
      default:
        return false;
    }
  };

  const selectEnv = async () => {
    const env = filteredEnvs()[selectedIndex()];
    if (!env) return;

    if (env.isActive) {
      setMessage({ text: "Already active", type: "success" });
      return;
    }

    tuiLogger.info("[AgentEnvDialog] Switching environment", { id: env.id });

    const result = await command.executeCommand(
      "agent-env",
      JSON.stringify({ type: "select", envName: env.id })
    );

    if (result.success) {
      setMessage({ text: result.message || "Environment switched", type: "success" });
      // Update active status in list
      setEnvironments(prev => prev.map(e => ({
        ...e,
        isActive: e.id === env.id
      })));
    } else {
      setMessage({ text: result.message || "Failed to switch", type: "error" });
    }
  };

  const createEnv = async () => {
    const name = formName().trim();
    const displayName = formDisplayName().trim() || name;
    const description = formDescription().trim();

    if (!name) {
      setMessage({ text: "Name is required", type: "error" });
      return;
    }

    tuiLogger.info("[AgentEnvDialog] Creating environment", { name, displayName });

    const result = await command.executeCommand(
      "agent-env",
      JSON.stringify({
        type: "create",
        envName: name,
        config: { displayName, description }
      })
    );

    if (result.success) {
      setMessage({ text: result.message || "Environment created", type: "success" });
      setView({ type: "list" });
      refreshList();
    } else {
      setMessage({ text: result.message || "Failed to create", type: "error" });
    }
  };

  const updateEnv = async () => {
    const currentView = view();
    if (currentView.type !== "edit") return;

    const displayName = formDisplayName().trim();
    const description = formDescription().trim();

    tuiLogger.info("[AgentEnvDialog] Updating environment", { 
      id: currentView.env.id, 
      displayName 
    });

    const result = await command.executeCommand(
      "agent-env",
      JSON.stringify({
        type: "update",
        envName: currentView.env.id,
        config: { displayName, description }
      })
    );

    if (result.success) {
      setMessage({ text: result.message || "Environment updated", type: "success" });
      setView({ type: "list" });
      refreshList();
    } else {
      setMessage({ text: result.message || "Failed to update", type: "error" });
    }
  };

  const deleteEnv = async () => {
    const currentView = view();
    if (currentView.type !== "confirm_delete") return;
    
    tuiLogger.info("[AgentEnvDialog] Deleting environment", { id: currentView.env.id });

    const result = await command.executeCommand(
      "agent-env",
      JSON.stringify({ type: "delete", envName: currentView.env.id })
    );

    if (result.success) {
      setMessage({ text: result.message || "Environment deleted", type: "success" });
      setView({ type: "list" });
      setSelectedIndex(0);
      refreshList();
    } else {
      setMessage({ text: result.message || "Failed to delete", type: "error" });
    }
  };

  const refreshList = async () => {
    const result = await command.executeCommand(
      "agent-env",
      JSON.stringify({ type: "list" })
    );
    if (result.success) {
      const data = result.data as AgentEnvDialogData | undefined;
      if (data?.environments) {
        setEnvironments(data.environments);
      }
    }
  };

  // Render list view
  const renderListView = () => (
    <>
      {/* Title bar */}
      <box
        flexDirection="row"
        alignItems="center"
        height={1}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.theme().border}
      >
        <text fg={theme.theme().foreground}>Manage Environments</text>
        <box flexGrow={1} />
        <text fg={theme.theme().muted}>N: new</text>
      </box>

      {/* Search box */}
      <box flexDirection="row" height={1} margin={1}>
        <text fg={theme.theme().primary}>&gt; </text>
        <input
          ref={(ref: any) => { inputRef = ref; }}
          flexGrow={1}
          value={filter()}
          onContentChange={(event: any) => {
            const value = inputRef?.plainText || inputRef?.value || "";
            setFilter(value);
            setSelectedIndex(0);
          }}
          placeholder="Filter environments..."
          focused={true}
          onKeyDown={(e: any) => {
            if (handleListKeyDown(e.name || e.key)) {
              e.preventDefault();
            }
          }}
        />
      </box>

      <box height={1} borderStyle="single" borderColor={theme.theme().border} />

      {/* Environment list */}
      <box flexGrow={1} flexDirection="column" overflow="scroll" marginTop={1}>
        <Show
          when={filteredEnvs().length > 0}
          fallback={
            <box paddingLeft={2}>
              <text fg={theme.theme().muted}>
                No environments found{filter() ? ` (filter: "${filter()}")` : ""}
              </text>
            </box>
          }
        >
          <For each={filteredEnvs()}>
            {(env, index) => {
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
                  <Show when={env.isActive}>
                    <text
                      fg={isSelected() ? theme.theme().background : theme.theme().success}
                      marginRight={1}
                    >
                      ★
                    </text>
                  </Show>
                  <Show when={!env.isActive}>
                    <text marginRight={1}> </text>
                  </Show>
                  <text
                    fg={isSelected() ? theme.theme().background : theme.theme().foreground}
                  >
                    {env.displayName}
                  </text>
                  <box flexGrow={1} />
                  <text
                    fg={isSelected() ? theme.theme().background : theme.theme().muted}
                  >
                    {env.isActive ? "active" : env.id}
                  </text>
                </box>
              );
            }}
          </For>
        </Show>
      </box>

      {/* Message display */}
      <Show when={message()}>
        <box flexDirection="row" height={1} marginTop={1} paddingLeft={2}>
          <text fg={message()?.type === "success" ? theme.theme().success : theme.theme().error}>
            {message()?.text}
          </text>
        </box>
      </Show>

      {/* Footer */}
      <box flexDirection="row" height={1} marginTop={1}>
        <text fg={theme.theme().muted}>
          ↑↓ navigate • Enter switch • N new • E edit • D delete • Esc close
        </text>
      </box>
    </>
  );

  // Render create view
  const renderCreateView = () => (
    <>
      <box
        flexDirection="row"
        alignItems="center"
        height={1}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.theme().border}
      >
        <text fg={theme.theme().foreground}>Create New Environment</text>
      </box>

      <box flexDirection="column" padding={1} flexGrow={1}>
        <box flexDirection="row" height={1} marginBottom={1}>
          <text fg={theme.theme().muted} width={15}>Name:</text>
          <input
            flexGrow={1}
            value={formName()}
            onChange={setFormName}
            placeholder="unique-id"
            focused={true}
          />
        </box>

        <box flexDirection="row" height={1} marginBottom={1}>
          <text fg={theme.theme().muted} width={15}>Display Name:</text>
          <input
            flexGrow={1}
            value={formDisplayName()}
            onChange={setFormDisplayName}
            placeholder="Display Name"
          />
        </box>

        <box flexDirection="row" height={1}>
          <text fg={theme.theme().muted} width={15}>Description:</text>
          <input
            flexGrow={1}
            value={formDescription()}
            onChange={setFormDescription}
            placeholder="Description"
          />
        </box>
      </box>

      <Show when={message()}>
        <box flexDirection="row" height={1} marginTop={1} paddingLeft={2}>
          <text fg={message()?.type === "success" ? theme.theme().success : theme.theme().error}>
            {message()?.text}
          </text>
        </box>
      </Show>

      <box flexDirection="row" height={1} marginTop={1}>
        <text fg={theme.theme().muted}>
          Enter confirm • Esc cancel
        </text>
      </box>
    </>
  );

  // Render edit view
  const renderEditView = () => {
    const currentView = view();
    if (currentView.type !== "edit") return null;

    return (
      <>
        <box
          flexDirection="row"
          alignItems="center"
          height={1}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={theme.theme().border}
        >
          <text fg={theme.theme().foreground}>Edit Environment: {currentView.env.id}</text>
        </box>

        <box flexDirection="column" padding={1} flexGrow={1}>
          <box flexDirection="row" height={1} marginBottom={1}>
            <text fg={theme.theme().muted} width={15}>Display Name:</text>
            <input
              flexGrow={1}
              value={formDisplayName()}
              onChange={setFormDisplayName}
              placeholder="Display Name"
              focused={true}
            />
          </box>

          <box flexDirection="row" height={1}>
            <text fg={theme.theme().muted} width={15}>Description:</text>
            <input
              flexGrow={1}
              value={formDescription()}
              onChange={setFormDescription}
              placeholder="Description"
            />
          </box>
        </box>

        <Show when={message()}>
          <box flexDirection="row" height={1} marginTop={1} paddingLeft={2}>
            <text fg={message()?.type === "success" ? theme.theme().success : theme.theme().error}>
              {message()?.text}
            </text>
          </box>
        </Show>

        <box flexDirection="row" height={1} marginTop={1}>
          <text fg={theme.theme().muted}>
            Enter confirm • Esc cancel
          </text>
        </box>
      </>
    );
  };

  // Render confirm delete view
  const renderConfirmDeleteView = () => {
    const currentView = view();
    if (currentView.type !== "confirm_delete") return null;

    return (
      <>
        <box
          flexDirection="row"
          alignItems="center"
          height={1}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={theme.theme().border}
        >
          <text fg={theme.theme().error}>Confirm Delete</text>
        </box>

        <box flexDirection="column" padding={1} flexGrow={1}>
          <text fg={theme.theme().foreground}>
            Are you sure you want to delete:
          </text>
          <text fg={theme.theme().primary} marginTop={1}>
            {currentView.env.displayName} ({currentView.env.id})
          </text>
          <Show when={currentView.env.description}>
            <text fg={theme.theme().muted} marginTop={1}>
              {currentView.env.description}
            </text>
          </Show>
        </box>

        <Show when={message()}>
          <box flexDirection="row" height={1} marginTop={1} paddingLeft={2}>
            <text fg={message()?.type === "success" ? theme.theme().success : theme.theme().error}>
              {message()?.text}
            </text>
          </box>
        </Show>

        <box flexDirection="row" height={1} marginTop={1}>
          <text fg={theme.theme().muted}>
            Enter confirm • Esc cancel
          </text>
        </box>
      </>
    );
  };

  // Handle keyboard for create/edit/delete views
  const handleFormKeyDown = (e: any) => {
    const key = (e.name || e.key).toLowerCase();
    
    if (key === "escape") {
      setView({ type: "list" });
      setMessage(null);
      e.preventDefault();
    } else if (key === "return" || key === "enter") {
      const currentView = view();
      if (currentView.type === "create") {
        createEnv();
      } else if (currentView.type === "edit") {
        updateEnv();
      } else if (currentView.type === "confirm_delete") {
        deleteEnv();
      }
      e.preventDefault();
    }
  };

  tuiLogger.info("[AgentEnvDialog] Rendering", { 
    viewType: view().type,
    envCount: environments().length 
  });

  return (
    <box 
      flexDirection="column" 
      width="100%" 
      height="100%" 
      padding={1}
      onKeyDown={handleFormKeyDown}
    >
      <Show when={view().type === "list"}>{renderListView()}</Show>
      <Show when={view().type === "create"}>{renderCreateView()}</Show>
      <Show when={view().type === "edit"}>{renderEditView()}</Show>
      <Show when={view().type === "confirm_delete"}>{renderConfirmDeleteView()}</Show>
    </box>
  );
}
