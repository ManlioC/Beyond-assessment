// Base di conoscenza del chatbot: legge i contenuti pubblici di beyondstrategy.it
// (sitemap → pagine → testo pulito) e li tiene in cache su Netlify Blobs,
// così il bot resta allineato al sito senza doverlo aggiornare a mano.
import { getStore } from "@netlify/blobs";

const SITE_URL = (Netlify.env.get("KNOWLEDGE_SITE_URL") || "https://beyondstrategy.it").replace(/\/$/, "");
const TTL_MS = 12 * 60 * 60 * 1000;
const MAX_PAGES = 40;
const MAX_CHARS_PER_PAGE = 12_000;
const MAX_TOTAL_CHARS = 180_000;
const FETCH_TIMEOUT_MS = 8_000;

// Pagine che non portano contenuto utile alla conversazione
const SKIP_PATTERN = /\.(pdf|jpe?g|png|gif|svg|webp|xml|zip)$|\/(wp-admin|wp-json|feed|tag|author)\//i;

type KnowledgeBase = { builtAt: number; text: string; pages: string[] };

let memoryCache: KnowledgeBase | null = null;

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "BeyondStrategyChatbot/1.0 (+knowledge-sync)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    egrave: "è", eacute: "é", agrave: "à", igrave: "ì", ograve: "ò", ugrave: "ù",
    Egrave: "È", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", ndash: "–", mdash: "—",
  };
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => named[name] ?? m);
}

export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim());
  const body = html
    .replace(/<(head|script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(b|strong|em|i|u|span|a|small|sup|sub|mark)\b[^>]*>/gi, "")
    .replace(/<(nav|footer|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(h[1-6])[^>]*>/gi, "\n\n## ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l && l !== "##" && l !== "-")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return { title, text };
}

function sameSite(url: string): boolean {
  try {
    const u = new URL(url);
    const base = new URL(SITE_URL);
    return u.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
}

function normalize(url: string): string {
  const u = new URL(url, SITE_URL);
  u.hash = "";
  u.search = "";
  return u.toString();
}

async function discoverUrls(): Promise<string[]> {
  const found = new Set<string>([normalize(SITE_URL + "/")]);

  // 1. Sitemap (anche indice di sitemap annidate)
  const queue = [`${SITE_URL}/sitemap.xml`, `${SITE_URL}/sitemap_index.xml`];
  const seenSitemaps = new Set<string>();
  while (queue.length && seenSitemaps.size < 10) {
    const sm = queue.shift()!;
    if (seenSitemaps.has(sm)) continue;
    seenSitemaps.add(sm);
    const xml = await fetchText(sm);
    if (!xml) continue;
    for (const [, loc] of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      if (/\.xml$/i.test(loc)) queue.push(loc);
      else if (sameSite(loc) && !SKIP_PATTERN.test(loc)) found.add(normalize(loc));
    }
  }

  // 2. Senza sitemap: link interni della home
  if (found.size <= 1) {
    const home = await fetchText(SITE_URL + "/");
    if (home) {
      for (const [, href] of home.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
        try {
          const abs = normalize(href);
          if (sameSite(abs) && !SKIP_PATTERN.test(abs)) found.add(abs);
        } catch {}
      }
    }
  }

  return [...found].slice(0, MAX_PAGES);
}

async function build(): Promise<KnowledgeBase> {
  const urls = await discoverUrls();
  const pages = await Promise.all(
    urls.map(async (url) => {
      const html = await fetchText(url);
      if (!html) return null;
      const { title, text } = htmlToText(html);
      if (text.length < 80) return null;
      return { url, title, text: text.slice(0, MAX_CHARS_PER_PAGE) };
    }),
  );

  let total = 0;
  const parts: string[] = [];
  const used: string[] = [];
  for (const p of pages) {
    if (!p) continue;
    const chunk = `<page url="${p.url}" title="${p.title.replace(/"/g, "'")}">\n${p.text}\n</page>`;
    if (total + chunk.length > MAX_TOTAL_CHARS) break;
    parts.push(chunk);
    used.push(p.url);
    total += chunk.length;
  }
  return { builtAt: Date.now(), text: parts.join("\n\n"), pages: used };
}

export async function getKnowledge(): Promise<KnowledgeBase> {
  const fresh = (kb: KnowledgeBase | null) => kb && kb.text && Date.now() - kb.builtAt < TTL_MS;
  if (fresh(memoryCache)) return memoryCache!;

  let store: ReturnType<typeof getStore> | null = null;
  try {
    store = getStore("chatbot-knowledge");
    const stored = (await store.get("site", { type: "json" })) as KnowledgeBase | null;
    if (fresh(stored)) return (memoryCache = stored!);
    // Cache scaduta: la teniamo come riserva se il sito non risponde
    if (stored?.text) memoryCache = stored;
  } catch {
    // Blobs non disponibile (es. esecuzione locale senza netlify dev)
  }

  const kb = await build();
  if (!kb.text) {
    if (memoryCache?.text) return memoryCache;
    return kb;
  }
  memoryCache = kb;
  try {
    await store?.setJSON("site", kb);
  } catch {}
  return kb;
}
