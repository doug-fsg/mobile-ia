"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useHaptics } from "@/hooks/use-haptics";
import { fetchActiveSessions } from "@/hooks/use-chat";
import { apiFetch } from "@/lib/api-fetch";
import { applyTheme, normalizeTheme } from "@/lib/theme";
import { vlog } from "@/lib/verbose";
import { ChatContainer } from "./chat-container";
import { SessionSidebar } from "./session-sidebar";
import { SettingsPanel } from "./settings-panel";
import { QrModal } from "./qr-modal";
import { ErrorBoundary } from "./error-boundary";
import { uuid } from "@/lib/uuid";

interface ChatInstance {
  id: string;
  sessionId: string | null;
  label: string;
  isStreaming: boolean;
  initialSessionId?: string;
  initialWorkspace?: string;
}

function makeInstance(initialSessionId?: string, initialWorkspace?: string): ChatInstance {
  return {
    id: uuid(),
    sessionId: null,
    label: initialSessionId ? "Carregando..." : "Novo chat",
    isStreaming: false,
    initialSessionId,
    initialWorkspace,
  };
}

function getHashParams(): { sessionId: string | null; workspace: string | null } {
  if (typeof window === "undefined") return { sessionId: null, workspace: null };
  const hash = window.location.hash;
  const sessionMatch = hash.match(/session=([a-f0-9-]+)/i);
  const workspaceMatch = hash.match(/workspace=([^&]+)/);
  return {
    sessionId: sessionMatch?.[1] ?? null,
    workspace: workspaceMatch ? decodeURIComponent(workspaceMatch[1]) : null,
  };
}

export function ChatWorkspace() {
  const [instances, setInstances] = useState<ChatInstance[]>(() => {
    const { sessionId: hashSession, workspace: hashWorkspace } = getHashParams();
    return [makeInstance(hashSession ?? undefined, hashWorkspace ?? undefined)];
  });
  const [activeId, setActiveId] = useState<string>(() => instances[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [defaultModel, setDefaultModel] = useState<string>("auto");
  const haptics = useHaptics();
  const restoredRef = useRef(false);
  const settingsLoadedRef = useRef(false);

  useEffect(() => {
    if (window.location.hash.includes("session=")) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    if (settingsLoadedRef.current) return;
    settingsLoadedRef.current = true;
    apiFetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.settings?.default_model) setDefaultModel(data.settings.default_model);
        if (data.settings?.theme) applyTheme(normalizeTheme(data.settings.theme));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    fetchActiveSessions().then((activeIds) => {
      if (activeIds.length === 0) return;

      setInstances((prev) => {
        const newInstances = [...prev];
        let focusId: string | null = null;

        for (let i = 0; i < activeIds.length; i++) {
          const sessionId = activeIds[i];
          if (newInstances.some((inst) => inst.initialSessionId === sessionId || inst.sessionId === sessionId)) {
            continue;
          }

          const inst = makeInstance(sessionId);

          if (i === 0 && newInstances.length === 1 && !newInstances[0].sessionId && !newInstances[0].isStreaming) {
            newInstances[0] = inst;
            focusId = inst.id;
          } else {
            newInstances.push(inst);
            if (!focusId) focusId = inst.id;
          }
        }

        if (focusId) {
          const id = focusId;
          setTimeout(() => setActiveId(id), 0);
        }
        return newInstances;
      });
    });
  }, []);

  const activeStatuses = useMemo(() => {
    const map: Record<string, "streaming" | "idle"> = {};
    for (const inst of instances) {
      if (inst.sessionId) {
        map[inst.sessionId] = inst.isStreaming ? "streaming" : "idle";
      }
    }
    return map;
  }, [instances]);

  const handleNewSession = useCallback((workspace?: string) => {
    haptics.tap();
    const current = instances.find((i) => i.id === activeId);
    if (current && !current.sessionId && !current.isStreaming) {
      if (workspace && current.initialWorkspace !== workspace) {
        const inst = makeInstance(undefined, workspace);
        setInstances((prev) => prev.map((i) => (i.id === activeId ? inst : i)));
        setActiveId(inst.id);
      }
      return;
    }
    const inst = makeInstance(undefined, workspace);
    setInstances((prev) => [...prev, inst]);
    setActiveId(inst.id);
  }, [haptics, instances, activeId]);

  const handleSelectSession = useCallback(
    (sessionId: string, workspace?: string) => {
      vlog("workspace", "handleSelectSession", { sessionId, workspace, activeId, instanceCount: instances.length });

      const existing = instances.find((i) => i.sessionId === sessionId);
      if (existing) {
        vlog("workspace", "handleSelectSession: found existing instance", { instanceId: existing.id, sessionId });
        setActiveId(existing.id);
        return;
      }

      const inst = makeInstance(sessionId, workspace);
      const current = instances.find((i) => i.id === activeId);

      if (current && !current.sessionId && !current.isStreaming) {
        vlog("workspace", "handleSelectSession: replacing empty instance", { replacedId: current.id, newId: inst.id, sessionId });
        setInstances((prev) => prev.map((i) => (i.id === activeId ? inst : i)));
      } else {
        vlog("workspace", "handleSelectSession: adding new instance", { newId: inst.id, sessionId, currentHasSession: !!current?.sessionId, currentStreaming: current?.isStreaming });
        setInstances((prev) => [...prev, inst]);
      }
      setActiveId(inst.id);
    },
    [instances, activeId],
  );

  const updateLabel = useCallback((instanceId: string, label: string) => {
    setInstances((prev) => {
      const target = prev.find((i) => i.id === instanceId);
      if (!target || target.label === label) return prev;
      return prev.map((i) => (i.id === instanceId ? { ...i, label } : i));
    });
  }, []);

  const updateStreaming = useCallback((instanceId: string, streaming: boolean) => {
    setInstances((prev) => {
      const target = prev.find((i) => i.id === instanceId);
      if (!target || target.isStreaming === streaming) return prev;
      return prev.map((i) => (i.id === instanceId ? { ...i, isStreaming: streaming } : i));
    });
  }, []);

  const updateSessionId = useCallback((instanceId: string, sessionId: string | null) => {
    setInstances((prev) => {
      const target = prev.find((i) => i.id === instanceId);
      if (!target || target.sessionId === sessionId) return prev;
      return prev.map((i) => (i.id === instanceId ? { ...i, sessionId } : i));
    });
  }, []);

  const handleWorkspaceChange = useCallback((workspace: string | null) => {
    const ws = workspace ?? undefined;
    setInstances((prev) => {
      const current = prev.find((i) => i.id === activeId);
      if (!current || current.sessionId || current.isStreaming) return prev;
      if (current.initialWorkspace === ws) return prev;
      return prev.map((i) => (i.id === activeId ? { ...i, initialWorkspace: ws } : i));
    });
  }, [activeId]);

  const [workspaceTerminals, setWorkspaceTerminals] = useState<Record<string, number>>({});

  useEffect(() => {
    const fetchCounts = () => {
      apiFetch("/api/terminal")
        .then((r) => r.json())
        .then((data) => {
          const all: { cwd: string; running: boolean }[] = data.terminals || [];
          const counts: Record<string, number> = {};
          for (const t of all) {
            if (t.running) counts[t.cwd] = (counts[t.cwd] || 0) + 1;
          }
          setWorkspaceTerminals(counts);
        })
        .catch(() => {});
    };
    fetchCounts();
    const id = setInterval(fetchCounts, 10_000);
    return () => clearInterval(id);
  }, []);

  const currentSessionId = instances.find((i) => i.id === activeId)?.sessionId ?? null;

  return (
    <div className="h-dvh">
      {instances.map((inst) => (
        <div key={inst.id} className={inst.id === activeId ? "h-full" : "hidden"}>
          <ErrorBoundary fallback="inline">
            <ChatContainer
              initialSessionId={inst.initialSessionId}
              initialWorkspace={inst.initialWorkspace}
              defaultModel={defaultModel}
              tabActive={inst.id === activeId}
              onLabelChange={(label) => updateLabel(inst.id, label)}
              onStreamingChange={(s) => updateStreaming(inst.id, s)}
              onSessionIdChange={(sid) => updateSessionId(inst.id, sid)}
              onSelectSession={handleSelectSession}
              onOpenSidebar={() => setSidebarOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenQr={() => setQrOpen(true)}
            />
          </ErrorBoundary>
        </div>
      ))}

      <SessionSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onWorkspaceChange={handleWorkspaceChange}
        activeStatuses={activeStatuses}
        workspaceTerminals={workspaceTerminals}
      />

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} onDefaultModelChange={setDefaultModel} />

      <QrModal open={qrOpen} onClose={() => setQrOpen(false)} />
    </div>
  );
}
