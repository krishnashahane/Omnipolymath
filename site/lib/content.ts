import fs from "node:fs";
import path from "node:path";

export type DocMeta = {
  slug: string;
  title: string;
  description: string;
  section: string;
  headings: string[];
};
export type NavPage = { slug: string; title: string } | NavGroup;
export type NavGroup = { group: string; pages: NavPage[] };
export type NavTab = { tab: string; groups: NavGroup[] };
export type Skill = {
  name: string;
  slug: string;
  description: string;
  emoji: string;
  homepage?: string;
  bins: string[];
  env: string[];
  os: string[];
  installers: string[];
  findings: { id: string; severity: "low" | "medium" | "high"; detail: string }[];
  risk: "low" | "medium" | "high";
};

const root = path.join(process.cwd(), "content");
const cache = new Map<string, unknown>();
function readJson<T>(file: string, fallback: T): T {
  if (cache.has(file)) return cache.get(file) as T;
  let value = fallback;
  try {
    value = JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) as T;
  } catch {
    value = fallback;
  }
  cache.set(file, value);
  return value;
}

export const docsIndex = () => readJson<DocMeta[]>("docs-index.json", []);
export const docsNav = () => readJson<NavTab[]>("docs-nav.json", []);
export const skills = () => readJson<Skill[]>("skills.json", []);

export function readDoc(slug: string): string | undefined {
  const file = path.join(root, "docs", `${slug || "index"}.md`);
  if (!path.resolve(file).startsWith(path.resolve(root, "docs"))) return undefined;
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}
