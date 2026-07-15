"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { ModelInfo } from "@/lib/types";
import { apiFetch } from "@/lib/api-fetch";
import { applyTheme, normalizeTheme, type Theme } from "@/lib/theme";
import { useHaptics } from "@/hooks/use-haptics";
import { CloseIcon, ChevronDown, CheckIcon } from "./icons";

interface Settings {
  trust: boolean;
  sound: boolean;
  pwa_prompt: boolean;
  default_model: string;
  webhook_url: string;
  theme: Theme;
}

const DEFAULTS: Settings = {
  trust: true,
  sound: true,
  pwa_prompt: true,
  default_model: "auto",
  webhook_url: "",
  theme: "dark",
};

const TOGGLE_LABELS: Record<"trust" | "sound" | "pwa_prompt", { label: string; description: string }> = {
  trust: {
    label: "Confiança no workspace",
    description: "Permitir que o Agent execute código e edite arquivos sem pedir confirmação",
  },
  sound: {
    label: "Efeitos sonoros",
    description: "Tocar sons ao concluir e em erros",
  },
  pwa_prompt: {
    label: "Sugerir instalação PWA",
    description: "Mostrar o prompt de instalar como app ao carregar a página",
  },
};

const TOGGLE_KEYS = Object.keys(TOGGLE_LABELS) as (keyof typeof TOGGLE_LABELS)[];

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  onDefaultModelChange?: (model: string) => void;
}

export function SettingsPanel({ open, onClose, onDefaultModelChange }: SettingsPanelProps) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);
  const [webhookTestStatus, setWebhookTestStatus] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const webhookDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const haptics = useHaptics();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
    Promise.all([
      apiFetch("/api/settings").then((r) => r.json()),
      apiFetch("/api/models").then((r) => r.json()),
    ])
      .then(([settingsData, modelsData]) => {
        if (cancelled) return;
        const next = {
          ...DEFAULTS,
          ...settingsData.settings,
          theme: normalizeTheme(settingsData.settings?.theme),
        };
        setSettings(next);
        applyTheme(next.theme);
        if (modelsData.models?.length > 0) setModels(modelsData.models);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open]);

  const toggle = useCallback((key: keyof typeof TOGGLE_LABELS) => {
    haptics.tap();
    setSettings((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      apiFetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: next[key] }),
      }).catch(() => {
        setSettings(prev);
      });
      return next;
    });
  }, [haptics]);

  const toggleLightMode = useCallback(() => {
    haptics.tap();
    setSettings((prev) => {
      const theme: Theme = prev.theme === "light" ? "dark" : "light";
      applyTheme(theme);
      apiFetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme }),
      }).catch(() => {
        applyTheme(prev.theme);
        setSettings(prev);
      });
      return { ...prev, theme };
    });
  }, [haptics]);

  const handleModelSelect = useCallback((modelId: string) => {
    haptics.select();
    setSettings((prev) => {
      const next = { ...prev, default_model: modelId };
      apiFetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_model: modelId }),
      }).catch(() => {
        setSettings(prev);
      });
      return next;
    });
    onDefaultModelChange?.(modelId);
    setModelDropdownOpen(false);
  }, [onDefaultModelChange, haptics]);

  const handleClearCache = useCallback(async () => {
    haptics.warn();
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (typeof caches !== "undefined") {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      setCacheCleared(true);
      setTimeout(() => setCacheCleared(false), 2000);
    } catch {
      // best-effort
    }
  }, [haptics]);

  const handleWebhookUrlChange = useCallback((value: string) => {
    setSettings((prev) => ({ ...prev, webhook_url: value }));
    if (webhookDebounce.current) clearTimeout(webhookDebounce.current);
    webhookDebounce.current = setTimeout(() => {
      apiFetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhook_url: value }),
      }).catch(() => {});
    }, 500);
  }, []);

  const handleWebhookTest = useCallback(async () => {
    haptics.tap();
    setWebhookTestStatus("sending");
    try {
      const res = await apiFetch("/api/notifications/test", { method: "POST" });
      if (!res.ok) throw new Error();
      setWebhookTestStatus("ok");
    } catch {
      setWebhookTestStatus("error");
    }
    setTimeout(() => setWebhookTestStatus("idle"), 2500);
  }, [haptics]);

  const currentModelLabel = models.find((m) => m.id === settings.default_model)?.label || settings.default_model;

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/60" aria-hidden="true" onClick={onClose} />}
      <div
        role="dialog"
        aria-label="Configurações"
        aria-hidden={!open}
        className={`fixed inset-0 z-50 bg-bg-elevated transform transition-transform duration-150 flex flex-col sm:inset-auto sm:top-0 sm:right-0 sm:h-full sm:w-[300px] sm:border-l sm:border-border ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between h-11 px-3 border-b border-border shrink-0">
          <span className="text-[13px] font-medium text-text-secondary">Configurações</span>
          <button
            onClick={onClose}
            aria-label="Fechar configurações"
            className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-secondary transition-colors"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-3 space-y-1">
          {loading ? (
            <div className="flex justify-center py-8">
              <span className="inline-block w-3 h-3 rounded-full border-2 border-text-muted border-t-transparent animate-spin" />
            </div>
          ) : (
            <>
              {TOGGLE_KEYS.map((key) => (
                <button
                  key={key}
                  onClick={() => toggle(key)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-md hover:bg-bg-hover transition-colors text-left"
                >
                  <div className="min-w-0">
                    <p className="text-[12px] text-text">{TOGGLE_LABELS[key].label}</p>
                    <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{TOGGLE_LABELS[key].description}</p>
                  </div>
                  <div
                    className={`shrink-0 w-8 h-[18px] rounded-full transition-colors relative ${
                      settings[key] ? "bg-success" : "bg-bg-active"
                    }`}
                  >
                    <div
                      className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                        settings[key] ? "translate-x-[16px]" : "translate-x-[2px]"
                      }`}
                    />
                  </div>
                </button>
              ))}

              <button
                onClick={toggleLightMode}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-md hover:bg-bg-hover transition-colors text-left"
              >
                <div className="min-w-0">
                  <p className="text-[12px] text-text">Modo claro</p>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-tight">
                    Usar um esquema de cores claras na interface
                  </p>
                </div>
                <div
                  className={`shrink-0 w-8 h-[18px] rounded-full transition-colors relative ${
                    settings.theme === "light" ? "bg-success" : "bg-bg-active"
                  }`}
                >
                  <div
                    className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                      settings.theme === "light" ? "translate-x-[16px]" : "translate-x-[2px]"
                    }`}
                  />
                </div>
              </button>

              <div className="pt-3 mt-2 border-t border-border">
                <div className="px-3 py-2">
                  <p className="text-[12px] text-text">Modelo padrão</p>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-tight">
                    Modelo usado em novas sessões
                  </p>
                </div>
                <div className="relative px-3">
                  <button
                    onClick={() => setModelDropdownOpen((v) => !v)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-bg-surface border border-border text-[12px] text-text hover:bg-bg-hover transition-colors"
                  >
                    <span className="truncate">{currentModelLabel}</span>
                    <ChevronDown />
                  </button>
                  {modelDropdownOpen && models.length > 0 && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setModelDropdownOpen(false)} />
                      <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-bg-elevated border border-border rounded-lg shadow-xl py-1 max-h-60 overflow-y-auto">
                        {models.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => handleModelSelect(m.id)}
                            className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors ${
                              settings.default_model === m.id
                                ? "text-text bg-bg-active"
                                : "text-text-secondary hover:bg-bg-hover hover:text-text"
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="pt-3 mt-2 border-t border-border">
                <div className="px-3 py-2">
                  <p className="text-[12px] text-text">Notificações via Webhook</p>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-tight">
                    Receba avisos quando o Agent terminar, via qualquer Webhook
                  </p>
                </div>
                <div className="px-3 space-y-2">
                  <input
                    type="url"
                    value={settings.webhook_url}
                    onChange={(e) => handleWebhookUrlChange(e.target.value)}
                    placeholder="https://hooks.slack.com/..."
                    className="w-full px-3 py-2 rounded-md bg-bg-surface border border-border text-[12px] text-text placeholder:text-text-muted/50 focus:outline-none focus:border-text-muted transition-colors"
                    aria-label="URL do Webhook"
                  />
                  <button
                    onClick={handleWebhookTest}
                    disabled={!settings.webhook_url || webhookTestStatus === "sending"}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-bg-surface border border-border text-[12px] text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {webhookTestStatus === "sending" && (
                      <span className="inline-block w-3 h-3 rounded-full border-2 border-text-muted border-t-transparent animate-spin" />
                    )}
                    {webhookTestStatus === "ok" && <><CheckIcon size={12} /> Enviado!</>}
                    {webhookTestStatus === "error" && "Falha ao enviar"}
                    {webhookTestStatus === "idle" && "Enviar teste"}
                    {webhookTestStatus === "sending" && "Enviando..."}
                  </button>
                  <p className="text-[10px] text-text-muted/60 leading-tight px-0.5">
                    Cole uma URL de Webhook do Slack, Discord ou customizada para receber notificações quando o Agent concluir
                  </p>
                </div>
              </div>

              <div className="pt-3 mt-2 border-t border-border">
                <div className="px-3 py-2">
                  <p className="text-[12px] text-text">Cache</p>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-tight">
                    Limpe os dados em cache se o app parecer desatualizado
                  </p>
                </div>
                <div className="px-3">
                  <button
                    onClick={handleClearCache}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-bg-surface border border-border text-[12px] text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors"
                  >
                    {cacheCleared ? (
                      <>
                        <CheckIcon size={12} />
                        Cache limpo
                      </>
                    ) : (
                      "Limpar cache"
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
