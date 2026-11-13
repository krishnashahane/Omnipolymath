"use client";

import { useRef, type ReactNode } from "react";

/**
 * A soft highlight that follows the pointer across a card (after React Bits'
 * SpotlightCard). Pure CSS paints it from two custom properties; no re-renders.
 */
export function Spotlight({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "li";
}) {
  const ref = useRef<HTMLElement | null>(null);
  const move = (event: React.PointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el || event.pointerType === "touch") {
      return;
    }
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${event.clientX - r.left}px`);
    el.style.setProperty("--my", `${event.clientY - r.top}px`);
  };
  return (
    <Tag
      ref={(node: HTMLElement | null) => {
        ref.current = node;
      }}
      className={`spotlight ${className}`.trim()}
      onPointerMove={move}
    >
      {children}
    </Tag>
  );
}
