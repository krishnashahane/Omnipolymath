/**
 * Egress guard, modeled on NemoClaw's network policy.
 *
 * The Gateway's own fetch tools already refuse private and metadata addresses.
 * Shell commands and plugin tools that take a URL do not go through that guard,
 * so the firewall adds two rules on top:
 *  1. Hard-blocked destinations: cloud instance-metadata and link-local hosts are
 *     always blocked. They hand out credentials and have no use in normal work.
 *  2. Optional deny-by-default: with mode "approve-new", a call that reaches a
 *     host outside `allowedHosts` needs approval. An approved host is remembered
 *     until the Gateway restarts, like an approved endpoint in a NemoClaw sandbox.
 */

export type EgressMode = "off" | "approve-new";
export const EGRESS_MODES: EgressMode[] = ["off", "approve-new"];

const URL_KEYS = [
  "url",
  "urls",
  "href",
  "uri",
  "endpoint",
  "baseUrl",
  "base_url",
  "target",
  "link",
];
const URL_IN_TEXT = /\bhttps?:\/\/([^\s/'"`<>()\\]+)/giu;
const SHELL_NET = /\b(curl|wget|http|https|nc|ncat|ssh|scp|rsync|ftp|telnet)\b/u;

/** Hostnames that serve instance credentials on the major clouds. */
const METADATA_HOSTS = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
  "100.100.100.200",
  "fd00:ec2::254",
]);

function normalizeHost(raw: string): string | undefined {
  let host = raw.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//u, "");
  host = host.replace(/^[^@/]*@/u, "");
  host = host.split(/[/?#]/u)[0] ?? "";
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    host = end > 0 ? host.slice(1, end) : host.slice(1);
  } else if ((host.match(/:/gu) ?? []).length === 1) {
    // host:port; bare IPv6 addresses have several colons and no port.
    host = host.replace(/:\d+$/u, "");
  }
  host = host.replace(/\.$/u, "");
  return host && /^[a-z0-9.:_-]+$/u.test(host) ? host : undefined;
}

/** True for cloud metadata endpoints and the IPv4/IPv6 link-local ranges. */
export function isHardBlockedHost(host: string): boolean {
  const h = normalizeHost(host);
  if (!h) {
    return false;
  }
  if (METADATA_HOSTS.has(h)) {
    return true;
  }
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/u.test(h)) {
    return true;
  }
  // Decimal or hex encodings of 169.254.169.254 used to dodge string filters.
  if (h === "2852039166" || h === "0xa9fea9fe" || h === "0251.0376.0251.0376") {
    return true;
  }
  return /^fe[89ab][0-9a-f]?:/u.test(h);
}

function collectStrings(value: unknown, out: string[], depth = 0) {
  if (depth > 4 || value == null) {
    return;
  }
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, out, depth + 1);
    }
  }
}

/** Hosts a tool call would contact, from URL parameters and shell commands. */
export function egressHosts(params: Record<string, unknown>, shellCommand?: string): string[] {
  const hosts = new Set<string>();
  const texts: string[] = [];
  for (const key of URL_KEYS) {
    collectStrings(params[key], texts);
  }
  for (const text of texts) {
    const direct = /^[a-z][a-z0-9+.-]*:\/\//iu.test(text) ? normalizeHost(text) : undefined;
    if (direct) {
      hosts.add(direct);
    }
    for (const m of text.matchAll(URL_IN_TEXT)) {
      const h = normalizeHost(m[1] ?? "");
      if (h) {
        hosts.add(h);
      }
    }
  }
  if (shellCommand) {
    for (const m of shellCommand.matchAll(URL_IN_TEXT)) {
      const h = normalizeHost(m[1] ?? "");
      if (h) {
        hosts.add(h);
      }
    }
    if (SHELL_NET.test(shellCommand)) {
      // Bare hosts after network tools, e.g. `curl 169.254.169.254/latest`.
      for (const m of shellCommand.matchAll(
        /\b(?:curl|wget|nc|ncat|telnet|ftp)\b[^\n;|&]*?\s((?:\d{1,3}\.){3}\d{1,3}|[a-z0-9-]+(?:\.[a-z0-9-]+)+|0x[0-9a-f]+|\d{8,10})(?=[:/\s]|$)/giu,
      )) {
        const h = normalizeHost(m[1] ?? "");
        if (h) {
          hosts.add(h);
        }
      }
    }
  }
  return [...hosts];
}

/** `example.com` matches itself; `*.example.com` matches subdomains only. */
export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = normalizeHost(host);
  if (!h) {
    return false;
  }
  return allowed.some((pattern) => {
    const p = pattern.trim().toLowerCase();
    if (p.startsWith("*.")) {
      return h.endsWith(p.slice(1)) && h.length > p.length - 1;
    }
    return h === p;
  });
}
