import Link from "next/link";
import { Github, Instagram, Linkedin, Mark, XLogo } from "./Icons";

export const SOCIALS = [
  { href: "https://github.com/krishnashahane", label: "GitHub", Icon: Github },
  {
    href: "https://www.linkedin.com/in/krishna-shahane-721522273/",
    label: "LinkedIn",
    Icon: Linkedin,
  },
  { href: "https://x.com/krishnashahane_", label: "X", Icon: XLogo },
  { href: "https://www.instagram.com/urstrulylkrishna/", label: "Instagram", Icon: Instagram },
];

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-grid">
          <div>
            <Link href="/" className="brand" style={{ color: "var(--ink)" }}>
              <Mark className="brand-mark" /> Omnipolymath
            </Link>
            <p style={{ margin: "12px 0 0", maxWidth: 320 }}>
              Does the work. Shows the receipts. Built and maintained by Krishna Shahane.
            </p>
            <div className="socials">
              {SOCIALS.map(({ href, label, Icon }) => (
                <a
                  key={label}
                  href={href}
                  aria-label={`Krishna Shahane on ${label}`}
                  rel="noopener me"
                >
                  <Icon />
                </a>
              ))}
            </div>
          </div>
          <div>
            <h5>Product</h5>
            <ul>
              <li>
                <Link href="/#trust">Trust Firewall</Link>
              </li>
              <li>
                <Link href="/#receipts">Undo and receipts</Link>
              </li>
              <li>
                <Link href="/skills">Skill store</Link>
              </li>
              <li>
                <Link href="/dashboard">Dashboard</Link>
              </li>
            </ul>
          </div>
          <div>
            <h5>Docs</h5>
            <ul>
              <li>
                <Link href="/docs/start/getting-started">Getting started</Link>
              </li>
              <li>
                <Link href="/docs/gateway/security">Security</Link>
              </li>
              <li>
                <Link href="/docs/gateway/sandboxing">Sandboxing</Link>
              </li>
              <li>
                <Link href="/docs/help/faq">FAQ</Link>
              </li>
            </ul>
          </div>
          <div>
            <h5>Project</h5>
            <ul>
              <li>
                <a href="https://github.com/krishnashahane/Omnipolymath" rel="noopener">
                  Source
                </a>
              </li>
              <li>
                <Link href="/onboarding">Onboarding</Link>
              </li>
              <li>
                <Link href="/privacy">Privacy</Link>
              </li>
              <li>
                <a href="https://github.com/krishnashahane/Omnipolymath/blob/main/LICENSE" rel="noopener">
                  License
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="fineprint">
          <span>© {new Date().getFullYear()} Krishna Shahane. MIT licensed.</span>
          <span>Open source. Runs on your machine. No telemetry unless you set it up.</span>
        </div>
      </div>
    </footer>
  );
}
