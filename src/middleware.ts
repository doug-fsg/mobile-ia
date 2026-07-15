import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const COOKIE_NAME = "cr_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

function unauthorizedHtml(wrongToken = false): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cursor Local Remote</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #000;
      color: #e8e8e8;
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      max-width: 380px;
      width: 100%;
      text-align: center;
    }
    .lock {
      width: 40px;
      height: 40px;
      margin: 0 auto 20px;
      color: #555;
    }
    h1 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .sub {
      font-size: 13px;
      color: #999;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .input-group {
      display: flex;
      gap: 8px;
    }
    .input-group input {
      flex: 1;
      background: #111;
      border: 1px solid #1e1e1e;
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 13px;
      font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace;
      color: #e8e8e8;
      outline: none;
      transition: border-color 0.15s;
    }
    .input-group input::placeholder { color: #555; }
    .input-group input:focus { border-color: #555; }
    .input-group button {
      background: #e8e8e8;
      color: #000;
      border: none;
      border-radius: 8px;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
      white-space: nowrap;
    }
    .input-group button:hover { opacity: 0.85; }
    .input-group button:disabled { opacity: 0.3; cursor: not-allowed; }
    .error-msg {
      margin-top: 10px;
      font-size: 12px;
      color: #ef4444;
    }
    .input-group input.shake {
      border-color: #ef4444;
      animation: shake 0.3s ease;
    }
    .hint {
      font-size: 11px;
      color: #555;
      line-height: 1.5;
      margin-top: 16px;
    }
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-4px); }
      75% { transform: translateX(4px); }
    }
  </style>
</head>
<body>
  <div class="card">
    <svg class="lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
    <h1>Authentication required</h1>
    <p class="sub">Paste the token from your terminal to connect.</p>

    <form id="auth" class="input-group" onsubmit="return handleSubmit(event)">
      <input id="token" type="text" placeholder="Paste token here" autocomplete="off" spellcheck="false" autofocus class="${wrongToken ? "shake" : ""}" />
      <button type="submit">Connect</button>
    </form>
    ${wrongToken ? '<p class="error-msg">Wrong token. Check your terminal for the correct one.</p>' : ""}
    <p class="hint">Run <code>clr</code> in your terminal to see the QR code and token.</p>
  </div>
  <script>
    function handleSubmit(e) {
      e.preventDefault();
      var v = document.getElementById("token").value.trim();
      if (!v) return false;
      window.location.href = "?token=" + encodeURIComponent(v);
      return false;
    }
  </script>
</body>
</html>`;
}

function misconfiguredHtml(): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>CLR</title>
<style>body{background:#000;color:#e8e8e8;font-family:system-ui;display:flex;min-height:100dvh;align-items:center;justify-content:center;padding:24px;text-align:center}code{color:#999}</style>
</head><body><div><h1 style="font-size:16px;margin-bottom:8px">AUTH_TOKEN required</h1>
<p style="color:#999;font-size:13px;line-height:1.5">Start the app with <code>clr</code> so authentication is configured.</p></div></body></html>`;
}

function tokensEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function middleware(req: NextRequest) {
  const token = process.env.AUTH_TOKEN;
  if (!token) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "AUTH_TOKEN not configured" }, { status: 503 });
    }
    return new NextResponse(misconfiguredHtml(), {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const url = req.nextUrl.clone();
  const queryToken = url.searchParams.get("token");

  if (queryToken !== null) {
    if (tokensEqual(queryToken, token)) {
      url.searchParams.delete("token");
      const res = NextResponse.redirect(url);
      res.cookies.set(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        maxAge: COOKIE_MAX_AGE,
      });
      return res;
    }

    return new NextResponse(unauthorizedHtml(true), {
      status: 401,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (cookie && tokensEqual(cookie, token)) return NextResponse.next();

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && tokensEqual(auth.slice(7), token)) {
    return NextResponse.next();
  }

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return new NextResponse(unauthorizedHtml(false), {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.png|apple-icon.png|sw.js).*)"],
};
