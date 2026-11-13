import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What this website and the Omnipolymath software collect, which is very little.",
};

export default function Privacy() {
  return (
    <div className="wrap simple prose">
      <span className="eyebrow">Privacy</span>
      <h1>Short version: we don&apos;t collect your data.</h1>
      <h2>This website</h2>
      <p>
        omnipolymath.vercel.app has no analytics, no advertising, no cookies and no sign-in. It is
        hosted on Vercel, which keeps standard server logs (such as IP address and requested URL) as
        described in Vercel&apos;s own privacy policy.
      </p>
      <p>
        The onboarding page builds your config file entirely in your browser. Nothing you pick there
        is sent anywhere. The dashboard on this site shows sample data only.
      </p>
      <h2>The Omnipolymath software</h2>
      <p>
        Omnipolymath runs on your own machine. Your messages go to the model providers and chat apps
        you configure, and nowhere else. Your state, memory, credentials and the Trust Firewall
        action log stay on your disk.
      </p>
      <p>
        By default the software performs a version check, which you can turn off with{" "}
        <code>update.checkOnStart: false</code>. See{" "}
        <Link href="/docs/gateway/telemetry">usage telemetry and update checks</Link> for exactly
        what it sends.
      </p>
      <h2>Contact</h2>
      <p>
        Questions go to{" "}
        <a href="https://github.com/krishnashahane/Omnipolymath/issues">GitHub Issues</a> or to
        Krishna Shahane on{" "}
        <a href="https://www.linkedin.com/in/krishna-shahane-721522273/">LinkedIn</a>.
      </p>
    </div>
  );
}
