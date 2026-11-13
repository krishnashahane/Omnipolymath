import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap simple" style={{ textAlign: "center" }}>
      <span className="eyebrow">404</span>
      <h1>
        This page isn&apos;t here. Nothing was deleted.
      </h1>
      <p className="muted" style={{ fontSize: 18 }}>
        The link may be old, or the page may have moved.
      </p>
      <div className="hero-ctas" style={{ justifyContent: "center", marginTop: 24 }}>
        <Link className="btn" href="/">
          Go home
        </Link>
        <Link className="btn btn-ghost" href="/docs">
          Search the docs
        </Link>
      </div>
    </div>
  );
}
