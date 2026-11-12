import test from "node:test";
import assert from "node:assert/strict";
import {
  acquireBrowser,
  printToPdf,
  isRateLimited,
} from "../worker/browser.js";

function fakePuppeteer({ sessions = [], connectFails = [], pdfError } = {}) {
  const log = [];
  const makeBrowser = (id) => ({
    id,
    async newPage() {
      log.push(["newPage", id]);
      return {
        async setContent() {},
        async waitForFunction() {},
        async pdf() {
          if (pdfError) throw pdfError;
          return new Uint8Array([37, 80, 68, 70]);
        },
        async close() {
          log.push(["page.close", id]);
        },
      };
    },
    async disconnect() {
      log.push(["disconnect", id]);
    },
    async close() {
      log.push(["close", id]);
    },
  });
  return {
    log,
    async sessions() {
      return sessions;
    },
    async connect(_binding, sessionId) {
      log.push(["connect", sessionId]);
      if (connectFails.includes(sessionId)) throw new Error("in use");
      return makeBrowser(sessionId);
    },
    async launch() {
      log.push(["launch"]);
      return makeBrowser("new");
    },
  };
}

test("reuses an idle browser session instead of launching", async () => {
  const p = fakePuppeteer({
    sessions: [
      { sessionId: "busy", connectionId: "c1" },
      { sessionId: "idle" },
    ],
  });
  const browser = await acquireBrowser(p, {});
  assert.equal(browser.id, "idle");
  assert.deepEqual(p.log, [["connect", "idle"]]);
});

test("falls back to the next session, then to launch, when connect fails", async () => {
  const p = fakePuppeteer({
    sessions: [{ sessionId: "a" }, { sessionId: "b" }],
    connectFails: ["a", "b"],
  });
  const browser = await acquireBrowser(p, {});
  assert.equal(browser.id, "new");
  assert.deepEqual(p.log, [["connect", "a"], ["connect", "b"], ["launch"]]);
});

test("launches when listing sessions fails", async () => {
  const p = fakePuppeteer();
  p.sessions = async () => {
    throw new Error("boom");
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal((await acquireBrowser(p, {})).id, "new");
  } finally {
    console.warn = warn;
  }
});

test("a successful print closes the page and keeps the session alive", async () => {
  const p = fakePuppeteer({ sessions: [{ sessionId: "idle" }] });
  const pdf = await printToPdf(p, {}, "<p>x</p>", false);
  assert.equal(pdf.length, 4);
  assert.deepEqual(p.log.slice(-2), [
    ["page.close", "idle"],
    ["disconnect", "idle"],
  ]);
});

test("a failed print closes the session so it isn't reused", async () => {
  const p = fakePuppeteer({
    sessions: [{ sessionId: "idle" }],
    pdfError: new Error("Target closed"),
  });
  await assert.rejects(printToPdf(p, {}, "<p>x</p>", false), /Target closed/);
  assert.deepEqual(p.log.slice(-2), [
    ["page.close", "idle"],
    ["close", "idle"],
  ]);
});

test("recognizes the Browser Rendering rate-limit error", () => {
  assert.ok(
    isRateLimited(
      new Error(
        "Unable to create new browser: code: 429: message: Rate limit exceeded",
      ),
    ),
  );
  assert.ok(!isRateLimited(new Error("Navigation timeout of 30000 ms")));
  assert.ok(!isRateLimited(undefined));
});
