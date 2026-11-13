import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(here, "content", file), "utf8"));
  } catch {
    return fallback;
  }
};

const DISCUSSIONS = "https://github.com/krishnashahane/Omnipolymath/issues";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Statically rendered App Router pages ship their data as inline scripts, so
      // nonces would force per-request rendering. Docs HTML is sanitized instead
      // (lib/markdown.ts sanitizeHtml) and no user input is ever rendered as HTML.
      "script-src 'self' 'unsafe-inline'",
      // React style attributes (CSS variables for motion) need inline styles.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "media-src 'self'",
      "worker-src 'self'",
      "manifest-src 'self'",
      "frame-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Do not write AGENTS.md/CLAUDE.md into the repository during `next dev`.
  agentRules: false,
  poweredByHeader: false,
  trailingSlash: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/install.sh",
        headers: [
          { key: "Content-Type", value: "text/x-shellscript; charset=utf-8" },
          { key: "Cache-Control", value: "public, max-age=300" },
        ],
      },
      {
        source: "/install-cli.sh",
        headers: [
          { key: "Content-Type", value: "text/x-shellscript; charset=utf-8" },
          { key: "Cache-Control", value: "public, max-age=300" },
        ],
      },
      {
        source: "/install.ps1",
        headers: [
          { key: "Content-Type", value: "text/plain; charset=utf-8" },
          { key: "Cache-Control", value: "public, max-age=300" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/discord", destination: DISCUSSIONS, permanent: false },
      { source: "/community", destination: DISCUSSIONS, permanent: false },
      { source: "/showcase", destination: "/#receipts", permanent: false },
      {
        source: "/github",
        destination: "https://github.com/krishnashahane/Omnipolymath",
        permanent: false,
      },
      { source: "/docs/index", destination: "/docs", permanent: true },
      // Skill registry pages live in the site's own skill store.
      { source: "/docs/clawhub", destination: "/skills", permanent: false },
      { source: "/docs/clawhub/:path*", destination: "/skills", permanent: false },
      ...read("docs-redirects.json", []),
    ];
  },
};

export default nextConfig;
