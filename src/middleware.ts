import { NextResponse, type NextRequest } from "next/server";

/**
 * Two jobs, both of which have to happen on every request and so belong here
 * rather than in individual handlers:
 *
 *  1. CSRF defence on state-changing requests.
 *  2. Content-Security-Policy with a per-response nonce.
 */

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const isDev = process.env.NODE_ENV !== "production";

/**
 * Rejects cross-site state-changing requests.
 *
 * The session cookie is already SameSite=Lax, which blocks it on cross-site
 * POSTs in current browsers. This is the second lock: it closes same-site
 * (sibling-subdomain) forgery, which Lax permits, and it does not depend on
 * every future handler remembering to check anything.
 *
 * Why it is needed at all: our handlers read bodies with `request.json()`,
 * which parses regardless of Content-Type. A cross-origin HTML form can post
 * `text/plain` without a CORS preflight, so "it only accepts JSON" is not by
 * itself a defence.
 *
 * Requests carrying neither header are allowed through: those are non-browser
 * clients (curl, scripts, the test suite), which are not subject to CSRF
 * because there is no ambient cookie for an attacker to borrow. Every browser
 * that can be made to forge a request sends at least one of the two.
 */
function crossSiteRejection(req: NextRequest): NextResponse | null {
  if (!MUTATING_METHODS.has(req.method)) return null;

  const fetchSite = req.headers.get("sec-fetch-site");

  if (fetchSite) {
    // "none" is a direct user action (typed URL, bookmark) and cannot be
    // driven by another site. Anything else that is not same-origin can be.
    if (fetchSite !== "same-origin" && fetchSite !== "none") {
      return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
    }
    return null;
  }

  const origin = req.headers.get("origin");
  if (!origin) return null;

  // The browser sets Origin, and a page cannot forge it. Comparing it to the
  // host the request actually arrived at is therefore sound, and survives a
  // reverse proxy rewriting the external hostname.
  const host = req.headers.get("host");
  const allowed = new Set<string>([req.nextUrl.origin]);
  if (host) {
    allowed.add(`https://${host}`);
    allowed.add(`http://${host}`);
  }
  if (process.env.AUTH_URL) {
    try {
      allowed.add(new URL(process.env.AUTH_URL).origin);
    } catch {
      // A malformed AUTH_URL should not take the request down.
    }
  }

  if (!allowed.has(origin)) {
    return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
  }

  return null;
}

function contentSecurityPolicy(nonce: string, host: string | null): string {
  const websocket = host ? `ws://${host} wss://${host}` : "";

  // Development needs 'unsafe-eval' and inline scripts for React Refresh and
  // the HMR client. Production gets the nonce + strict-dynamic policy, which is
  // what actually constrains script execution.
  const scriptSrc = isDev
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Tailwind ships a stylesheet, but Next injects inline <style> for route
    // transitions. Inline styles cannot execute script, so this is a small
    // concession compared to allowing inline script.
    "style-src 'self' 'unsafe-inline'",
    // Only the two avatar CDNs the OAuth providers actually serve from.
    "img-src 'self' data: blob: https://lh3.googleusercontent.com https://avatars.githubusercontent.com",
    "font-src 'self' data:",
    `connect-src 'self' ${websocket}`.trim(),
    "media-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Clickjacking: this app is never meant to be framed.
    "frame-ancestors 'none'",
    "frame-src 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function middleware(req: NextRequest) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;

  const nonce = crypto.randomUUID().replace(/-/g, "");
  const host = req.headers.get("host");
  const csp = contentSecurityPolicy(nonce, host);

  // Next reads the nonce back out of the request-side CSP header and stamps it
  // onto the script tags it renders. Without this, strict-dynamic would block
  // the framework's own bootstrap in production.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);

  return res;
}

export const config = {
  matcher: [
    // Everything except Next's build output and static files, which need no
    // CSRF check and get their headers from next.config.ts.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
