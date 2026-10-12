import type { NextConfig } from "next";

/**
 * Headers that are the same on every response live here; the
 * Content-Security-Policy is set in src/middleware.ts because it carries a
 * per-response nonce.
 */
const securityHeaders = [
  // Belt to the CSP's frame-ancestors, for anything that predates CSP support.
  { key: "X-Frame-Options", value: "DENY" },
  // Stops the browser second-guessing a declared Content-Type, which is what
  // keeps an uploaded .html or .svg from being executed as one.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Do not leak the channel or workspace id in the Referer of outbound links.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here needs any of these.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=()",
  },
  // Isolates this origin from cross-origin window handles and popups.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const config: NextConfig = {
  // The app runs behind a custom Node server (server.ts) so Socket.IO can share
  // the same HTTP server and process as the Next.js request handler. That is
  // what lets a route handler broadcast directly after a write commits.
  serverExternalPackages: ["bcryptjs"],

  // Don't advertise the framework version to scanners.
  poweredByHeader: false,

  async headers() {
    // Only constant headers belong here. Next evaluates this function at BUILD
    // time and bakes the result into the routes manifest, so anything keyed on
    // a runtime environment variable would silently never apply -- which is
    // exactly what happened to Strict-Transport-Security before it was moved
    // into server.ts.
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
