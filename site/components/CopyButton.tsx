"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "./Icons";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
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
        document.execCommand("copy");
      } finally {
        ta.remove();
      }
    }
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 1600);
  };
  return (
    <button
      type="button"
      className={`copy-btn${done ? " done" : ""}`}
      onClick={copy}
      aria-label={done ? "Copied" : label}
    >
      <Copy />
      <Check />
      <span className="sr-only" aria-live="polite">
        {done ? "Copied" : ""}
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
