import { Marked, type Tokens } from "marked";

/**
 * Render the repository's Mintlify-flavoured MDX docs as static HTML.
 * Components become semantic HTML, internal links gain the /docs prefix,
 * and headings get stable anchors for the table of contents.
 */

export type Toc = { id: string; text: string; depth: number }[];

const CALLOUTS = new Set(["Note", "Tip", "Warning", "Info", "Check", "Danger", "Callout"]);
const BLOCK = new Set([
  "Card",
  "CardGroup",
  "Columns",
  "Accordion",
  "AccordionGroup",
  "Tabs",
  "Tab",
  "Steps",
  "Step",
  "CodeGroup",
  "Frame",
  "ParamField",
  "ResponseField",
  "Expandable",
  "RequestExample",
  "ResponseExample",
  "Update",
  "Panel",
  ...CALLOUTS,
]);

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[`*_~[\]()]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function attr(attrs: string, name: string): string | undefined {
  const m = attrs.match(
    new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|\\{["'\`]([^"'\`]*)["'\`]\\}|\\{([^}]*)\\})`),
  );
  return m ? (m[1] ?? m[2] ?? m[3] ?? m[4]) : undefined;
}

/** Map a docs-relative href ("/gateway/x", "/images/a.png") to its URL on this site. */
export function rewriteHref(href: string): string {
  if (!href || /^(https?:|mailto:|tel:|#|data:)/i.test(href)) return href;
  if (href.startsWith("//")) return `https:${href}`;
  if (href.startsWith("/docs-assets/") || href.startsWith("/docs/") || href === "/docs")
    return href;
  if (/^\/(images|assets)\//.test(href)) return `/docs-assets${href}`;
  // files (not pages) at any depth: /foo.jpg, /diagrams/x.svg
  if (/^\/[^#?]+\.(png|jpe?g|gif|svg|webp|avif|mp4|webm|mov|pdf|zip|txt|csv)$/i.test(href))
    return `/docs-assets${href}`;
  if (href.startsWith("/")) {
    const [p, hash] = href.split("#");
    const clean = (p ?? "")
      .replace(/\.(md|mdx)$/, "")
      .replace(/\/index$/, "")
      .replace(/\/$/, "");
    return `/docs${clean === "" ? "" : clean}${hash ? `#${hash}` : ""}`;
  }
  return href.replace(/\.(md|mdx)(#|$)/, "$2");
}

function openTag(name: string, attrs: string): string {
  const title = attr(attrs, "title");
  const href = attr(attrs, "href");
  if (CALLOUTS.has(name)) return `<div class="callout callout-${name.toLowerCase()}">`;
  switch (name) {
    case "CardGroup":
    case "Columns":
      return `<div class="card-group">`;
    case "Card": {
      const t = title ? `<strong class="card-title">${esc(title)}</strong>` : "";
      return href
        ? `<a class="doc-card" href="${esc(rewriteHref(href))}">${t}<div class="card-body">`
        : `<div class="doc-card">${t}<div class="card-body">`;
    }
    case "Accordion":
      return `<details class="accordion"><summary>${esc(title ?? "Details")}</summary><div class="accordion-body">`;
    case "AccordionGroup":
      return `<div class="accordion-group">`;
    case "Tabs":
      return `<div class="tabs">`;
    case "Tab":
      return `<section class="tab"><div class="tab-title">${esc(title ?? "")}</div>`;
    case "Steps":
      return `<ol class="doc-steps">`;
    case "Step":
      return `<li class="doc-step">${title ? `<strong class="step-title">${esc(title)}</strong>` : ""}<div class="step-body">`;
    case "CodeGroup":
      return `<div class="code-group">`;
    case "Frame":
      return `<figure class="frame">`;
    case "ParamField":
    case "ResponseField": {
      const n =
        attr(attrs, "path") ??
        attr(attrs, "name") ??
        attr(attrs, "query") ??
        attr(attrs, "body") ??
        "";
      const ty = attr(attrs, "type");
      return `<div class="param"><div class="param-head"><code>${esc(n)}</code>${ty ? ` <span class="param-type">${esc(ty)}</span>` : ""}${/\brequired\b/.test(attrs) ? ` <span class="param-req">required</span>` : ""}</div><div class="param-body">`;
    }
    default:
      return `<div class="mdx-${name.toLowerCase()}">${title ? `<strong>${esc(title)}</strong>` : ""}`;
  }
}

function closeTag(name: string): string {
  if (CALLOUTS.has(name)) return `</div>`;
  switch (name) {
    case "Card":
      return `</div></a>`.replace("</a>", "</CARDEND>");
    case "Accordion":
      return `</div></details>`;
    case "Tab":
      return `</section>`;
    case "Steps":
      return `</ol>`;
    case "Step":
      return `</div></li>`;
    case "Frame":
      return `</figure>`;
    case "ParamField":
    case "ResponseField":
      return `</div></div>`;
    default:
      return `</div>`;
  }
}

/** Convert MDX to markdown + HTML blocks that marked can parse. */
export function mdxToMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  const stack: { name: string; isLink: boolean }[] = [];
  let fence: { marker: string; indent: number } | null = null;

  for (let raw of lines) {
    // inside fenced code: strip the fence's own indentation only
    if (fence) {
      const stripped = raw.slice(Math.min(fence.indent, raw.length - raw.trimStart().length));
      out.push(stripped);
      if (new RegExp(`^\\s*${fence.marker}\\s*$`).test(raw)) fence = null;
      continue;
    }
    const fm = raw.match(/^(\s*)(```+|~~~+)/);
    if (fm) {
      fence = { marker: fm[2]!.replace(/`/g, "\\`"), indent: fm[1]!.length };
      out.push(raw.slice(fm[1]!.length));
      continue;
    }
    // MDX-only syntax
    if (/^\s*(import|export)\s.+$/.test(raw) && !raw.includes("`")) continue;
    raw = raw.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    const depth = stack.length;
    let line = depth ? raw.replace(new RegExp(`^ {0,${depth * 2}}`), "").replace(/^\t+/, "") : raw;

    // self-closing components (<Icon/>, <Snippet/>) are dropped
    line = line.replace(/<([A-Z][A-Za-z0-9]*)\b[^<>]*?\/>/g, (m, n: string) =>
      n === "Tooltip" ? "" : "",
    );
    // inline Tooltip/Badge/Icon
    line = line.replace(
      /<Tooltip\b[^>]*tip=(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/Tooltip>/g,
      (_m, a, b, inner) => `<abbr title="${esc(a ?? b ?? "")}">${inner}</abbr>`,
    );
    line = line.replace(/<Badge\b[^>]*>([\s\S]*?)<\/Badge>/g, `<span class="badge">$1</span>`);

    // block open/close tags, possibly several per line
    let rebuilt = "";
    let rest = line;
    const tagRx = /<\/?([A-Z][A-Za-z0-9]*)\b((?:[^<>"'{}]|"[^"]*"|'[^']*'|\{[^{}]*\})*)>/;
    let isBlockLine = false;
    for (let m = tagRx.exec(rest); m; m = tagRx.exec(rest)) {
      const [full, name] = m as unknown as [string, string];
      const attrs = m[2] ?? "";
      rebuilt += rest.slice(0, m.index);
      rest = rest.slice(m.index + full.length);
      const closing = full.startsWith("</");
      if (!BLOCK.has(name) && !/^[A-Z]/.test(name)) {
        rebuilt += full;
        continue;
      }
      isBlockLine = true;
      if (closing) {
        const idx = stack.map((s) => s.name).lastIndexOf(name);
        if (idx === -1) continue;
        while (stack.length > idx) {
          const top = stack.pop()!;
          rebuilt += closeTag(top.name).replace("</CARDEND>", top.isLink ? "</a>" : "</div>");
        }
      } else {
        stack.push({ name, isLink: name === "Card" && Boolean(attr(attrs, "href")) });
        rebuilt += openTag(name, attrs);
      }
    }
    rebuilt += rest;
    if (isBlockLine) {
      // keep HTML on its own lines so markdown between tags still renders
      out.push("", rebuilt.trim(), "");
    } else {
      out.push(rebuilt);
    }
  }
  while (stack.length) {
    const top = stack.pop()!;
    out.push("", closeTag(top.name).replace("</CARDEND>", top.isLink ? "</a>" : "</div>"), "");
  }
  return out.join("\n");
}

export function renderDoc(src: string): { html: string; toc: Toc } {
  const toc: Toc = [];
  const used = new Map<string, number>();
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      heading(
        this: { parser: { parseInline: (t: Tokens.Generic[]) => string } },
        token: Tokens.Heading,
      ) {
        const text = this.parser.parseInline(token.tokens);
        let id = slugify(token.text) || "section";
        const n = used.get(id) ?? 0;
        used.set(id, n + 1);
        if (n) id = `${id}-${n}`;
        if (token.depth === 2 || token.depth === 3)
          toc.push({ id, text: text.replace(/<[^>]+>/g, ""), depth: token.depth });
        return `<h${token.depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${text}</h${token.depth}>\n`;
      },
      link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Link) {
        const href = rewriteHref(token.href);
        const text = this.parser.parseInline(token.tokens);
        const ext = /^https?:/.test(href) && !href.startsWith("https://omnipolymath.vercel.app");
        return `<a href="${esc(href)}"${token.title ? ` title="${esc(token.title)}"` : ""}${ext ? ' rel="noopener noreferrer"' : ""}>${text}</a>`;
      },
      image(token: Tokens.Image) {
        return `<img src="${esc(rewriteHref(token.href))}" alt="${esc(token.text)}" loading="lazy" decoding="async">`;
      },
      code(token: Tokens.Code) {
        const lang = (token.lang ?? "").split(/\s+/)[0] ?? "";
        return `<pre class="code"${lang ? ` data-lang="${esc(lang)}"` : ""}><code>${esc(token.text)}</code></pre>\n`;
      },
    },
  });
  let html = marked.parse(mdxToMarkdown(src), { async: false }) as string;
  // raw HTML attributes inside docs (href/src) also need rewriting
  html = html.replace(
    /\s(href|src)="(\/[^"]*)"/g,
    (_m, a: string, v: string) => ` ${a}="${esc(rewriteHref(v.replace(/&amp;/g, "&")))}"`,
  );
  return { html: sanitizeHtml(html), toc };
}

/**
 * Defense in depth for HTML that ends up in dangerouslySetInnerHTML. Docs come
 * from the repository, but contributions are untrusted until reviewed: drop
 * active content, inline event handlers and script-capable URLs.
 */
const NAMED_ENTITIES: Record<string, string> = {
  colon: ":",
  tab: "\t",
  newline: "\n",
  amp: "&",
  lpar: "(",
  rpar: ")",
};

/** Decode numeric and the few named entities that can hide a URL scheme. */
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

export function sanitizeHtml(html: string): string {
  return (
    html
      // Elements that can run code, load other documents or restyle the page.
      .replace(/<(script|style|iframe|frame|frameset|object|embed|applet|base|meta|link|form|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<\/?(script|style|iframe|frame|frameset|object|embed|applet|base|meta|link|form|template|noscript)\b[^>]*>/gi, "")
      // Inline event handlers (onclick=, onerror=, ...).
      .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      // Inline styles can be used for UI redress; the site's CSS owns styling.
      .replace(/\s+style\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      // Script-capable URLs in links, sources and form targets.
      .replace(
        /\s(href|src|xlink:href|action|formaction|poster|srcset)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi,
        (match, attr: string, _q: string, dq?: string, sq?: string, bare?: string) => {
          const value = decodeEntities(dq ?? sq ?? bare ?? "")
            .replace(/[\u0000-\u0020]/g, "")
            .toLowerCase();
          const unsafe =
            value.startsWith("javascript:") ||
            value.startsWith("vbscript:") ||
            (value.startsWith("data:") && !/^data:image\/(png|gif|jpe?g|webp|avif);/.test(value));
          return unsafe ? ` ${attr}="#"` : match;
        },
      )
  );
}
