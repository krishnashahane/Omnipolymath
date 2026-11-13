"use client";

import Link from "next/link";
import { useState } from "react";
import { CopyButton } from "./CopyButton";

const STABLE_TAG = "v2026.11.3";
const REPO = "https://github.com/krishnashahane/Omnipolymath.git";

type Method = "apps" | "one-liner" | "npm" | "hackable";
type Os = "unix" | "windows";
type Channel = "stable" | "beta";

const METHODS: Array<[Method, string]> = [
  ["apps", "Apps"],
  ["one-liner", "One-liner"],
  ["npm", "npm"],
  ["hackable", "Hackable"],
];

type Panel =
  | { kind: "commands"; lines: string[]; note: string }
  | { kind: "notice"; title: string; body: string; cta?: Method };

function panel(method: Method, os: Os, channel: Channel): Panel {
  const ref = channel === "stable" ? STABLE_TAG : "main";
  const inWsl = os === "windows" ? " Run it inside WSL2 (Ubuntu)." : "";
  switch (method) {
    case "one-liner":
      if (os === "windows") {
        return {
          kind: "commands",
          lines: [
            "iwr -useb https://omnipolymath.vercel.app/install.ps1 | iex",
            "# then, inside WSL2:",
            channel === "stable"
              ? `curl -fsSL https://omnipolymath.vercel.app/install.sh | OMNIPOLYMATH_REF=${STABLE_TAG} bash`
              : "curl -fsSL https://omnipolymath.vercel.app/install.sh | bash",
          ],
          note: "The PowerShell script checks for WSL2 and prints the exact next steps. It doesn't change your system.",
        };
      }
      return {
        kind: "commands",
        lines: [
          channel === "stable"
            ? `curl -fsSL https://omnipolymath.vercel.app/install.sh | OMNIPOLYMATH_REF=${STABLE_TAG} bash`
            : "curl -fsSL https://omnipolymath.vercel.app/install.sh | bash",
        ],
        note: `Clones ${channel === "stable" ? `the ${STABLE_TAG} release` : "the latest main"}, builds it with pnpm and starts onboarding. Needs git, Node.js 24.16+ and pnpm; never runs as root.`,
      };
    case "hackable":
      return {
        kind: "commands",
        lines: [
          `git clone --branch ${ref} ${REPO}`,
          "cd Omnipolymath",
          "pnpm install && pnpm build && pnpm ui:build",
          "pnpm omnipolymath onboard --install-daemon",
        ],
        note: `For contributors: a full checkout you can change and rebuild.${inWsl}`,
      };
    case "npm":
      return {
        kind: "notice",
        title: "Not on npm yet",
        body: "The omnipolymath package isn't published, so npm install -g omnipolymath won't work today. Use the one-liner; it builds the same CLI from source.",
        cta: "one-liner",
      };
    case "apps":
      return {
        kind: "notice",
        title: "No app downloads yet",
        body: "Desktop and mobile apps aren't published. Install the CLI with the one-liner and use the Control UI in your browser; the app source is in apps/ if you want to build one.",
        cta: "one-liner",
      };
  }
}

export function QuickStart() {
  const [method, setMethod] = useState<Method>("one-liner");
  const [os, setOs] = useState<Os>("unix");
  const [channel, setChannel] = useState<Channel>("stable");
  const view = panel(method, os, channel);
  const copyText =
    view.kind === "commands" ? view.lines.filter((l) => !l.startsWith("#")).join("\n") : "";

  return (
    <div className="qs">
      <div className="qs-head">
        <span className="qs-kicker">Quick start</span>
        <Link href="/docs/install" className="qs-all">
          All install options <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className="qs-panel">
        <div className="qs-bar">
          <span className="qs-label">Install</span>
          <div className="qs-tabs" role="tablist" aria-label="Install method">
            {METHODS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={method === id}
                className={method === id ? "on" : undefined}
                onClick={() => setMethod(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="qs-right">
            <div className="qs-tabs" role="tablist" aria-label="Operating system">
              {(
                [
                  ["unix", "macOS & Linux"],
                  ["windows", "Windows"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={os === id}
                  className={os === id ? "on" : undefined}
                  onClick={() => setOs(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`qs-beta${channel === "beta" ? " on" : ""}`}
              aria-pressed={channel === "beta"}
              title={
                channel === "beta"
                  ? "Beta: builds the latest main"
                  : `Stable: builds the ${STABLE_TAG} release`
              }
              onClick={() => setChannel((c) => (c === "stable" ? "beta" : "stable"))}
            >
              <span aria-hidden="true">β</span> Beta
            </button>
          </div>
        </div>
        <div className="qs-body" role="tabpanel">
          {view.kind === "commands" ? (
            <>
              <div className="qs-code">
                <pre>
                  {view.lines.map((line, i) => (
                    <span key={i} className={line.startsWith("#") ? "qs-comment" : undefined}>
                      {line.startsWith("#") ? line : `$ ${line}`}
                      {"\n"}
                    </span>
                  ))}
                </pre>
                <CopyButton text={copyText} label="Copy install commands" />
              </div>
              <p className="qs-note">
                <span className="qs-channel">{channel === "stable" ? STABLE_TAG : "main"}</span>
                {view.note}
              </p>
            </>
          ) : (
            <div className="qs-notice">
              <strong>{view.title}</strong>
              <p>{view.body}</p>
              {view.cta ? (
                <button type="button" onClick={() => setMethod(view.cta!)}>
                  Show the one-liner <span aria-hidden="true">→</span>
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
