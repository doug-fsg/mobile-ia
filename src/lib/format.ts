export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

/** Cursor often prefixes user turns with a long locale timestamp — strip it for sidebar labels. */
const LEADING_TIMESTAMP =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[a-zà-ü]*,?\s+[A-Za-zÀ-ÿ]+\s+\d{1,2},?\s+\d{4}(?:,?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?(?:\s*\([^)]*\))?/i;

/**
 * Compact label for session list: drop leading datetime noise, keep the first real line.
 */
export function cleanSessionTitle(raw: string, maxLen = 60): string {
  let text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return "";

  // Strip one or more leading timestamp paragraphs (date line + blank lines).
  for (let i = 0; i < 3; i++) {
    const next = text.replace(LEADING_TIMESTAMP, "").replace(/^\s*\n+/, "").trim();
    if (next === text) break;
    text = next;
  }

  const line =
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !LEADING_TIMESTAMP.test(l)) ?? text;

  const cleaned = line.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Nova sessão";
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + "…" : cleaned;
}
