import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocsSearch } from "@/components/DocsSearch";
import { docsIndex, docsNav, readDoc, type NavGroup, type NavPage } from "@/lib/content";
import { renderDoc } from "@/lib/markdown";

export const dynamicParams = false;

type Params = { slug?: string[] };

export function generateStaticParams(): Params[] {
  return docsIndex().map((d) => ({ slug: d.slug ? d.slug.split("/") : [] }));
}

const slugOf = (p: Params) => (p.slug ?? []).map(decodeURIComponent).join("/");

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const slug = slugOf(await params);
  const meta = docsIndex().find((d) => d.slug === slug);
  if (!meta) return { title: "Docs" };
  return {
    title: meta.slug ? meta.title : "Docs",
    description: meta.description || `Omnipolymath documentation: ${meta.title}`,
    alternates: { canonical: `/docs${slug ? `/${slug}` : ""}` },
  };
}

function flatten(groups: NavGroup[]): { slug: string; title: string }[] {
  const out: { slug: string; title: string }[] = [];
  const walk = (p: NavPage) => ("group" in p ? p.pages.forEach(walk) : out.push(p));
  groups.forEach((g) => g.pages.forEach(walk));
  return out;
}

function NavTree({ pages, current }: { pages: NavPage[]; current: string }) {
  return (
    <ul>
      {pages.map((p) =>
        "group" in p ? (
          <li key={`g-${p.group}`}>
            <details open={JSON.stringify(p).includes(`"slug":"${current}"`)}>
              <summary>{p.group}</summary>
              <NavTree pages={p.pages} current={current} />
            </details>
          </li>
        ) : (
          <li key={p.slug}>
            <Link
              href={`/docs${p.slug ? `/${p.slug}` : ""}`}
              aria-current={p.slug === current ? "page" : undefined}
            >
              {p.title}
            </Link>
          </li>
        ),
      )}
    </ul>
  );
}

export default async function DocPage({ params }: { params: Promise<Params> }) {
  const slug = slugOf(await params);
  const meta = docsIndex().find((d) => d.slug === slug);
  const src = readDoc(slug);
  if (!meta || src === undefined) notFound();
  const { html, toc } = renderDoc(src);
  const nav = docsNav();
  const tab = nav.find((t) => JSON.stringify(t).includes(`"slug":"${slug}"`)) ?? nav[0];
  const order = tab ? flatten(tab.groups) : [];
  const at = order.findIndex((p) => p.slug === slug);
  const prev = at > 0 ? order[at - 1] : undefined;
  const next = at >= 0 && at < order.length - 1 ? order[at + 1] : undefined;
  const hasH1 = /<h1[\s>]/.test(html);
  // Upstream-era pages still describe npm, Homebrew and app-store installs that
  // Omnipolymath does not publish yet; say so where it matters.
  const needsInstallNotice =
    /npm (?:install|i) -g omnipolymath|npx omnipolymath|pnpm add -g omnipolymath|brew install|\.dmg\b|App Store|Google Play|TestFlight/i.test(
      html,
    );

  return (
    <div className="docs wrap">
      <aside className="docs-side" aria-label="Documentation">
        <DocsSearch />
        <div className="docs-tabs">
          {nav.map((t) => {
            const first = flatten(t.groups)[0];
            return first ? (
              <Link
                key={t.tab}
                href={`/docs${first.slug ? `/${first.slug}` : ""}`}
                className={t === tab ? "on" : ""}
              >
                {t.tab}
              </Link>
            ) : null;
          })}
        </div>
        {tab ? (
          <nav className="docs-tree">
            {tab.groups.map((g) => (
              <div key={g.group} className="docs-group">
                <h6>{g.group}</h6>
                <NavTree pages={g.pages} current={slug} />
              </div>
            ))}
          </nav>
        ) : null}
      </aside>
      <article className="docs-main">
        <div className="docs-crumbs muted">
          <Link href="/docs">Docs</Link>
          {tab ? <span> / {tab.tab}</span> : null}
        </div>
        {!hasH1 ? <h1 className="docs-title">{meta.title}</h1> : null}
        {meta.description ? <p className="docs-lede">{meta.description}</p> : null}
        {needsInstallNotice ? (
          <aside className="docs-notice" role="note">
            <strong>Install note.</strong> Omnipolymath isn&rsquo;t published to npm, Homebrew or
            app stores yet. Where this page uses one of those, install with the{" "}
            <Link href="/#install">installer script</Link> instead; the commands after install are
            the same.
          </aside>
        ) : null}
        <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
        <nav className="docs-pager" aria-label="Pagination">
          {prev ? (
            <Link href={`/docs${prev.slug ? `/${prev.slug}` : ""}`}>
              <small>Previous</small>
              {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={`/docs${next.slug ? `/${next.slug}` : ""}`} className="next">
              <small>Next</small>
              {next.title}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </article>
      {toc.length > 1 ? (
        <aside className="docs-toc" aria-label="On this page">
          <h6>On this page</h6>
          <ul>
            {toc.slice(0, 40).map((t) => (
              <li key={t.id} className={t.depth === 3 ? "sub" : ""}>
                <a href={`#${t.id}`}>{t.text}</a>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}
