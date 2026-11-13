"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CopyButton, InstallChip } from "@/components/CopyButton";
import { Arrow, Close } from "@/components/Icons";

type Safety = "strict" | "balanced" | "relaxed";
type State = {
  goals: string[];
  channels: string[];
  provider: string;
  safety: Safety;
  cap: number;
  sandbox: boolean;
  dryRunFirst: boolean;
};

const GOALS = [
  { id: "inbox", emoji: "📥", label: "Tame my inbox" },
  { id: "calendar", emoji: "📅", label: "Run my calendar" },
  { id: "code", emoji: "🧑‍💻", label: "Help me code" },
  { id: "research", emoji: "🔎", label: "Research things" },
  { id: "home", emoji: "🏠", label: "Smart home" },
  { id: "notes", emoji: "🗒️", label: "Notes and tasks" },
];
const CHANNELS = [
  { id: "whatsapp", emoji: "💬", label: "WhatsApp" },
  { id: "telegram", emoji: "✈️", label: "Telegram" },
  { id: "imessage", emoji: "🍏", label: "iMessage" },
  { id: "slack", emoji: "🧵", label: "Slack" },
  { id: "discord", emoji: "🎮", label: "Discord" },
  { id: "web", emoji: "🖥️", label: "Just the web dashboard" },
];
const PROVIDERS = [
  { id: "anthropic", emoji: "✳️", label: "Anthropic (Claude)" },
  { id: "openai", emoji: "◎", label: "OpenAI" },
  { id: "google", emoji: "◆", label: "Google Gemini" },
  { id: "local", emoji: "🖥️", label: "A local model" },
];
const SAFETY: { id: Safety; emoji: string; label: string; body: string }[] = [
  {
    id: "strict",
    emoji: "🛡️",
    label: "Strict",
    body: "Ask before anything that writes, sends, spends or deletes.",
  },
  {
    id: "balanced",
    emoji: "⚖️",
    label: "Balanced",
    body: "Ask before spending or anything irreversible. Recommended.",
  },
  {
    id: "relaxed",
    emoji: "🌿",
    label: "Relaxed",
    body: "Only ask before irreversible actions. Spending still needs you.",
  },
];

const STEPS = ["goals", "channels", "provider", "safety", "cap", "extras", "done"] as const;
type Step = (typeof STEPS)[number];

const TIERS: Record<Safety, string[]> = {
  strict: ["write", "external", "spend", "irreversible"],
  balanced: ["spend", "irreversible"],
  relaxed: ["spend", "irreversible"],
};

function buildConfig(s: State) {
  const fw: Record<string, unknown> = {
    mode: s.dryRunFirst ? "dry-run" : "enforce",
    approveTiers: TIERS[s.safety],
    dailySpendCapUsd: s.cap,
  };
  if (s.safety === "relaxed") fw.taintedApproveTiers = ["external"];
  const config: Record<string, unknown> = {
    plugins: { entries: { "trust-firewall": { config: fw } } },
  };
  if (s.sandbox)
    config.agents = {
      defaults: { sandbox: { mode: "non-main", scope: "session", workspaceAccess: "none" } },
    };
  return JSON.stringify(config, null, 2);
}

export function Onboarding() {
  const [i, setI] = useState(0);
  const [s, setS] = useState<State>({
    goals: [],
    channels: [],
    provider: "",
    safety: "balanced",
    cap: 10,
    sandbox: false,
    dryRunFirst: true,
  });
  const step: Step = STEPS[i]!;
  const progress = Math.round((i / (STEPS.length - 1)) * 100);
  const toggle = (key: "goals" | "channels", id: string) =>
    setS((p) => ({
      ...p,
      [key]: p[key].includes(id) ? p[key].filter((x) => x !== id) : [...p[key], id],
    }));
  const canNext =
    step === "goals"
      ? s.goals.length > 0
      : step === "channels"
        ? s.channels.length > 0
        : step === "provider"
          ? Boolean(s.provider)
          : true;
  const next = () => canNext && setI((v) => Math.min(v + 1, STEPS.length - 1));
  const back = () => setI((v) => Math.max(v - 1, 0));
  const config = useMemo(() => buildConfig(s), [s]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement) && step !== "done") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="ob">
      <div className="ob-top wrap">
        <Link href="/" className="ob-x" aria-label="Leave onboarding">
          <Close />
        </Link>
        <div
          className="ob-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label="Onboarding progress"
        >
          <span style={{ width: `${Math.max(progress, 4)}%` }} />
        </div>
        <span className="ob-count mono">
          {Math.min(i + 1, STEPS.length - 1)}/{STEPS.length - 1}
        </span>
      </div>

      <div className="ob-stage wrap" key={step}>
        {step === "goals" && (
          <Q title="What should Omnipolymath help with first?" hint="Pick as many as you like.">
            <Choices items={GOALS} selected={s.goals} onPick={(id) => toggle("goals", id)} multi />
          </Q>
        )}
        {step === "channels" && (
          <Q title="Where do you want to talk to it?" hint="You can add more later.">
            <Choices
              items={CHANNELS}
              selected={s.channels}
              onPick={(id) => toggle("channels", id)}
              multi
            />
          </Q>
        )}
        {step === "provider" && (
          <Q
            title="Which model should power it?"
            hint="Bring your own key. Omnipolymath never resells tokens."
          >
            <Choices
              items={PROVIDERS}
              selected={[s.provider]}
              onPick={(id) => setS((p) => ({ ...p, provider: id }))}
            />
          </Q>
        )}
        {step === "safety" && (
          <Q title="How careful should it be?" hint="You can change this any time.">
            <div className="ob-choices one">
              {SAFETY.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`ob-choice tall${s.safety === o.id ? " on" : ""}`}
                  aria-pressed={s.safety === o.id}
                  onClick={() => setS((p) => ({ ...p, safety: o.id }))}
                >
                  <span className="e">{o.emoji}</span>
                  <span>
                    <b>{o.label}</b>
                    <small>{o.body}</small>
                  </span>
                </button>
              ))}
            </div>
          </Q>
        )}
        {step === "cap" && (
          <Q
            title="Set a daily spend cap"
            hint="A hard stop. When it is reached, the agent pauses until tomorrow."
          >
            <div className="ob-cap panel">
              <div className="ob-cap-num">
                ${s.cap}
                <small>/ day</small>
              </div>
              <input
                type="range"
                min={1}
                max={100}
                step={1}
                value={s.cap}
                aria-label="Daily spend cap in dollars"
                onChange={(e) => setS((p) => ({ ...p, cap: Number(e.target.value) }))}
              />
              <div className="ob-cap-scale muted">
                <span>$1</span>
                <span>$100</span>
              </div>
              <p className="muted" style={{ margin: "14px 0 0", fontSize: 14 }}>
                Most personal use stays well under $5 a day. Set your model prices in the config for
                exact numbers.
              </p>
            </div>
          </Q>
        )}
        {step === "extras" && (
          <Q title="Two last safety nets" hint="Both are recommended for your first week.">
            <div className="ob-toggles">
              <Toggle
                on={s.dryRunFirst}
                onChange={(v) => setS((p) => ({ ...p, dryRunFirst: v }))}
                title="Start in dry-run mode"
                body="It plans and reads, but never writes, sends or deletes. Switch to enforce when you trust it."
              />
              <Toggle
                on={s.sandbox}
                onChange={(v) => setS((p) => ({ ...p, sandbox: v }))}
                title="Sandbox other sessions in Docker"
                body="Group chats and sub-agents run in an isolated container. Needs Docker installed."
              />
            </div>
          </Q>
        )}
        {step === "done" && (
          <div className="ob-done">
            <div className="ob-burst" aria-hidden>
              {Array.from({ length: 18 }, (_, k) => (
                <i
                  key={k}
                  style={{
                    ["--a" as string]: `${k * 20}deg`,
                    ["--c" as string]:
                      k % 3 === 0 ? "var(--accent)" : k % 3 === 1 ? "var(--ok)" : "var(--warn)",
                  }}
                />
              ))}
            </div>
            <div className="ob-trophy">🎉</div>
            <h1>You&apos;re all set.</h1>
            <p className="muted">
              Here is your setup. It is safe by default, and you stay in control.
            </p>
            <ul className="ob-summary">
              <li>
                <span>Helps with</span>
                <b>{s.goals.map((g) => GOALS.find((x) => x.id === g)?.label).join(", ")}</b>
              </li>
              <li>
                <span>Talk to it on</span>
                <b>{s.channels.map((c) => CHANNELS.find((x) => x.id === c)?.label).join(", ")}</b>
              </li>
              <li>
                <span>Model</span>
                <b>{PROVIDERS.find((p) => p.id === s.provider)?.label}</b>
              </li>
              <li>
                <span>Safety</span>
                <b>
                  {SAFETY.find((x) => x.id === s.safety)?.label}
                  {s.dryRunFirst ? " · dry run first" : ""}
                </b>
              </li>
              <li>
                <span>Daily cap</span>
                <b>${s.cap}</b>
              </li>
            </ul>
            <h2 className="ob-h2">1. Install</h2>
            <InstallChip command="curl -fsSL https://omnipolymath.vercel.app/install.sh | bash" />
            <h2 className="ob-h2">2. Save this as ~/.omnipolymath/omnipolymath.json</h2>
            <div className="ob-code panel">
              <div className="ob-code-head">
                <span className="mono">omnipolymath.json</span>
                <CopyButton text={config} label="Copy config" />
              </div>
              <pre>
                <code>{config}</code>
              </pre>
            </div>
            <h2 className="ob-h2">3. Finish in the terminal</h2>
            <InstallChip command="omnipolymath onboard --install-daemon" />
            <p className="muted" style={{ fontSize: 14 }}>
              Onboarding connects your{" "}
              {PROVIDERS.find((p) => p.id === s.provider)?.label ?? "model"} key and your chat apps.
              Nothing is sent anywhere from this page.
            </p>
            <div className="hero-ctas" style={{ marginTop: 20 }}>
              <Link className="btn btn-accent" href="/dashboard">
                Open the dashboard <Arrow />
              </Link>
              <Link className="btn btn-ghost" href="/docs/start/getting-started">
                Read the guide
              </Link>
            </div>
          </div>
        )}
      </div>

      {step !== "done" && (
        <div className="ob-foot">
          <div className="wrap ob-foot-inner">
            <button type="button" className="btn btn-ghost" onClick={back} disabled={i === 0}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-accent ob-next"
              onClick={next}
              disabled={!canNext}
            >
              {step === "extras" ? "Finish" : "Continue"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Q({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="ob-q">
      <h1>{title}</h1>
      <p className="muted">{hint}</p>
      {children}
    </div>
  );
}

function Choices({
  items,
  selected,
  onPick,
  multi,
}: {
  items: { id: string; emoji: string; label: string }[];
  selected: string[];
  onPick: (id: string) => void;
  multi?: boolean;
}) {
  return (
    <div className="ob-choices" role={multi ? "group" : "radiogroup"}>
      {items.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            className={`ob-choice${on ? " on" : ""}`}
            role={multi ? undefined : "radio"}
            aria-checked={multi ? undefined : on}
            aria-pressed={multi ? on : undefined}
            onClick={() => onPick(o.id)}
          >
            <span className="e">{o.emoji}</span>
            <b>{o.label}</b>
          </button>
        );
      })}
    </div>
  );
}

function Toggle({
  on,
  onChange,
  title,
  body,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  title: string;
  body: string;
}) {
  return (
    <div className="ob-toggle panel">
      <div>
        <b>{title}</b>
        <p className="muted">{body}</p>
      </div>
      <button
        type="button"
        className="switch"
        role="switch"
        aria-checked={on}
        aria-label={title}
        onClick={() => onChange(!on)}
      />
    </div>
  );
}
