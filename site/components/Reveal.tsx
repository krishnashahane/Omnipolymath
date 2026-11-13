"use client";

import { useEffect, useRef, type ElementType, type ReactNode } from "react";

/** Fades and rises content into view once, Apple-style. Honors reduced motion via CSS. */
export function Reveal({
  children,
  delay = 0,
  as: Tag = "div",
  className = "",
  instant = false,
}: {
  children: ReactNode;
  delay?: number;
  as?: ElementType;
  className?: string;
  instant?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || instant) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [instant]);
  return (
    <Tag
      ref={ref}
      className={`${instant ? "rise" : "reveal"} ${className}`}
      style={{ ["--d" as string]: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}
