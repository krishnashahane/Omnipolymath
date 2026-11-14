"use client";

import { useRef, type ReactNode } from "react";

/**
 * Pulls its child a few pixels toward the pointer (after React Bits' Magnet).
 * Mouse only; touch and reduced-motion users get a normal, still button.
 */
export function Magnet({ children, strength = 0.22 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const move = (e: React.PointerEvent<HTMLSpanElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) * strength;
    const y = (e.clientY - (r.top + r.height / 2)) * strength;
    el.style.setProperty("--mg-x", `${x.toFixed(1)}px`);
    el.style.setProperty("--mg-y", `${y.toFixed(1)}px`);
  };
  const leave = () => {
    ref.current?.style.setProperty("--mg-x", "0px");
    ref.current?.style.setProperty("--mg-y", "0px");
  };
  return (
    <span ref={ref} className="magnet" onPointerMove={move} onPointerLeave={leave}>
      {children}
    </span>
  );
}
