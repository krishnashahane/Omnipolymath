"use client";

import { useEffect, useRef } from "react";

/**
 * Slow, flowing threads behind the hero (after React Bits' Threads), drawn on a
 * 2D canvas in the page accent color. Stops when off screen or in a background
 * tab, renders a single still frame for reduced motion, and caps device pixels.
 */
export function HeroField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let raf = 0;
    let visible = true;
    let t = Math.random() * 1000;
    let color = "#a8572a";

    const readColor = () => {
      color =
        getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || color;
    };
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const LINES = 22;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      for (let i = 0; i < LINES; i++) {
        const p = i / (LINES - 1);
        const base = height * (0.18 + p * 0.7);
        const amp = height * (0.06 + 0.05 * Math.sin(p * 3.1 + t * 0.15));
        ctx.globalAlpha = 0.05 + 0.13 * Math.sin(Math.PI * p);
        ctx.beginPath();
        for (let x = -20; x <= width + 20; x += 14) {
          const k = x / width;
          const y =
            base +
            Math.sin(k * 5.2 + t * 0.35 + p * 2.4) * amp +
            Math.sin(k * 11.7 - t * 0.22 + p * 5.1) * amp * 0.28;
          if (x === -20) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const loop = () => {
      t += 0.012;
      draw();
      raf = visible && !document.hidden && !reduce.matches ? requestAnimationFrame(loop) : 0;
    };
    const start = () => {
      if (!raf && visible && !document.hidden && !reduce.matches) raf = requestAnimationFrame(loop);
    };

    readColor();
    resize();
    draw();
    start();

    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      start();
    });
    io.observe(canvas);
    const onVisibility = () => start();
    document.addEventListener("visibilitychange", onVisibility);
    const onMotion = () => (reduce.matches ? draw() : start());
    reduce.addEventListener("change", onMotion);
    // Follow the theme toggle and the system theme.
    const mo = new MutationObserver(() => {
      readColor();
      draw();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => {
      readColor();
      draw();
    };
    scheme.addEventListener("change", onScheme);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      reduce.removeEventListener("change", onMotion);
      scheme.removeEventListener("change", onScheme);
    };
  }, []);

  return <canvas ref={ref} className="h-field" aria-hidden="true" />;
}
