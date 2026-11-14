"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Close, Github, Mark, Menu } from "./Icons";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { href: "/#trust", label: "Firewall" },
  { href: "/#status", label: "Status" },
  { href: "/skills", label: "Skills" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/docs", label: "Docs" },
];

export function Nav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const close = () => setOpen(false);

  const current = (href: string) =>
    href.startsWith("/#") ? false : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className={`nav${scrolled ? " scrolled" : ""}`}>
      <div className="wrap">
        <div className="nav-inner">
          <Link href="/" className="brand" aria-label="Omnipolymath home">
            <Mark className="brand-mark" />
            Omnipolymath
          </Link>
          <nav className="nav-links" aria-label="Primary">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} aria-current={current(l.href) ? "page" : undefined}>
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="nav-right">
            <a
              className="btn btn-ghost btn-sm nav-gh"
              href="https://github.com/krishnashahane/Omnipolymath"
              rel="noopener"
            >
              <Github size={15} /> GitHub
            </a>
            <a className="btn btn-sm" href="/#install">
              Install
            </a>
            <ThemeToggle />
            <button
              className="menu-btn"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <Close /> : <Menu />}
            </button>
          </div>
        </div>
        {open ? (
          <nav className="mobile-menu" aria-label="Mobile">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} onClick={close}>
                {l.label}
              </Link>
            ))}
            <a href="https://github.com/krishnashahane/Omnipolymath" rel="noopener" onClick={close}>
              GitHub
            </a>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
