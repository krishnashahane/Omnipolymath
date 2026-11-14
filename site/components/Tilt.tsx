"use client";

import { useRef, type ReactNode } from "react";

/** Tilts its content gently toward the pointer (after React Bits' TiltedCard). */
export function Tilt({ children, max = 6 }: { children: ReactNode; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--tl-x", `${(-py * max).toFixed(2)}deg`);
    el.style.setProperty("--tl-y", `${(px * max).toFixed(2)}deg`);
  };
  const leave = () => {
    ref.current?.style.setProperty("--tl-x", "0deg");
    ref.current?.style.setProperty("--tl-y", "0deg");
  };
  return (
    <div ref={ref} className="tilt" onPointerMove={move} onPointerLeave={leave}>
      {children}
    </div>
  );
}
