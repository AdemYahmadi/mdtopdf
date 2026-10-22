import puppeteer from "@cloudflare/puppeteer";
import {
  renderMarkdownToHtml,
  renderPreviewHtml,
  setAssetLoader,
  THEMES,
  DEFAULT_THEME,
} from "../mdtohtml.js";
import { katexCss, hljsCss } from "./assets.generated.js";

setAssetLoader({
  katexCss: () => katexCss,
  hljsCss: (file) => hljsCss[file],
});

const MAX_BODY = 5 * 1024 * 1024;

function text(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function readBody(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new RangeError("Request body too large.");
  const type = request.headers.get("Content-Type") || "";
  if (type.startsWith("text/markdown")) return raw;
  if (type.startsWith("application/json")) return raw ? JSON.parse(raw) : {};
  return {};
}

function getMarkdown(body) {
  if (typeof body === "string") return body;
  if (body && typeof body.markdown === "string") return body.markdown;
  return "";
}

function getFontSize(body) {
  const n = body && Number(body.fontSize);
  if (!n || Number.isNaN(n)) return undefined;
  return Math.min(28, Math.max(8, Math.round(n)));
}

function getTheme(body) {
  const t = body && body.theme;
  return t && Object.prototype.hasOwnProperty.call(THEMES, t)
    ? t
    : DEFAULT_THEME;
}

async function cacheKey(md, fontSize, theme) {
  const data = new TextEncoder().encode(
    (fontSize || "") + "\n" + (theme || "") + "\n" + md,
  );
  const hash = await crypto.subtle.digest("SHA-1", data);
  const hex = [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Cache API needs a URL key; it is never fetched.
  return new Request(`https://pdf-cache.internal/${hex}`);
}

async function printToPdf(env, html, needsWait) {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    if (needsWait) {
      await page
        .waitForFunction("window.__mermaidDone === true", { timeout: 10000 })
        .catch(() => {});
    }
    return await page.pdf({ preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}

function pdfResponse(pdf) {
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="document.pdf"',
      "Cache-Control": "public, max-age=86400",
    },
  });
}

async function handlePreview(request) {
  try {
    const body = await readBody(request);
    const html = renderPreviewHtml(getMarkdown(body), {
      fontSize: getFontSize(body),
      theme: getTheme(body),
    });
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    return text("Preview failed: " + err.message, 500);
  }
}

async function handleConvert(request, env, ctx) {
  let body;
  try {
    body = await readBody(request);
  } catch (err) {
    return text("Conversion failed: " + err.message, 400);
  }
  const md = getMarkdown(body);
  if (!md.trim()) return text("No markdown provided.", 400);

  const fontSize = getFontSize(body);
  const theme = getTheme(body);
  const key = await cacheKey(md, fontSize, theme);
  const cache = caches.default;

  const cached = await cache.match(key);
  if (cached) return cached;

  try {
    const html = renderMarkdownToHtml(md, { fontSize, theme });
    const pdf = await printToPdf(env, html, html.includes('class="mermaid"'));
    const res = pdfResponse(pdf);
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch (err) {
    console.error("convert failed:", err);
    return text("Conversion failed: " + err.message, 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (pathname === "/healthz") return text("ok");
    if (request.method === "POST" && pathname === "/api/preview")
      return handlePreview(request);
    if (request.method === "POST" && pathname === "/api/convert")
      return handleConvert(request, env, ctx);

    return env.ASSETS.fetch(request);
  },
};
