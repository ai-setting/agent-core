/**
 * @fileoverview SessionsDialog Component - Session list and management dialog
 *
 * Features:
 * - List all sessions with title, time, message count
 * - Search/filter sessions
 * - Select and switch to a session
 * - Delete sessions with confirmation
 */

import { createSignal, createMemo, For, Show, onMount } from "solid-js";
import { useCommand, useDialog, useTheme, useStore, useEventStream } from "../contexts/index.js";
import { tuiLogger } from "../logger.js";

interface SessionListItem {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  directory: string;
}

interface SessionsDialogData {
  sessions: SessionListItem[];
}

interface SessionsDialogProps {
  data: SessionsDialogData;
}

// Format timestamp to relative time (e.g., "2 hours ago")
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;

  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function SessionsDialog(props: SessionsDialogProps) {
  const command = useCommand();
  const dialog = useDialog();
  const theme = useTheme();
  const store = useStore();
  const eventStream = useEventStream();

  const [filter, setFilter] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [deleteTarget, setDeleteTarget] = createSignal<SessionListItem | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  let inputRef: any = null;

  onMount(() => {
    tuiLogger.info("[SessionsDialog] Mounted", {
      sessionCount: props.data.sessions.length,
    });
  });

  // Filter sessions by search text
  const filteredSessions = createMemo(() => {
    const f = filter().toLowerCase().trim();
    if (!f) return props.data.sessions;

    return props.data.sessions.filter(
      (session) =>
        session.title.toLowerCase().includes(f) ||
        session.directory.toLowerCase().includes(f)
    );
  });

  const moveSelection = (direction: -1 | 1) => {
    const list = filteredSessions();
    if (list.length === 0) return;

    let next = selectedIndex() + direction;
    if (next < 0) next = list.length - 1;
    if (next >= list.length) next = 0;

    setSelectedIndex(next);
  };

  const handleListKeyDown = (key: string): boolean => {
    tuiLogger.info("[SessionsDialog] handleListKeyDown", { key });

    // Handle delete confirmation
    if (showDeleteConfirm()) {
      switch (key.toLowerCase()) {
        case "y":
          confirmDelete();
          return true;
        case "n":
        case "escape":
          cancelDelete();
          return true;
        default:
          return true; // Block other keys during confirmation
      }
    }

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
        selectSession();
        return true;
      case "d":
        initiateDelete();
        return true;
      case "escape":
        dialog.pop();
        return true;
      default:
        return false;
    }
  };

  const selectSession = async () => {
    const list = filteredSessions();
    const selected = list[selectedIndex()];
    if (!selected) return;

    tuiLogger.info("[SessionsDialog] Selecting session", {
      sessionId: selected.id,
      title: selected.title,
    });

    const result = await command.executeCommand(
      "sessions",
      JSON.stringify({
        type: "select",
        sessionId: selected.id,
      })
    );

    if (result.success) {
      tuiLogger.info("[SessionsDialog] Session selected successfully, loading messages");
      
      // Close dialog first for better UX
      dialog.pop();
      
      // Update session ID and load messages
      store.setSessionId(selected.id);
      store.setSessionTitle(selected.title);
      await eventStream.loadMessages(selected.id);
      
      // Reconnect event stream for the new session
      eventStream.disconnect();
      await eventStream.connect();
    } else {
      tuiLogger.error("[SessionsDialog] Failed to select session", {
        message: result.message,
      });
      setError(result.message || "Failed to switch session");
    }
  };

  const initiateDelete = () => {
    const list = filteredSessions();
    const selected = list[selectedIndex()];
    if (!selected) return;

    tuiLogger.info("[SessionsDialog] Initiating delete", {
      sessionId: selected.id,
    });

    setDeleteTarget(selected);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    const target = deleteTarget();
    if (!target) return;

    tuiLogger.info("[SessionsDialog] Confirming delete", {
      sessionId: target.id,
    });

    const result = await command.executeCommand(
      "sessions",
      JSON.stringify({
        type: "delete",
        sessionId: target.id,
      })
    );

    if (result.success) {
      tuiLogger.info("[SessionsDialog] Session deleted successfully");
      // Refresh the list by reloading
      const listResult = await command.executeCommand("sessions", JSON.stringify({ type: "list" }));
      if (listResult.success && listResult.data) {
        // We can't directly update props, so we'll close and reopen
        dialog.pop();
        dialog.push(
          () => <SessionsDialog data={(listResult.data as any)} />,
          { title: "Sessions" }
        );
      } else {
        setShowDeleteConfirm(false);
        setDeleteTarget(null);
      }
    } else {
      tuiLogger.error("[SessionsDialog] Failed to delete session", {
        message: result.message,
      });
      setError(result.message || "Failed to delete session");
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    }
  };

  const cancelDelete = () => {
    tuiLogger.info("[SessionsDialog] Cancelled delete");
    setShowDeleteConfirm(false);
    setDeleteTarget(null);
  };

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      {/* Search box */}
      <box flexDirection="row" height={1} marginBottom={1}>
        <text fg={theme.theme().primary}>&gt; </text>
        <input
          ref={(ref: any) => {
            inputRef = ref;
          }}
          flexGrow={1}
          value={filter()}
          onContentChange={(event: any) => {
            const value = inputRef?.plainText || inputRef?.value || "";
            tuiLogger.info("[SessionsDialog] Filter changed", { value });
            setFilter(value);
            setSelectedIndex(0);
          }}
          placeholder="Filter sessions..."
          focused={true}
          onKeyDown={(e: any) => {
            if (handleListKeyDown(e.name || e.key)) {
              e.preventDefault();
            }
          }}
        />
      </box>

      {/* Error message */}
      <Show when={error()}>
        <box height={1} marginBottom={1}>
          <text fg={theme.theme().error}>{error()}</text>
        </box>
      </Show>

      {/* Delete confirmation */}
      <Show when={showDeleteConfirm()}>
        <box
          flexDirection="column"
          padding={1}
          borderStyle="single"
          borderColor={theme.theme().error}
          marginBottom={1}
        >
          <text fg={theme.theme().error}>
            Delete session "{deleteTarget()?.title}"?
          </text>
          <text fg={theme.theme().muted} marginTop={1}>
            Press Y to confirm, N to cancel
          </text>
        </box>
      </Show>

      <box height={1} borderStyle="single" borderColor={theme.theme().border} />

      {/* Session list */}
      <box flexGrow={1} flexDirection="column" overflow="scroll" marginTop={1}>
        <Show
          when={filteredSessions().length > 0}
          fallback={
            <text fg={theme.theme().muted}>
              No sessions found
              {filter() ? ` (filter: "${filter()}")` : ""}
            </text>
          }
        >
          <For each={filteredSessions()}>
            {(session, index) => {
              const isSelected = () => index() === selectedIndex();

              return (
                <box
                  flexDirection="column"
                  paddingLeft={2}
                  paddingRight={1}
                  paddingY={1}
                  backgroundColor={isSelected() ? theme.theme().primary : undefined}
                >
                  {/* Title and message count */}
                  <box flexDirection="row" alignItems="center" height={1}>
                    <text
                      fg={
                        isSelected()
                          ? theme.theme().background
                          : theme.theme().foreground
                      }
                    >
                      {session.title}
                    </text>
                    <box flexGrow={1} />
                    <text
                      fg={
                        isSelected()
                          ? theme.theme().background
                          : theme.theme().muted
                      }
                    >
                      {session.messageCount} msgs
                    </text>
                  </box>

                  {/* Directory and time */}
                  <box flexDirection="row" alignItems="center" height={1} marginTop={0}>
                    <text
                      fg={
                        isSelected()
                          ? theme.theme().background
                          : theme.theme().muted
                      }
                    >
                      {session.directory}
                    </text>
                    <box flexGrow={1} />
                    <text
                      fg={
                        isSelected()
                          ? theme.theme().background
                          : theme.theme().muted
                      }
                    >
                      {formatRelativeTime(session.updatedAt)}
                    </text>
                  </box>
                </box>
              );
            }}
          </For>
        </Show>
      </box>

      {/* Footer */}
      <box flexDirection="row" height={1} marginTop={1}>
        <text fg={theme.theme().muted}>
          ↑↓ navigate • Enter select • D delete • Esc close •{" "}
          {filteredSessions().length} sessions
        </text>
      </box>
    </box>
  );
}
