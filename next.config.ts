import type { NextConfig } from "next";

/**
 * Security headers (Step 11). Deliberately narrow:
 *
 * - No `script-src` policy here. A correct script CSP for Next needs a
 *   per-request nonce (and a nonce forces dynamic rendering), which is a
 *   bigger change than this launch needs. `frame-ancestors`/`base-uri`/
 *   `object-src`/`form-action` are the parts that cannot break the app, and
 *   they close the clickjacking and injected-base-tag holes.
 * - HSTS only in production: sending it from localhost would pin `http://`
 *   for every other dev server on the machine.
 * - `X-Frame-Options` stays alongside `frame-ancestors` for older browsers.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
];

if (process.env.NODE_ENV === "production") {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  });
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Do not advertise the framework on every response.
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
