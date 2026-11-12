"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  renderMarkdownToHtml,
  renderPreviewHtml,
  preprocessMath,
  THEMES,
} = require("../mdtohtml");

function body(html) {
  return html
    .split('<article class="markdown-body">')[1]
    .split("</article>")[0]
    .trim();
}
const paragraphs = (html) => (body(html).match(/<p[ >]/g) || []).length;

test("a paragraph that starts with inline math stays its own paragraph", () => {
  const md = "Para one.\n\n$x$ is a variable.";
  assert.equal(paragraphs(renderMarkdownToHtml(md)), 2);
  assert.match(body(renderMarkdownToHtml(md)), /class="katex"/);
});

test("math at the start of a wrapped line still renders", () => {
  const html = body(renderMarkdownToHtml("where\n$x$ is a variable"));
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /\$x\$/);
});

test("math after a heading does not get pulled into the heading", () => {
  const html = body(renderMarkdownToHtml("# Title\n$x$ text"));
  assert.match(html, /<h1>Title<\/h1>/);
});

test("preprocessMath keeps line structure", () => {
  const src = "a\n\n$x$ b\n$y$ c";
  assert.equal(preprocessMath(src).split("\n").length, src.split("\n").length);
});

test("preview source lines line up with the editor after math paragraphs", () => {
  const md = "# A\n\nPara one.\n\n$x$ is a var.\n\n## B\n\ntext";
  const html = body(renderPreviewHtml(md));
  assert.match(html, /<h2 data-source-line="7">B<\/h2>/);
  assert.match(html, /<p data-source-line="9">text<\/p>/);
});

test("empty and whitespace-only input render an empty article", () => {
  assert.equal(body(renderPreviewHtml("")), "");
  assert.equal(body(renderMarkdownToHtml("   \n\n")), "");
});

test("malformed markdown and math do not throw", () => {
  const nasty = [
    "$$ unclosed",
    "```js\nno closing fence",
    "$\\frac{1}{$",
    "| a | b |\n|---|\n| 1 |",
    "<div><span>",
    "[link](",
    "\\[ \\]",
    "\u0000MATHMASK99\u0000",
  ].join("\n\n");
  for (const theme of Object.keys(THEMES)) {
    assert.doesNotThrow(() => renderMarkdownToHtml(nasty, { theme }));
    assert.doesNotThrow(() => renderPreviewHtml(nasty, { theme }));
  }
});

test("every theme and font size produce a full document", () => {
  for (const theme of Object.keys(THEMES)) {
    for (const fontSize of [9, 13, 22]) {
      const html = renderMarkdownToHtml("# x\n\n```js\nlet a\n```", {
        theme,
        fontSize,
      });
      assert.match(html, /@page \{ size: A4/);
      assert.match(html, /<h1>x<\/h1>/);
    }
  }
});

test("large documents render", () => {
  const block =
    "## Section\n\nSome *text* with $a^2+b^2=c^2$ and `code`.\n\n" +
    "$$\n\\sum_{i=1}^n i\n$$\n\n```python\nprint(1)\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n";
  const md = block.repeat(500);
  const html = renderPreviewHtml(md);
  assert.equal((html.match(/<h2 /g) || []).length, 500);
});
