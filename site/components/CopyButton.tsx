"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "./Icons";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      } finally {
        ta.remove();
      }
    }
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), ok ? 1600 : 2600);
  };
  const done = state === "copied";
  const status = done ? "Copied" : state === "failed" ? "Copy failed, select the text instead" : "";
  return (
    <button
      type="button"
      className={`copy-btn${done ? " done" : ""}`}
      onClick={copy}
      aria-label={status || label}
      title={status || label}
    >
      <Copy />
      <Check />
      <span className="sr-only" aria-live="polite">
        {status}
      </span>
    </button>
  );
}

export function InstallChip({ command }: { command: string }) {
  return (
    <div className="install">
      <span className="dollar">$</span>
      <code>{command}</code>
      <CopyButton text={command} label="Copy install command" />
    </div>
  );
}
