const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connectIdle(puppeteer, binding) {
  let sessions = [];
  try {
    sessions = await puppeteer.sessions(binding);
  } catch (err) {
    console.warn("listing browser sessions failed:", err);
  }
  for (const s of sessions) {
    if (s.connectionId) continue;
    try {
      return { browser: await puppeteer.connect(binding, s.sessionId) };
    } catch (_) {}
  }
  return { browser: null, sessions: sessions.length };
}

export async function acquireBrowser(
  puppeteer,
  binding,
  { waitMs = 5000, pollMs = 500 } = {},
) {
  const first = await connectIdle(puppeteer, binding);
  if (first.browser) return first.browser;
  try {
    return await puppeteer.launch(binding);
  } catch (err) {
    if (!isRateLimited(err) || !first.sessions) throw err;
    for (let waited = 0; waited < waitMs; waited += pollMs) {
      await sleep(pollMs);
      const next = await connectIdle(puppeteer, binding);
      if (next.browser) return next.browser;
    }
    throw err;
  }
}

export async function printToPdf(
  puppeteer,
  binding,
  html,
  needsWait,
  acquireOptions,
) {
  const browser = await acquireBrowser(puppeteer, binding, acquireOptions);
  let page;
  let healthy = true;
  try {
    page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    if (needsWait) {
      await page
        .waitForFunction("window.__mermaidDone === true", { timeout: 10000 })
        .catch(() => {});
    }
    return await page.pdf({ preferCSSPageSize: true });
  } catch (err) {
    healthy = false;
    throw err;
  } finally {
    if (page) await page.close().catch(() => {});
    if (healthy) await browser.disconnect().catch(() => {});
    else await browser.close().catch(() => {});
  }
}

export function isRateLimited(err) {
  return /\b429\b|rate limit/i.test(String(err && err.message));
}
