"use client";

import { useCallback, useRef, useState } from "react";

type NotificationType = "complete" | "error";

export interface PendingNotification {
  type: NotificationType;
  elapsed?: number;
}

const FLASH_INTERVAL_MS = 1000;
const ORIGINAL_TITLE = "Cursor Local Remote";

function createBadgeFavicon(color: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.fillStyle = "#0a0a0b";
  ctx.beginPath();
  ctx.roundRect(0, 0, 32, 32, 6);
  ctx.fill();

  ctx.fillStyle = "#e5e5e6";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("C", 16, 17);

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(26, 6, 6, 0, Math.PI * 2);
  ctx.fill();

  return canvas.toDataURL("image/png");
}

function setFavicon(href: string) {
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
}

export function useNotification() {
  const [pending, setPending] = useState<PendingNotification | null>(null);
  const flashIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const originalFaviconRef = useRef<string>("");
  const cleanupRef = useRef<(() => void) | null>(null);

  const cleanup = useCallback(() => {
    if (flashIntervalRef.current) {
      clearInterval(flashIntervalRef.current);
      flashIntervalRef.current = null;
    }
    document.title = ORIGINAL_TITLE;
    if (originalFaviconRef.current) {
      setFavicon(originalFaviconRef.current);
    }
    cleanupRef.current = null;
  }, []);

  const dismiss = useCallback(() => {
    setPending(null);
    cleanup();
  }, [cleanup]);

  const notify = useCallback((type: NotificationType, elapsed?: number) => {
    setPending({ type, elapsed });

    const icon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    originalFaviconRef.current = icon?.href ?? "/favicon.ico";

    const badgeColor = type === "error" ? "#ef4444" : "#22c55e";
    const badgeHref = createBadgeFavicon(badgeColor);
    if (badgeHref) setFavicon(badgeHref);

    const flashTitle = type === "error" ? "Erro - CLR" : "Concluído! - CLR";
    let toggle = true;
    flashIntervalRef.current = setInterval(() => {
      document.title = toggle ? flashTitle : ORIGINAL_TITLE;
      toggle = !toggle;
    }, FLASH_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        cleanup();
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    cleanupRef.current = () => {
      cleanup();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [cleanup]);

  return { pending, notify, dismiss };
}
