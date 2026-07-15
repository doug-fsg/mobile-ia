"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { StoredSession, ProjectInfo } from "@/lib/types";
import { useHaptics } from "@/hooks/use-haptics";
import { apiFetch } from "@/lib/api-fetch";
import { timeAgo } from "@/lib/format";
import { RefreshIcon, CloseIcon, PlusIcon, Spinner, TrashIcon, ChevronDown } from "./icons";

interface SessionSidebarProps {
  open: boolean;
  onClose: () => void;
  currentSessionId: string | null;
  onSelectSession: (id: string, workspace?: string) => void;
  onNewSession: (workspace?: string) => void;
  onWorkspaceChange?: (workspace: string | null) => void;
  activeStatuses?: Record<string, "streaming" | "idle">;
  workspaceTerminals?: Record<string, number>;
}

function StatusIndicator({ status }: { status: "streaming" | "idle" }) {
  if (status === "streaming") {
    return (
      <span className="shrink-0 w-2 h-2 rounded-full border-[1.5px] border-success border-t-transparent animate-spin" />
    );
  }
  return <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-text-muted/40" />;
}

function ArchiveIcon({ size = 12, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

function UnarchiveIcon({ size = 12, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <polyline points="12 15 12 10" />
      <polyline points="9 12 12 9 15 12" />
    </svg>
  );
}

const PROJECT_STORAGE_KEY = "clr-selected-project";
const STARRED_STORAGE_KEY = "clr-starred-projects"; // localStorage fallback key

function StarIcon({ size = 12, filled = false, className = "" }: { size?: number; filled?: boolean; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function loadStarredLocal(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STARRED_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveStarred(paths: string[]) {
  localStorage.setItem(STARRED_STORAGE_KEY, JSON.stringify(paths));
  apiFetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ starred_projects: JSON.stringify(paths) }),
  }).catch(() => {});
}

function SessionTooltip({ session, children }: { session: StoredSession; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleEnter = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPos({ x: rect.left + rect.width / 2, y: rect.top });
    setVisible(true);
  };

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={handleEnter}
      onMouseLeave={() => setVisible(false)}
      className="relative"
    >
      {children}
      {visible && (
        <div
          className="fixed z-[100] pointer-events-none"
          style={{ left: pos.x, top: pos.y }}
        >
          <div className="relative -translate-x-1/2 -translate-y-full -mt-1.5 max-w-[240px] px-2.5 py-1.5 rounded-md bg-bg-elevated border border-border shadow-lg">
            <p className="text-[11px] text-text leading-snug break-words">{session.title}</p>
            {session.preview && session.preview !== session.title && (
              <p className="text-[10px] text-text-muted mt-0.5 leading-snug break-words line-clamp-3">{session.preview}</p>
            )}
            <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-x-[5px] border-x-transparent border-t-[5px] border-t-border" />
          </div>
        </div>
      )}
    </div>
  );
}

export function SessionSidebar({
  open,
  onClose,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onWorkspaceChange,
  activeStatuses = {},
  workspaceTerminals = {},
}: SessionSidebarProps) {
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [starred, setStarred] = useState<string[]>([]);
  const haptics = useHaptics();

  useEffect(() => {
    const stored = localStorage.getItem(PROJECT_STORAGE_KEY);
    const localStars = loadStarredLocal();
    setSelectedProject(stored); // eslint-disable-line react-hooks/set-state-in-effect
    setStarred(localStars); // eslint-disable-line react-hooks/set-state-in-effect

    apiFetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        const serverStars = data.settings?.starred_projects;
        if (serverStars) {
          try {
            const parsed: string[] = JSON.parse(serverStars);
            if (parsed.length > 0 || localStars.length === 0) {
              setStarred(parsed);
              localStorage.setItem(STARRED_STORAGE_KEY, serverStars);
            }
          } catch { /* ignore bad json */ }
        } else if (localStars.length > 0) {
          saveStarred(localStars);
        }
      })
      .catch(() => {});
  }, []);

  const toggleStar = useCallback((e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    setStarred((prev) => {
      const next = prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path];
      saveStarred(next);
      return next;
    });
  }, []);

  const fetchProjects = useCallback(() => {
    apiFetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        setProjects(data.projects || []);
        if (!selectedProject && data.currentWorkspace) {
          setSelectedProject(data.currentWorkspace);
          localStorage.setItem(PROJECT_STORAGE_KEY, data.currentWorkspace);
        }
      })
      .catch(() => {});
  }, [selectedProject]);

  const fetchSessions = useCallback(() => {
    setFetchError(null);
    const params = new URLSearchParams();
    if (selectedProject === "__all__") {
      params.set("all", "true");
    } else if (selectedProject) {
      params.set("workspace", selectedProject);
    }
    if (showArchived) {
      params.set("archived", "true");
    }
    const qs = params.toString();
    return apiFetch("/api/sessions" + (qs ? "?" + qs : ""))
      .then((r) => r.json())
      .then((data) => setSessions(data.sessions || []))
      .catch(() => setFetchError("Falha ao carregar sessões"));
  }, [selectedProject, showArchived]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- loading state for fetch
    setConfirmingDelete(null);
    fetchProjects();
    fetchSessions().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, fetchSessions, fetchProjects]);

  const handleProjectSelect = useCallback((path: string) => {
    setSelectedProject(path);
    localStorage.setItem(PROJECT_STORAGE_KEY, path);
    setProjectDropdownOpen(false);
    if (path !== "__all__") {
      onWorkspaceChange?.(path);
    }
  }, [onWorkspaceChange]);

  const handleDeleteClick = (e: React.MouseEvent, session: StoredSession) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirmingDelete === session.id) {
      haptics.error();
      // Optimistic remove — Cursor transcripts rematerialize the row unless
      // the server keeps a tombstone (now handled in DELETE).
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      setConfirmingDelete(null);
      apiFetch("/api/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, workspace: session.workspace }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error("delete failed");
          await fetchSessions();
        })
        .catch(() => {
          setFetchError("Falha ao excluir sessão");
          void fetchSessions();
        });
    } else {
      haptics.warn();
      setConfirmingDelete(session.id);
    }
  };

  const handleArchiveClick = (e: React.MouseEvent, session: StoredSession) => {
    e.stopPropagation();
    haptics.tap();
    apiFetch("/api/sessions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: showArchived ? "unarchive" : "archive", sessionId: session.id, workspace: session.workspace }),
    })
      .then(() => fetchSessions())
      .catch(() => setFetchError("Falha ao atualizar sessão"));
  };

  const handleArchiveAll = () => {
    haptics.warn();
    const workspace = selectedProject === "__all__" ? undefined : selectedProject || undefined;
    apiFetch("/api/sessions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive_all", workspace }),
    })
      .then(() => fetchSessions())
      .catch(() => setFetchError("Falha ao arquivar sessões"));
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmingDelete(null);
  };

  const currentProjectName = selectedProject === "__all__"
    ? "Todos os projetos"
    : projects.find((p) => p.path === selectedProject)?.name
      || selectedProject?.split("/").pop()
      || "Projeto atual";

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/60" aria-hidden="true" onClick={onClose} />}
      <div
        role="dialog"
        aria-label="Histórico de sessões"
        aria-hidden={!open}
        className={`fixed inset-0 z-50 bg-bg-elevated transform transition-transform duration-150 flex flex-col sm:inset-auto sm:top-0 sm:left-0 sm:h-full sm:w-[300px] sm:border-r sm:border-border ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between h-12 px-3 border-b border-border shrink-0">
          <div className="flex flex-col min-w-0">
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-text-muted">
              Workspace
            </span>
            <span className="text-[13px] font-medium text-text truncate leading-tight">
              Sessões
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => {
                haptics.tap();
                setLoading(true);
                fetchSessions().finally(() => setLoading(false));
              }}
              disabled={loading}
              aria-label="Atualizar sessões"
              className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-secondary transition-colors disabled:opacity-40"
            >
              <RefreshIcon size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={onClose}
              aria-label="Fechar barra lateral"
              className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-secondary transition-colors"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        </div>

        <div className="px-2.5 pt-2.5 pb-2 space-y-2 shrink-0 border-b border-border/60">
          <button
            onClick={() => {
              const ws = selectedProject && selectedProject !== "__all__" ? selectedProject : undefined;
              onNewSession(ws);
              onClose();
            }}
            className="w-full flex items-center justify-center gap-2 px-2.5 py-2 rounded-md text-[12px] font-medium text-text bg-bg-surface border border-border hover:bg-bg-hover hover:border-text-muted/30 transition-colors"
          >
            <PlusIcon />
            Nova sessão
          </button>

          {starred.length > 0 && (
            <div className="space-y-px">
              <p className="px-1 text-[10px] uppercase tracking-[0.12em] text-text-muted mb-0.5">
                Favoritos
              </p>
              {starred.map((path) => {
                const proj = projects.find((p) => p.path === path);
                const name = proj?.name || path.split("/").pop() || path;
                const isActive = selectedProject === path;
                const termCount = workspaceTerminals[path] || 0;
                return (
                  <button
                    key={path}
                    onClick={() => handleProjectSelect(path)}
                    className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] transition-colors ${
                      isActive
                        ? "bg-bg-active text-text shadow-[inset_2px_0_0_0_var(--color-accent-rail)]"
                        : "text-text-muted hover:text-text-secondary hover:bg-bg-hover"
                    }`}
                  >
                    <StarIcon size={10} filled className="shrink-0 text-accent-rail" />
                    <span className="truncate">{name}</span>
                    {termCount > 0 && (
                      <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-success" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="relative">
            <button
              onClick={() => {
                haptics.tap();
                setProjectDropdownOpen((v) => !v);
              }}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-[12px] text-text-muted hover:text-text-secondary hover:bg-bg-hover border border-transparent hover:border-border transition-colors"
            >
              <span className="truncate">{currentProjectName}</span>
              <ChevronDown />
            </button>
            {projectDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setProjectDropdownOpen(false)} />
                <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-bg-elevated border border-border rounded-lg shadow-xl py-1 max-h-60 overflow-y-auto">
                  <button
                    onClick={() => handleProjectSelect("__all__")}
                    className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors ${
                      selectedProject === "__all__"
                        ? "text-text bg-bg-active"
                        : "text-text-secondary hover:bg-bg-hover hover:text-text"
                    }`}
                  >
                    Todos os projetos
                  </button>
                  <div className="h-px bg-border mx-2 my-1" />
                  {projects.map((p) => {
                    const termCount = workspaceTerminals[p.path] || 0;
                    return (
                      <button
                        key={p.key}
                        onClick={() => handleProjectSelect(p.path)}
                        className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors flex items-center gap-2 ${
                          selectedProject === p.path
                            ? "text-text bg-bg-active"
                            : "text-text-secondary hover:bg-bg-hover hover:text-text"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate">{p.name}</span>
                            {termCount > 0 && (
                              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-success" />
                            )}
                          </div>
                          <span className="block text-[10px] text-text-muted font-mono truncate">{p.path}</span>
                        </div>
                        <span
                          onClick={(e) => toggleStar(e, p.path)}
                          className={`shrink-0 p-0.5 rounded hover:bg-bg-active transition-colors ${
                            starred.includes(p.path) ? "text-accent-rail" : "text-text-muted/30 hover:text-text-muted"
                          }`}
                          role="button"
                          aria-label={starred.includes(p.path) ? "Remover dos favoritos" : "Favoritar projeto"}
                        >
                          <StarIcon size={12} filled={starred.includes(p.path)} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-1 p-0.5 rounded-md bg-bg-surface border border-border">
            <button
              onClick={() => {
                if (showArchived) {
                  haptics.tap();
                  setShowArchived(false);
                }
              }}
              aria-pressed={!showArchived}
              className={`flex-1 px-2 py-1.5 rounded text-[11px] font-medium transition-colors ${
                !showArchived
                  ? "bg-bg-active text-text"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              Ativas
            </button>
            <button
              onClick={() => {
                if (!showArchived) {
                  haptics.tap();
                  setShowArchived(true);
                }
              }}
              aria-pressed={showArchived}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] font-medium transition-colors ${
                showArchived
                  ? "bg-bg-active text-text"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              <ArchiveIcon size={11} />
              Arquivadas
            </button>
          </div>

          {!showArchived && sessions.length > 0 && (
            <button
              onClick={handleArchiveAll}
              title="Arquivar todas as sessões visíveis"
              className="w-full px-2 py-1 rounded-md text-[10px] text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors"
            >
              Arquivar todas visíveis
            </button>
          )}
        </div>

        <div className="overflow-y-auto flex-1 px-2 py-2">
          {fetchError && (
            <div className="mx-1 mb-2 px-2.5 py-2 rounded-md bg-error/10 text-error text-[11px]">
              {fetchError}
            </div>
          )}
          {loading ? (
            <div className="flex items-center gap-2 justify-center py-8 text-text-muted text-[12px]">
              <Spinner />
            </div>
          ) : sessions.length === 0 && !fetchError ? (
            <p className="text-text-muted text-[12px] text-center py-8">
              {showArchived ? "Nenhuma sessão arquivada" : "Nenhuma sessão"}
            </p>
          ) : (
            sessions.map((s) => {
              const status = activeStatuses[s.id];
              const isCurrent = s.id === currentSessionId;
              const isConfirming = confirmingDelete === s.id;
              return (
                <SessionTooltip key={s.id} session={s}>
                  <div
                    className={`group relative mb-1 rounded-md border transition-colors ${
                      isCurrent
                        ? "bg-bg-active border-border shadow-[inset_2px_0_0_0_var(--color-accent-rail)]"
                        : "border-transparent hover:bg-bg-hover hover:border-border/80"
                    }`}
                  >
                    <button
                      onClick={() => {
                        haptics.select();
                        onSelectSession(s.id, s.workspace);
                        onClose();
                      }}
                      aria-current={isCurrent ? "true" : undefined}
                      className={`w-full text-left px-2.5 py-2 pr-16 transition-colors ${
                        isCurrent ? "text-text" : "text-text-secondary"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          {status && <StatusIndicator status={status} />}
                          <p className="text-[12px] font-medium truncate leading-snug">{s.title}</p>
                        </div>
                        <span className="text-[10px] text-text-muted shrink-0 tabular-nums">
                          {timeAgo(s.updatedAt)}
                        </span>
                      </div>
                      {selectedProject === "__all__" && (
                        <p className="text-[10px] text-text-muted mt-0.5 font-mono truncate">
                          {s.workspace.split("/").pop()}
                        </p>
                      )}
                    </button>

                    {isConfirming ? (
                      <div className="absolute top-1/2 -translate-y-1/2 right-1 flex items-center gap-1 bg-bg-elevated/95 rounded-md p-0.5 border border-border shadow-sm z-10">
                        <button
                          type="button"
                          onClick={(e) => handleDeleteClick(e, s)}
                          className="px-2 py-1 rounded text-[10px] font-medium bg-error/15 text-error hover:bg-error/25 transition-colors"
                        >
                          Confirmar
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelDelete}
                          aria-label="Cancelar exclusão"
                          className="p-1 rounded text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors"
                        >
                          <CloseIcon size={10} />
                        </button>
                      </div>
                    ) : (
                      <div
                        className={`absolute top-1/2 -translate-y-1/2 right-1 flex items-center gap-0.5 rounded-md bg-bg-elevated/90 border border-border/80 p-0.5 z-10 transition-opacity ${
                          isCurrent
                            ? "opacity-100"
                            : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={(e) => handleArchiveClick(e, s)}
                          aria-label={showArchived ? "Desarquivar sessão" : "Arquivar sessão"}
                          title={showArchived ? "Desarquivar" : "Arquivar"}
                          className="p-1.5 rounded hover:bg-bg-surface text-text-muted hover:text-text-secondary transition-colors"
                        >
                          {showArchived ? <UnarchiveIcon /> : <ArchiveIcon />}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteClick(e, s)}
                          aria-label="Excluir sessão"
                          title="Excluir"
                          className="p-1.5 rounded hover:bg-bg-surface text-text-muted hover:text-error transition-colors"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    )}
                  </div>
                </SessionTooltip>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
