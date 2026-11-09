const STATE_COOKIE = "__Host-cms_oauth_state";
const STATE_TTL_SECONDS = 600;
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

export function randomBase64Url(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

export function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" ||
      left.length !== 43 || right.length !== 43) return false;
  let difference = 0;
  for (let index = 0; index < 43; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function getConfig(env, requestUrl) {
  const cmsOrigin = env.CMS_ORIGIN;
  const redirectUri = env.OAUTH_REDIRECT_URI;
  const clientId = env.OAUTH_GITHUB_CLIENT_ID;
  const clientSecret = env.OAUTH_GITHUB_CLIENT_SECRET;

  if (!cmsOrigin || !redirectUri || !clientId || !clientSecret) {
    throw new Error("OAuth service is not configured");
  }

  const cms = new URL(cmsOrigin);
  const redirect = new URL(redirectUri);
  const current = new URL(requestUrl);

  if (cms.protocol !== "https:" || cms.origin !== cmsOrigin.replace(/\/$/, "")) {
    throw new Error("CMS_ORIGIN must be an HTTPS origin without a path");
  }
  const localHttp = redirect.protocol === "http:" &&
    (redirect.hostname === "localhost" || redirect.hostname === "127.0.0.1");
  if ((!localHttp && redirect.protocol !== "https:") || redirect.origin !== current.origin ||
      redirect.pathname !== "/callback" || redirect.search || redirect.hash) {
    throw new Error("OAUTH_REDIRECT_URI must match this Worker origin and /callback");
  }

  return { cmsOrigin: cms.origin, redirectUri: redirect.toString(), clientId, clientSecret };
}

function securityHeaders(extra = {}) {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    ...extra,
  };
}

function textResponse(message, status = 400, extraHeaders = {}) {
  return new Response(message, {
    status,
    headers: securityHeaders({ "Content-Type": "text/plain; charset=utf-8", ...extraHeaders }),
  });
}

function htmlResponse(status, content, cmsOrigin, extraHeaders = {}) {
  const nonce = randomBase64Url(18);
  const safePayload = JSON.stringify(content).replace(/</g, "\\u003c");
  const safeOrigin = JSON.stringify(cmsOrigin).replace(/</g, "\\u003c");
  const script = `
    const cmsOrigin = ${safeOrigin};
    const payload = ${safePayload};
    if (!window.opener) {
      document.body.textContent = "Nie znaleziono okna panelu administracyjnego. Zamknij to okno i spróbuj ponownie.";
    } else {
      window.addEventListener("message", (event) => {
        if (event.origin !== cmsOrigin || event.source !== window.opener) return;
        window.opener.postMessage(payload, cmsOrigin);
        window.close();
      }, { once: true });
      window.opener.postMessage("authorizing:github", cmsOrigin);
    }
  `;
  const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Logowanie do panelu</title></head><body><p>${status === "success" ? "Logowanie zakończone. Możesz zamknąć to okno." : "Nie udało się zalogować. Zamknij okno i spróbuj ponownie."}</p><script nonce="${nonce}">${script}</script></body></html>`;
  return new Response(html, {
    status: 200,
    headers: securityHeaders({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      ...extraHeaders,
    }),
  });
}

async function startOAuth(request, env) {
  const requestedProvider = new URL(request.url).searchParams.get("provider");
  if (requestedProvider !== "github") {
    return textResponse("Unsupported OAuth provider", 400);
  }

  let config;
  try {
    config = getConfig(env, request.url);
  } catch {
    return textResponse("OAuth service is not configured", 503);
  }

  const state = randomBase64Url(32);
  const authorize = new URL(GITHUB_AUTHORIZE_URL);
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("redirect_uri", config.redirectUri);
  authorize.searchParams.set("scope", "repo");
  authorize.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: securityHeaders({
      Location: authorize.toString(),
      "Set-Cookie": `${STATE_COOKIE}=${state}; Path=/; Max-Age=${STATE_TTL_SECONDS}; Secure; HttpOnly; SameSite=Lax`,
    }),
  });
}

async function finishOAuth(request, env) {
  let config;
  try {
    config = getConfig(env, request.url);
  } catch {
    return textResponse("OAuth service is not configured", 503);
  }

  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const cookieState = readCookie(request.headers.get("Cookie"), STATE_COOKIE);
  const clearStateCookie = `${STATE_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;

  if (!state || !cookieState || !constantTimeEqual(state, cookieState)) {
    return textResponse("OAuth state validation failed. Close this window and try again.", 400, {
      "Set-Cookie": clearStateCookie,
    });
  }

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return htmlResponse("error", {
      token: "",
      provider: "github",
      message: "GitHub authorization was not completed",
    }, config.cmsOrigin, { "Set-Cookie": clearStateCookie });
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return textResponse("Missing OAuth authorization code", 400, { "Set-Cookie": clearStateCookie });
  }

  let tokenResponse;
  try {
    tokenResponse = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
      }),
    });
  } catch {
    return textResponse("GitHub token exchange failed", 502, { "Set-Cookie": clearStateCookie });
  }

  if (!tokenResponse.ok) {
    return textResponse("GitHub token exchange failed", 502, { "Set-Cookie": clearStateCookie });
  }

  const tokenData = await tokenResponse.json().catch(() => null);
  if (!tokenData || typeof tokenData.access_token !== "string" || tokenData.error) {
    return textResponse("GitHub did not return an access token", 502, { "Set-Cookie": clearStateCookie });
  }

  return htmlResponse("success", {
    token: tokenData.access_token,
    provider: "github",
  }, config.cmsOrigin, { "Set-Cookie": clearStateCookie });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET") return textResponse("Method not allowed", 405, { Allow: "GET" });
    if (url.pathname === "/auth") return startOAuth(request, env);
    if (url.pathname === "/callback") return finishOAuth(request, env);
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200, headers: securityHeaders({ "Content-Type": "text/plain" }) });
    }
    return textResponse("Not found", 404);
  },
};
