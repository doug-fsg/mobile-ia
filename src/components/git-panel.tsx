"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { useHaptics } from "@/hooks/use-haptics";
import { CloseIcon, RefreshIcon, Spinner, CheckIcon, ChevronDown } from "./icons";

interface FileStatus {
  file: string;
  status: string;
  staged: boolean;
}

interface GitStatus {
  branch: string | null;
  files: FileStatus[];
  ahead: number;
  behind: number;
}

interface BranchInfo {
  current: string;
  local: string[];
  remoteOnly: string[];
}

interface GitPanelProps {
  open: boolean;
  onClose: () => void;
  workspace?: string;
}

function statusColor(status: string): string {
  switch (status) {
    case "added":
    case "untracked":
      return "text-success";
    case "deleted":
      return "text-error";
    case "modified":
      return "text-warning";
    case "renamed":
    case "copied":
      return "text-info";
    default:
      return "text-text-muted";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "added": return "A";
    case "untracked": return "U";
    case "deleted": return "D";
    case "modified": return "M";
    case "renamed": return "R";
    case "copied": return "C";
    default: return "?";
  }
}

function DiffView({ diff }: { diff: string }) {
  if (!diff) {
    return <p className="text-text-muted text-[11px] px-3 py-2">Diff indisponível</p>;
  }
  const lines = diff.split("\n");
  return (
    <div className="overflow-x-auto text-[11px] font-mono leading-[1.6]">
      {lines.map((line, i) => {
        let cls = "text-text-muted px-3";
        if (line.startsWith("+") && !line.startsWith("+++")) {
          cls = "text-success bg-success/8 px-3";
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          cls = "text-error bg-error/8 px-3";
        } else if (line.startsWith("@@")) {
          cls = "text-info bg-info/8 px-3";
        } else if (line.startsWith("diff ") || line.startsWith("index ")) {
          cls = "text-text-muted/50 px-3";
        }
        return (
          <div key={i} className={cls}>
            <span className="whitespace-pre">{line}</span>
          </div>
        );
      })}
    </div>
  );
}

function gitAction(action: string, workspace?: string, extra?: Record<string, unknown>) {
  return apiFetch("/api/git", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, workspace, ...extra }),
  });
}

export function GitPanel({ open, onClose, workspace }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [pushed, setPushed] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [pulled, setPulled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [fileDiffs, setFileDiffs] = useState<Record<string, string>>({});
  const [loadingDiff, setLoadingDiff] = useState<string | null>(null);
  const [discardingSelected, setDiscardingSelected] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [branches, setBranches] = useState<BranchInfo | null>(null);
  const [switchingBranch, setSwitchingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);
  const haptics = useHaptics();

  const wsParam = workspace ? `&workspace=${encodeURIComponent(workspace)}` : "";

  const fetchStatus = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch(`/api/git?detail=status${wsParam}`)
      .then((r) => r.json())
      .then((data) => {
        setStatus(data);
        const files = (data.files as FileStatus[]) ?? [];
        setSelected(new Set(files.map((f) => f.file)));
      })
      .catch(() => setError("Falha ao carregar status do git"))
      .finally(() => setLoading(false));
  }, [wsParam]);

  const fetchBranches = useCallback(() => {
    apiFetch(`/api/git?detail=branches${wsParam}`)
      .then((r) => r.json())
      .then((data) => setBranches(data))
      .catch(() => {});
  }, [wsParam]);

  useEffect(() => {
    if (!open) return;
    setCommitted(false);
    setPushed(false);
    setError(null);
    setExpandedFile(null);
    setFileDiffs({});
    setConfirmDiscard(false);
    setBranchDropdownOpen(false);
    setNewBranchName("");
    fetchStatus();
  }, [open, fetchStatus]);

  const toggleFile = useCallback(
    (file: string) => {
      if (expandedFile === file) {
        setExpandedFile(null);
        return;
      }
      setExpandedFile(file);
      if (fileDiffs[file] !== undefined) return;
      setLoadingDiff(file);
      apiFetch(`/api/git?detail=diff&file=${encodeURIComponent(file)}${wsParam}`)
        .then((r) => r.json())
        .then((data) => setFileDiffs((prev) => ({ ...prev, [file]: data.diff || "" })))
        .catch(() => setFileDiffs((prev) => ({ ...prev, [file]: "Falha ao carregar diff" })))
        .finally(() => setLoadingDiff(null));
    },
    [expandedFile, fileDiffs, wsParam],
  );

  const toggleSelected = useCallback((file: string, e: React.MouseEvent) => {
    e.stopPropagation();
    haptics.select();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    haptics.tap();
    const allFiles = status?.files ?? [];
    if (selected.size === allFiles.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allFiles.map((f) => f.file)));
    }
  }, [status, selected]);

  const handleDiscardSelected = useCallback(async () => {
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    setConfirmDiscard(false);
    setDiscardingSelected(true);
    setError(null);
    try {
      const res = await gitAction("discard", workspace, { files: Array.from(selected) });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Descarte falhou");
      }
      setFileDiffs({});
      setExpandedFile(null);
      haptics.warn();
      fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Descarte falhou");
      haptics.error();
    } finally {
      setDiscardingSelected(false);
    }
  }, [confirmDiscard, workspace, selected, fetchStatus, haptics]);

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim() || selected.size === 0) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await gitAction("commit", workspace, {
        message: commitMsg,
        files: Array.from(selected),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Commit falhou");
      }
      setCommitMsg("");
      setCommitted(true);
      setTimeout(() => setCommitted(false), 2000);
      setFileDiffs({});
      setExpandedFile(null);
      haptics.send();
      fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Commit falhou");
      haptics.error();
    } finally {
      setCommitting(false);
    }
  }, [commitMsg, workspace, fetchStatus, selected, haptics]);

  const handlePush = useCallback(async () => {
    setPushing(true);
    setError(null);
    try {
      const res = await gitAction("push", workspace);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Push falhou");
      }
      setPushed(true);
      setTimeout(() => setPushed(false), 2000);
      haptics.send();
      fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push falhou");
      haptics.error();
    } finally {
      setPushing(false);
    }
  }, [workspace, fetchStatus, haptics]);

  const handleFetch = useCallback(async () => {
    setFetching(true);
    setError(null);
    try {
      const res = await gitAction("fetch", workspace);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fetch falhou");
      }
      setFetched(true);
      setTimeout(() => setFetched(false), 2000);
      haptics.tap();
      fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fetch falhou");
      haptics.error();
    } finally {
      setFetching(false);
    }
  }, [workspace, fetchStatus, haptics]);

  const handlePull = useCallback(async () => {
    setPulling(true);
    setError(null);
    try {
      const res = await gitAction("pull", workspace);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Pull falhou");
      }
      setPulled(true);
      setTimeout(() => setPulled(false), 2000);
      setFileDiffs({});
      setExpandedFile(null);
      haptics.tap();
      fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pull falhou");
      haptics.error();
    } finally {
      setPulling(false);
    }
  }, [workspace, fetchStatus, haptics]);

  const handleCheckout = useCallback(async (branch: string) => {
    setSwitchingBranch(true);
    setError(null);
    try {
      const res = await gitAction("checkout", workspace, { branch });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Checkout falhou");
      }
      setBranchDropdownOpen(false);
      setFileDiffs({});
      setExpandedFile(null);
      haptics.tap();
      fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout falhou");
      haptics.error();
    } finally {
      setSwitchingBranch(false);
    }
  }, [workspace, fetchStatus, haptics]);

  const handleCreateBranch = useCallback(async () => {
    const name = newBranchName.trim();
    if (!name) return;
    setCreatingBranch(true);
    setError(null);
    try {
      const res = await gitAction("create_branch", workspace, { branch: name });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Falha ao criar branch");
      }
      setNewBranchName("");
      setBranchDropdownOpen(false);
      haptics.send();
      fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar branch");
      haptics.error();
    } finally {
      setCreatingBranch(false);
    }
  }, [newBranchName, workspace, fetchStatus, haptics]);

  if (!open) return null;

  const allFiles = status?.files ?? [];
  const hasChanges = allFiles.length > 0;
  const selectedCount = selected.size;
  const allSelected = hasChanges && selectedCount === allFiles.length;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" aria-hidden="true" onClick={onClose} />
      <div className="fixed inset-0 z-50 bg-bg-elevated flex flex-col sm:inset-auto sm:top-0 sm:right-0 sm:h-full sm:w-[380px] sm:border-l sm:border-border">
        {/* Header */}
        <div className="flex items-center justify-between h-11 px-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-medium text-text-secondary shrink-0">Git</span>
            {status?.branch && (
              <button
                onClick={() => {
                  setBranchDropdownOpen((v) => !v);
                  if (!branches) fetchBranches();
                }}
                className="flex items-center gap-1 text-[11px] text-text-muted font-mono hover:text-text-secondary transition-colors min-w-0"
              >
                <span className="truncate max-w-[120px]">{status.branch}</span>
                <ChevronDown size={8} />
              </button>
            )}
            {status && status.ahead > 0 && (
              <span className="text-[10px] text-info shrink-0">↑{status.ahead}</span>
            )}
            {status && status.behind > 0 && (
              <span className="text-[10px] text-warning shrink-0">↓{status.behind}</span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => {
                fetchStatus();
                setFileDiffs({});
              }}
              disabled={loading}
              aria-label="Atualizar"
              className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-secondary transition-colors disabled:opacity-40"
            >
              <RefreshIcon size={13} className={loading ? "animate-spin" : ""} />
            </button>
            <button onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-secondary transition-colors">
              <CloseIcon size={13} />
            </button>
          </div>
        </div>

        {/* Branch dropdown */}
        {branchDropdownOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setBranchDropdownOpen(false)} />
            <div className="relative z-50 mx-3 mt-2 bg-bg-elevated border border-border rounded-lg shadow-xl max-h-[280px] flex flex-col">
              {switchingBranch && (
                <div className="flex items-center justify-center py-4">
                  <Spinner />
                </div>
              )}
              {!switchingBranch && (
                <>
                  <div className="p-2 border-b border-border flex gap-1.5">
                    <input
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                      placeholder="Nome da nova branch..."
                      className="flex-1 min-w-0 rounded border border-border bg-bg-surface px-2 py-1 text-[11px] text-text placeholder:text-text-muted/50 focus:outline-none focus:border-text-muted/40"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleCreateBranch();
                        }
                      }}
                    />
                    <button
                      onClick={handleCreateBranch}
                      disabled={!newBranchName.trim() || creatingBranch}
                      className="shrink-0 px-2 py-1 rounded text-[10px] font-medium bg-bg-surface border border-border text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-40"
                    >
                      {creatingBranch ? <Spinner className="w-2.5 h-2.5" /> : "Criar"}
                    </button>
                  </div>
                  <div className="overflow-y-auto flex-1 py-1">
                    {branches?.local.map((b) => (
                      <button
                        key={b}
                        onClick={() => b !== branches.current && handleCheckout(b)}
                        className={`w-full text-left px-3 py-1.5 text-[11px] font-mono transition-colors ${
                          b === branches.current
                            ? "text-text bg-bg-active"
                            : "text-text-secondary hover:bg-bg-hover hover:text-text"
                        }`}
                      >
                        {b}
                        {b === branches.current && <span className="text-text-muted ml-1">(atual)</span>}
                      </button>
                    ))}
                    {branches && branches.remoteOnly.length > 0 && (
                      <>
                        <div className="h-px bg-border mx-2 my-1" />
                        <div className="px-3 py-1">
                          <span className="text-[9px] font-medium uppercase tracking-wider text-text-muted">Remoto</span>
                        </div>
                        {branches.remoteOnly.map((b) => (
                          <button
                            key={b}
                            onClick={() => handleCheckout(b)}
                            className="w-full text-left px-3 py-1.5 text-[11px] font-mono text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-colors"
                          >
                            {b}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {error && (
          <div className="mx-3 mt-2 px-2.5 py-2 rounded-md bg-error/10 text-error text-[11px] break-words">
            {error}
          </div>
        )}

        {/* File list */}
        <div className="flex-1 overflow-y-auto">
          {loading && !status ? (
            <div className="flex items-center justify-center py-12"><Spinner /></div>
          ) : !status?.branch ? (
            <p className="text-text-muted text-[12px] text-center py-12">Não é um repositório git</p>
          ) : !hasChanges ? (
            <div className="text-center py-12">
              <p className="text-text-muted text-[12px]">Working tree limpa</p>
              {status.ahead > 0 && (
                <p className="text-text-secondary text-[11px] mt-1">
                  {status.ahead} commit{status.ahead > 1 ? "s" : ""} à frente do remoto
                </p>
              )}
            </div>
          ) : (
            <div className="py-1">
              <div className="flex items-center gap-2 px-3 py-1.5">
                <button onClick={toggleAll} className="shrink-0 w-4 text-center" aria-label="Selecionar todos">
                  <span className={`text-[11px] font-bold transition-colors ${
                    allSelected ? "text-text-secondary" : "text-text-muted/40"
                  }`}>
                    {allSelected ? "✓" : "–"}
                  </span>
                </button>
                <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted flex-1">
                  {selectedCount}/{allFiles.length} arquivo{allFiles.length !== 1 ? "s" : ""}
                </span>
                {selectedCount > 0 && (
                  confirmDiscard ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={handleDiscardSelected}
                        disabled={discardingSelected}
                        className="px-2 py-0.5 rounded text-[10px] font-medium bg-error/15 text-error hover:bg-error/25 transition-colors disabled:opacity-40"
                      >
                        {discardingSelected ? <Spinner className="w-2.5 h-2.5" /> : `Descartar ${selectedCount}`}
                      </button>
                      <button
                        onClick={() => setConfirmDiscard(false)}
                        aria-label="Cancelar"
                        className="p-0.5 rounded text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors"
                      >
                        <CloseIcon size={9} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleDiscardSelected}
                      className="px-2 py-0.5 rounded text-[10px] font-medium text-text-muted/50 hover:text-error hover:bg-error/10 transition-colors"
                    >
                      Descartar
                    </button>
                  )
                )}
              </div>
              {allFiles.map((f) => (
                <FileRow
                  key={f.file}
                  file={f}
                  checked={selected.has(f.file)}
                  expanded={expandedFile === f.file}
                  diff={fileDiffs[f.file]}
                  loadingDiff={loadingDiff === f.file}
                  onToggleExpand={() => toggleFile(f.file)}
                  onToggleCheck={(e) => toggleSelected(f.file, e)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Bottom actions */}
        {status?.branch && (
          <div className="shrink-0 border-t border-border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <button
                onClick={handleFetch}
                disabled={fetching}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-[11px] font-medium bg-bg-surface border border-border text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                {fetching ? <Spinner className="w-3 h-3" /> : fetched ? <CheckIcon size={11} /> : (
                  <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.22-8.56" /><polyline points="21 3 21 9 15 9" /></svg>
                )}
                {fetched ? "Fetch feito" : "Fetch"}
              </button>
              <button
                onClick={handlePull}
                disabled={pulling}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-[11px] font-medium bg-bg-surface border border-border text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                {pulling ? <Spinner className="w-3 h-3" /> : pulled ? <CheckIcon size={11} /> : (
                  <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>
                )}
                {pulled ? "Pull feito" : "Pull"}
              </button>
              <button
                onClick={handlePush}
                disabled={pushing}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-[11px] font-medium bg-bg-surface border border-border text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                {pushing ? <Spinner className="w-3 h-3" /> : pushed ? <CheckIcon size={11} /> : (
                  <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
                )}
                {pushed ? "Push feito" : "Push"}
              </button>
            </div>
            {hasChanges && (
              <>
                <textarea
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  placeholder="Mensagem do Commit..."
                  rows={2}
                  className="w-full resize-none rounded-md border border-border bg-bg-surface px-2.5 py-2 text-[12px] text-text placeholder:text-text-muted/50 focus:outline-none focus:border-text-muted/40"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleCommit();
                    }
                  }}
                />
                <button
                  onClick={handleCommit}
                  disabled={committing || !commitMsg.trim() || selectedCount === 0}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-[12px] font-medium bg-bg-surface border border-border text-text-secondary hover:text-text hover:bg-bg-hover transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  {committing ? <Spinner className="w-3 h-3" /> : committed ? <CheckIcon size={12} /> : null}
                  {committed ? "Commit feito" : selectedCount === allFiles.length ? "Commit tudo" : `Commit ${selectedCount} arquivo${selectedCount !== 1 ? "s" : ""}`}
                </button>
                <p className="text-[10px] text-text-muted/50 text-center">⌘+Enter para commit</p>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function FileRow({
  file,
  checked,
  expanded,
  diff,
  loadingDiff,
  onToggleExpand,
  onToggleCheck,
}: {
  file: FileStatus;
  checked: boolean;
  expanded: boolean;
  diff?: string;
  loadingDiff: boolean;
  onToggleExpand: () => void;
  onToggleCheck: (e: React.MouseEvent) => void;
}) {
  return (
    <div>
      <div
        onClick={onToggleExpand}
        className={`flex items-center gap-1.5 px-3 py-1.5 hover:bg-bg-hover transition-colors group cursor-pointer ${
          expanded ? "bg-bg-hover/50" : ""
        }`}
      >
        <button onClick={onToggleCheck} className="shrink-0 w-4 text-center" aria-label={checked ? "Desmarcar" : "Selecionar"}>
          <span className={`text-[11px] font-bold transition-colors ${
            checked ? "text-text-secondary" : "text-text-muted/30"
          }`}>
            {checked ? "✓" : "–"}
          </span>
        </button>
        <span className={`shrink-0 w-4 text-center text-[10px] font-mono font-bold ${statusColor(file.status)}`}>
          {statusLabel(file.status)}
        </span>
        <span
          className="text-[11px] font-mono min-w-0 flex-1 text-text-secondary group-hover:text-text overflow-hidden text-ellipsis whitespace-nowrap"
          dir="rtl"
        >
          <bdi>{file.file}</bdi>
        </span>
        <svg
          width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`shrink-0 text-text-muted/40 transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      {expanded && (
        <div className="border-t border-b border-border/50 bg-bg-surface/50 max-h-[300px] overflow-y-auto">
          {loadingDiff ? (
            <div className="flex items-center justify-center py-4"><Spinner /></div>
          ) : (
            <DiffView diff={diff ?? ""} />
          )}
        </div>
      )}
    </div>
  );
}
