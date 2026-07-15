"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { NetworkInfo } from "@/lib/types";
import { useHaptics } from "@/hooks/use-haptics";
import { apiFetch } from "@/lib/api-fetch";
import { Spinner } from "./icons";

interface QrModalProps {
  open: boolean;
  onClose: () => void;
}

export function QrModal({ open, onClose }: QrModalProps) {
  const [info, setInfo] = useState<NetworkInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const haptics = useHaptics();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiFetch("/api/info")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível carregar informações de rede");
      });
    return () => {
      cancelled = true;
      setInfo(null);
      setError(null);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Conectar dispositivo via QR"
        className="bg-bg-elevated border border-border rounded-xl p-6 max-w-xs w-full mx-4 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[13px] font-medium text-text mb-1">Conectar dispositivo</p>
        <p className="text-[12px] text-text-muted mb-5">Escaneie a partir de qualquer dispositivo na sua rede</p>

        {info ? (
          <>
            <div className="bg-white rounded-lg p-3 inline-block mb-3">
              <QRCodeSVG value={info.authUrl} size={180} />
            </div>
            <p className="font-mono text-[12px] text-text-secondary">{info.url}</p>
          </>
        ) : error ? (
          <div className="py-10 text-error text-[12px]">{error}</div>
        ) : (
          <div className="py-10 text-text-muted text-[12px]">
            <Spinner className="w-3.5 h-3.5" />
          </div>
        )}

        <button
          onClick={() => { haptics.tap(); onClose(); }}
          className="mt-4 w-full py-1.5 rounded-lg text-[12px] text-text-muted hover:text-text-secondary transition-colors"
        >
          Fechar
        </button>
      </div>
    </div>
  );
}
