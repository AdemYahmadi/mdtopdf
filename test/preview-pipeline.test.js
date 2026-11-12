"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createClient, settle } = require("./helpers/client");

function finishRasters(c) {
  c.pdfDocs.forEach((d) => d.pageRender.resolve());
}

test("continuous: edit during a render triggers a follow-up render", async () => {
  const c = createClient({ viewMode: "continuous", markdown: "# A" });
  c.renderPreview();
  assert.equal(c.fetches.length, 1);

  c.setMarkdown("# B");
  c.respond(0);
  await settle();

  assert.equal(c.fetches.length, 2, "stale result must not mark B rendered");
  assert.equal(c.fetches[1].body.markdown, "# B");
  c.respond(1);
  await settle();
  assert.equal(c.run("renderedContinuousKey"), c.run("keyOf()"));
  assert.equal(c.status(), "Ready");
});

test("continuous: rapid theme switches end on the last theme", async () => {
  const c = createClient({ viewMode: "continuous" });
  c.renderPreview();
  for (const t of ["github", "github-dark", "one-dark", "tokyo-night"]) {
    c.setTheme(t);
    c.renderPreview();
  }
  assert.equal(c.fetches.length, 1, "one request at a time");
  c.respond(0);
  await settle();
  assert.equal(c.fetches.length, 2);
  assert.equal(c.fetches[1].body.theme, "tokyo-night");
  c.respond(1);
  await settle();
  assert.equal(c.fetches.length, 2);
  assert.equal(c.run("renderedContinuousKey"), c.run("keyOf()"));
});

test("pages: edit during conversion triggers a follow-up conversion", async () => {
  const c = createClient({ viewMode: "pages", markdown: "# A" });
  c.renderPreview();
  c.setMarkdown("# B");
  c.respond(0);
  await settle();
  finishRasters(c);
  await settle();

  assert.equal(c.fetches.length, 2);
  assert.equal(c.fetches[1].body.markdown, "# B");
  c.respond(1);
  await settle();
  finishRasters(c);
  await settle();
  assert.equal(c.run("renderedKey"), c.run("keyOf()"));
  assert.equal(c.pages().length, 1);
});

test("pages: clearing the document mid-conversion leaves no stale pages", async () => {
  const c = createClient({ viewMode: "pages", markdown: "# A" });
  c.renderPreview();
  c.setMarkdown("");
  c.renderPreview();
  c.respond(0);
  await settle();
  finishRasters(c);
  await settle();

  assert.equal(c.pages().length, 0);
  assert.match(c.emptyText("empty"), /^Empty document/);
});

test("pages: an older raster can't overwrite a newer one", async () => {
  const c = createClient({ viewMode: "pages", markdown: "# A" });
  const blob = (key) => ({ arrayBuffer: async () => key });
  const oldBlob = blob("old");
  const newBlob = blob("new");
  const first = c.run("displayPdf")(oldBlob);
  await settle();
  const second = c.run("displayPdf")(newBlob);
  await settle();
  c.pdfDocs[1].pageRender.resolve();
  await second;
  const shown = c.pages()[0];
  c.pdfDocs[0].pageRender.resolve();
  await first;

  assert.equal(c.pages().length, 1);
  assert.equal(c.pages()[0], shown, "older render was dropped");
  assert.equal(c.run("shownBlob"), newBlob, "resize redraws the newer PDF");
  assert.ok(
    c.pdfDocs.every((d) => d.destroyed),
    "pdf.js docs destroyed",
  );
  assert.ok(c.revoked.length >= 1, "dropped page URLs revoked");
});

test("download after a theme change converts again instead of reusing the old PDF", async () => {
  const c = createClient({ viewMode: "continuous", markdown: "# A" });
  c.run("download()");
  c.respond(0);
  await settle();

  c.setTheme("github-dark");
  c.run("download()");
  await settle();
  assert.equal(c.fetches.length, 2, "theme change must invalidate the PDF");
  assert.equal(c.fetches[1].body.theme, "github-dark");
});

test("download while the preview converts the same content shares the request", async () => {
  const c = createClient({ viewMode: "pages", markdown: "# A" });
  c.renderPreview();
  c.run("download()");
  await settle();
  assert.equal(c.fetches.length, 1);
});

test("a second download shortcut while one is running is ignored", async () => {
  const c = createClient({ viewMode: "continuous", markdown: "# A" });
  c.run("download()");
  c.setMarkdown("# B");
  c.run("download()");
  await settle();
  assert.equal(c.fetches.length, 1);
});

test("rate-limited conversion shows an actionable message", async () => {
  const c = createClient({ viewMode: "pages", markdown: "# A" });
  c.renderPreview();
  c.fail(0, 429, "Conversion failed: the PDF renderer is busy.");
  await settle();
  assert.match(c.emptyText("empty"), /busy, wait a few seconds/);
  assert.equal(c.status(), "Conversion failed");
});

test("server error text is surfaced instead of a generic message", async () => {
  const c = createClient({ viewMode: "pages", markdown: "# A" });
  c.renderPreview();
  c.fail(0, 500, "Conversion failed: Navigation timeout of 30000 ms exceeded");
  await settle();
  assert.equal(
    c.emptyText("empty"),
    "Couldn't generate PDF preview — Navigation timeout of 30000 ms exceeded",
  );
});

test("HTML error pages fall back to the generic hint", async () => {
  const c = createClient({ viewMode: "continuous", markdown: "# A" });
  c.renderPreview();
  c.fail(0, 503, "<!DOCTYPE html><html>Worker exceeded resource limits");
  await settle();
  assert.match(c.emptyText("emptyContinuous"), /try again, or simplify/);
});

test("a failure for superseded content doesn't flash an error", async () => {
  const c = createClient({ viewMode: "pages", markdown: "# A" });
  c.renderPreview();
  c.setMarkdown("# B");
  c.fail(0, 500, "Conversion failed: boom");
  await settle();
  assert.equal(c.fetches.length, 2, "retries with the current content");
  assert.equal(c.status(), "Rendering…");
  c.respond(1);
  await settle();
  finishRasters(c);
  await settle();
  assert.equal(c.status(), "Ready");
  assert.equal(c.pages().length, 1);
});

test("switching to continuous mid-conversion still shows pages on return", async () => {
  const c = createClient({ viewMode: "pages", markdown: "# A" });
  c.renderPreview();
  c.run("proof.hidden = true; proof.clientWidth = 0; viewMode = 'continuous'");
  c.respond(0);
  await settle();
  assert.equal(c.pages().length, 0, "nothing rasterized while hidden");

  c.run("proof.clientWidth = 800");
  c.run("setViewMode('pages')");
  await new Promise((r) => setTimeout(r, 300));
  await settle();
  finishRasters(c);
  await settle();
  assert.equal(c.pages().length, 1);
});
