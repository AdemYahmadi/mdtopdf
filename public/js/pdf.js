let inflightConvert = null;
let convertSeq = 0,
  lastBlobSeq = 0;
function convert() {
  const key = keyOf();
  if (inflightConvert && inflightConvert.key === key)
    return inflightConvert.promise;
  const seq = ++convertSeq;
  const promise = (async () => {
    const res = await fetch("/api/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: editor.value, fontSize, theme }),
    });
    if (!res.ok) throw await responseError(res);
    return res.blob();
  })();
  const entry = { key, promise };
  inflightConvert = entry;
  promise.then(
    (blob) => {
      if (inflightConvert === entry) inflightConvert = null;
      if (seq > lastBlobSeq) {
        lastBlobSeq = seq;
        lastBlob = blob;
        lastBlobKey = key;
      }
    },
    () => {
      if (inflightConvert === entry) inflightConvert = null;
    },
  );
  return promise;
}

let shownBlob = null;
function clearPages() {
  shownBlob = null;
  proof.querySelectorAll(".page img").forEach((img) => {
    if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
  });
  proof.querySelectorAll(".page").forEach((p) => p.remove());
}

let displaySeq = 0;
let resizeTimer = null,
  lastWidth = 0,
  lastRenderDpr = 0;

async function displayPdf(blob) {
  const seq = ++displaySeq;
  const containerWidth = proof.clientWidth;
  if (!containerWidth) {
    shownBlob = blob;
    lastWidth = 0;
    return;
  }
  const targetCssWidth = containerWidth * 0.86;
  const outputScale = window.devicePixelRatio || 1;
  lastWidth = containerWidth;
  lastRenderDpr = outputScale;

  const buf = await blob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const fragment = document.createDocumentFragment();
  const urls = [];

  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      if (seq !== displaySeq) break;
      const page = await pdf.getPage(i);
      const unscaledVp = page.getViewport({ scale: 1 });
      const baseScale = targetCssWidth / unscaledVp.width;
      const physW = Math.round(unscaledVp.width * baseScale * outputScale);
      const physH = Math.round(unscaledVp.height * baseScale * outputScale);
      const cssW = physW / outputScale;
      const cssH = physH / outputScale;

      const offscreen = document.createElement("canvas");
      offscreen.width = physW;
      offscreen.height = physH;

      const exactScale = physW / unscaledVp.width;
      const viewport = page.getViewport({ scale: exactScale });

      await page.render({
        canvasContext: offscreen.getContext("2d", { alpha: false }),
        viewport,
      }).promise;
      page.cleanup();

      const pageBlob = await new Promise((res) =>
        offscreen.toBlob(res, "image/png"),
      );
      offscreen.width = offscreen.height = 0;
      if (!pageBlob)
        throw new Error(`Couldn't rasterize page ${i} (${physW}×${physH}px)`);

      const img = document.createElement("img");
      img.style.width = cssW + "px";
      img.style.height = cssH + "px";
      img.style.display = "block";
      img.addEventListener("load", () => img.classList.add("loaded"), {
        once: true,
      });
      img.src = URL.createObjectURL(pageBlob);
      urls.push(img.src);

      const wrapper = document.createElement("div");
      wrapper.className = "page";
      wrapper.appendChild(img);
      fragment.appendChild(wrapper);
    }
  } catch (err) {
    urls.forEach((u) => URL.revokeObjectURL(u));
    throw err;
  } finally {
    pdf.destroy();
  }

  if (seq !== displaySeq) {
    urls.forEach((u) => URL.revokeObjectURL(u));
    return;
  }
  const scrollTop = proof.scrollTop;
  clearPages();
  shownBlob = blob;
  proof.insertBefore(fragment, emptyMsg);
  proof.scrollTop = scrollTop;
}

function onViewChange() {
  if (!shownBlob || proof.hidden) return;
  const w = proof.clientWidth;
  if (!w) return;
  const d = window.devicePixelRatio || 1;
  if (w === lastWidth && d === lastRenderDpr) return;
  lastWidth = w;
  lastRenderDpr = d;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(
    () => displayPdf(shownBlob).catch((err) => console.error(err)),
    250,
  );
}
window.addEventListener("resize", onViewChange);
(function watchDpr() {
  const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  mq.addEventListener("change", function once() {
    mq.removeEventListener("change", once);
    onViewChange();
    watchDpr();
  });
})();

async function renderPdf() {
  if (!editor.value.trim()) {
    displaySeq++;
    renderedKey = null;
    clearPages();
    showEmpty("Empty document — start typing");
    setStatus("Ready");
    return;
  }
  if (keyOf() === renderedKey) {
    setStatus("Ready");
    return;
  }
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  const key = keyOf();
  let converted = false;
  setStatus("Rendering…", "busy");
  try {
    const blob = await convert();
    converted = true;
    renderedKey = key;
    showEmpty(null);
    await displayPdf(blob);
    setStatus("Ready");
  } catch (err) {
    console.error(err);
    renderedKey = null;
    if (key !== keyOf()) return;
    displaySeq++;
    clearPages();
    showEmpty(
      converted
        ? describeFailure("Couldn't display PDF preview", err)
        : describeFailure("Couldn't generate PDF preview", err),
    );
    setStatus("Conversion failed", "error");
  } finally {
    busy = false;
    if (again || key !== keyOf()) {
      again = false;
      renderPreview();
    }
  }
}

function outName() {
  let n = (filename.value || "document")
    .trim()
    .replace(/[\/\\:*?"<>|]+/g, "")
    .replace(/\.pdf$/i, "");
  return (n || "document") + ".pdf";
}
function save(blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = outName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
async function download() {
  if (!editor.value.trim()) {
    flashStatus("Nothing to download");
    return;
  }
  if (downloadBtn.disabled) return;
  downloadBtn.disabled = true;
  const needsConvert = !lastBlob || lastBlobKey !== keyOf();
  if (needsConvert) downloadBtn.classList.add("loading");
  try {
    let blob = lastBlob;
    if (needsConvert) {
      setStatus("Preparing PDF…", "busy");
      blob = await convert();
    }
    save(blob);
    flashStatus("Saved " + outName());
    downloadBtn.classList.remove("loading");
    downloadBtn.classList.add("success");
    setTimeout(() => downloadBtn.classList.remove("success"), 1100);
  } catch (err) {
    setStatus("Conversion failed", "error");
    console.error(err);
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.classList.remove("loading");
  }
}
downloadBtn.addEventListener("click", download);
window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    download();
  }
});
