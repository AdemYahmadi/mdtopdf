"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT =
  process.env.CLIENT_JS_ROOT ||
  path.join(__dirname, "..", "..", "public", "js");

class ClassList {
  constructor() {
    this.set = new Set();
  }
  add(...c) {
    c.forEach((x) => this.set.add(x));
  }
  remove(...c) {
    c.forEach((x) => this.set.delete(x));
  }
  toggle(c, on) {
    if (on === undefined) on = !this.set.has(c);
    on ? this.set.add(c) : this.set.delete(c);
  }
  contains(c) {
    return this.set.has(c);
  }
}

class El {
  constructor(tag = "div", id = null) {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this.parent = null;
    this.style = {};
    this.classList = new ClassList();
    this.attrs = {};
    this.listeners = {};
    this.hidden = false;
    this.clientWidth = 800;
    this.scrollTop = 0;
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this._named = {};
  }
  set className(v) {
    this.classList = new ClassList();
    String(v)
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => this.classList.add(c));
  }
  get className() {
    return [...this.classList.set].join(" ");
  }
  get offsetHeight() {
    return 0;
  }
  appendChild(c) {
    if (c.isFragment) {
      c.children.splice(0).forEach((k) => this.appendChild(k));
      return c;
    }
    c.parent = this;
    this.children.push(c);
    return c;
  }
  insertBefore(c) {
    return this.appendChild(c);
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((k) => k !== this);
    this.parent = null;
  }
  descendants() {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  querySelectorAll(sel) {
    if (sel === ".page")
      return this.descendants().filter((e) => e.classList.contains("page"));
    if (sel === ".page img")
      return this.querySelectorAll(".page").flatMap((p) =>
        p.children.filter((c) => c.tagName === "IMG"),
      );
    return [];
  }
  querySelector(sel) {
    return (this._named[sel] ||= new El("span"));
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
  }
  dispatch(type, ev = {}) {
    (this.listeners[type] || []).slice().forEach((f) => f(ev));
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === "srcdoc") this.srcdoc = v;
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  removeAttribute(k) {
    delete this.attrs[k];
    if (k === "srcdoc") this._srcdoc = undefined;
  }
  set srcdoc(v) {
    this._srcdoc = v;
    setImmediate(() => this.dispatch("load"));
  }
  get srcdoc() {
    return this._srcdoc;
  }
  get contentWindow() {
    return {
      document: { querySelectorAll: () => [], body: null },
      scrollY: 0,
      scrollTo() {},
    };
  }
  getContext() {
    return {};
  }
  toBlob(cb) {
    setImmediate(() => cb({ size: 1 }));
  }
  focus() {}
  click() {}
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createClient({ viewMode = "continuous", markdown = "# Hello" } = {}) {
  const els = {};
  const byId = (id) => (els[id] ||= new El("div", id));
  byId("continuousFrameA").tagName = "IFRAME";
  byId("continuousFrameB").tagName = "IFRAME";

  const fetches = [];
  const pdfDocs = [];
  let blobUrls = 0;
  const revoked = [];

  const storage = { "mdtopdf-view": viewMode };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    setImmediate,
    queueMicrotask,
    Promise,
    Error,
    JSON,
    Math,
    String,
    Number,
    Array,
    localStorage: {
      getItem: (k) => storage[k] ?? null,
      setItem: (k, v) => (storage[k] = String(v)),
    },
    document: {
      getElementById: byId,
      createElement: (tag) => new El(tag),
      createDocumentFragment: () =>
        Object.assign(new El(), { isFragment: true }),
      body: new El("body"),
    },
    URL: {
      createObjectURL: () => "blob:" + ++blobUrls,
      revokeObjectURL: (u) => revoked.push(u),
    },
    matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }),
    devicePixelRatio: 1,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (f) => setImmediate(f),
    cancelAnimationFrame: () => {},
    fetch(url, init) {
      const d = deferred();
      const body = JSON.parse(init.body);
      fetches.push({ url, body, ...d });
      return d.promise;
    },
    pdfjsLib: {
      GlobalWorkerOptions: {},
      getDocument({ data }) {
        const doc = {
          source: data,
          numPages: 1,
          destroyed: false,
          pageRender: deferred(),
          async getPage() {
            return {
              getViewport: ({ scale }) => ({
                width: 595 * scale,
                height: 842 * scale,
              }),
              render: () => ({ promise: doc.pageRender.promise }),
              cleanup() {},
            };
          },
          destroy() {
            doc.destroyed = true;
          },
        };
        pdfDocs.push(doc);
        return { promise: Promise.resolve(doc) };
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  vm.createContext(sandbox);

  vm.runInContext('let theme = "light"; let fontSize = 14;', sandbox);
  for (const f of ["main.js", "preview.js", "pdf.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, {
      filename: f,
    });
  }
  vm.runInContext("var refreshCloudState = () => {};", sandbox);

  const run = (code) => vm.runInContext(code, sandbox);
  run(`editor.value = ${JSON.stringify(markdown)}`);
  run(`proof.hidden = ${viewMode !== "pages"}`);
  run(`proofContinuous.hidden = ${viewMode === "pages"}`);

  const client = {
    run,
    els,
    fetches,
    pdfDocs,
    revoked,
    pending: () => fetches.filter((f) => !f.settled),
    setMarkdown: (md) => run(`editor.value = ${JSON.stringify(md)}`),
    setTheme: (t) => run(`theme = ${JSON.stringify(t)}`),
    renderPreview: () => run("renderPreview()"),
    status: () => byId("status").textContent,
    emptyText: (id) =>
      byId(id).querySelector(".empty-title").textContent +
      " — " +
      byId(id).querySelector(".empty-sub").textContent,
    pages: () => byId("proof").querySelectorAll(".page"),
    respond(i) {
      const f = fetches[i];
      f.settled = true;
      const md = f.body.markdown;
      const key = f.body.theme + ":" + md;
      f.resolve({
        ok: true,
        status: 200,
        text: async () => "<html><head></head><body>" + key + "</body></html>",
        blob: async () => ({ arrayBuffer: async () => key }),
      });
    },
    fail(i, status, text) {
      const f = fetches[i];
      f.settled = true;
      f.resolve({ ok: false, status, text: async () => text });
    },
  };
  return client;
}

async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

module.exports = { createClient, settle };
