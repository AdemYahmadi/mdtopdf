export async function acquireBrowser(puppeteer, binding) {
  try {
    const sessions = await puppeteer.sessions(binding);
    for (const s of sessions) {
      if (s.connectionId) continue;
      try {
        return await puppeteer.connect(binding, s.sessionId);
      } catch (_) {}
    }
  } catch (err) {
    console.warn("listing browser sessions failed:", err);
  }
  return puppeteer.launch(binding);
}

export async function printToPdf(puppeteer, binding, html, needsWait) {
  const browser = await acquireBrowser(puppeteer, binding);
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
