const toolbarCloudGroup = document.getElementById("toolbarCloudGroup");
const newDocBtn = document.getElementById("newDocBtn");

const docTitleLabel = document.getElementById("docTitleLabel");
const docTitleName = document.getElementById("docTitleName");
const docTitleDivider = document.getElementById("docTitleDivider");

const cloudBtn = document.getElementById("cloudBtn");
const cloudBtnLabel = document.getElementById("cloudBtnLabel");

const pane = document.querySelector(".pane.source .editor");

const saveDialogOverlay = document.getElementById("saveDialogOverlay");
const saveDialogName = document.getElementById("saveDialogName");
const saveDialogCancelBtn = document.getElementById("saveDialogCancelBtn");
const saveDialogConfirmBtn = document.getElementById("saveDialogConfirmBtn");

const documentsPage = document.getElementById("documentsPage");
const documentsSubtitle = document.getElementById("documentsSubtitle");
const documentsSearchWrap = document.getElementById("documentsSearchWrap");
const documentsSearchInput = document.getElementById("documentsSearchInput");
const documentsNotice = document.getElementById("documentsNotice");
const documentsNoticeText = document.getElementById("documentsNoticeText");
const documentsNoticeDismiss = document.getElementById(
  "documentsNoticeDismiss",
);
const documentsBulkBar = document.getElementById("documentsBulkBar");
const documentsBulkCount = document.getElementById("documentsBulkCount");
const documentsBulkClearBtn = document.getElementById("documentsBulkClearBtn");
const documentsBulkDeleteBtn = document.getElementById(
  "documentsBulkDeleteBtn",
);
const documentsBody = document.getElementById("documentsBody");

let currentView = "editor";

let currentDocId = null;
let currentDocTitle = "";
let lastSavedSnapshot = "";
let cloudState = "unsaved";
let saveInFlight = false;
let docGeneration = 0;
let loadToken = 0;

let documents = [];
let documentsLoaded = false;
let documentsLoading = false;
let docSearch = "";
let selectedDocIds = new Set();

let pendingNewTitle = "";
let closeRowMenu = () => {};

const KEBAB_ICON =
  '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3.4" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="8" cy="12.6" r="1.3"/></svg>';
const OPEN_ICON =
  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M2 6h6.5M5.5 3 8.5 6l-3 3"/></svg>';
const RENAME_ICON =
  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M7.5 2 10 4.5 4 10.5H1.5V8Z"/></svg>';
const DELETE_ICON =
  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" width="12" height="12"><path d="M3 3l6 6M9 3l-6 6"/></svg>';

function mapDocError() {
  return "Something went wrong. Check your connection and try again.";
}

function setDocTitle(title) {
  currentDocTitle = title;
  docTitleName.textContent = title || "Untitled";
  const saved = !!currentDocId;
  docTitleLabel.hidden = !saved;
  docTitleDivider.hidden = !saved;
  newDocBtn.hidden = !saved;
}

function syncCloudBtnDisabled() {
  cloudBtn.disabled =
    sessionLoading || cloudState === "saving" || cloudState === "saved";
}

function setCloudState(state) {
  cloudState = state;
  cloudBtn.className = "cloud-btn " + state;
  syncCloudBtnDisabled();
  cloudBtnLabel.textContent =
    state === "saving"
      ? "Saving…"
      : state === "error"
        ? "Couldn't save — Retry"
        : state === "saved"
          ? "Saved to Documents"
          : "Save to mdtopdf";
}
function refreshCloudState() {
  if (cloudState === "saving") return;
  if (!currentDocId) setCloudState("unsaved");
  else if (editor.value !== lastSavedSnapshot) setCloudState("dirty");
  else setCloudState("saved");
}
function hasUnsavedWork() {
  return (
    cloudState === "dirty" ||
    cloudState === "error" ||
    (cloudState === "unsaved" &&
      editor.value.trim() !== "" &&
      editor.value !== sample)
  );
}

cloudBtn.addEventListener("click", () => {
  if (cloudState === "saving") return;
  if (!session) {
    pendingSaveIntent = true;
    openAuthModal("signin");
    return;
  }
  proceedSave();
});
function proceedSave() {
  if (currentDocId) performSave(currentDocTitle);
  else openSaveDialog();
}

function openSaveDialog() {
  saveDialogName.value = currentDocTitle || pendingNewTitle || "Untitled";
  saveDialogOverlay.classList.add("show");
  setTimeout(() => {
    saveDialogName.focus();
    saveDialogName.select();
  }, 0);
}
function closeSaveDialog() {
  saveDialogOverlay.classList.remove("show");
}
saveDialogCancelBtn.addEventListener("click", closeSaveDialog);
saveDialogOverlay.addEventListener("mousedown", (e) => {
  if (e.target === saveDialogOverlay) closeSaveDialog();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && saveDialogOverlay.classList.contains("show"))
    closeSaveDialog();
});
saveDialogName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveDialogConfirmBtn.click();
  }
});
saveDialogConfirmBtn.addEventListener("click", () => {
  const name = (saveDialogName.value || "").trim() || "Untitled";
  closeSaveDialog();
  performSave(name);
});

async function performSave(title) {
  if (!session || saveInFlight) return;
  const docIdAtStart = currentDocId;
  const genAtStart = docGeneration;
  const content = editor.value;
  saveInFlight = true;
  setCloudState("saving");
  try {
    let newId = null;
    if (docIdAtStart) {
      const { error } = await supabase
        .from("drafts")
        .update({
          title,
          content,
          updated_at: new Date().toISOString(),
        })
        .eq("id", docIdAtStart);
      if (error) throw error;
    } else {
      const { data, error } = await supabase
        .from("drafts")
        .insert({ title, content, user_id: session.user.id })
        .select("id")
        .single();
      if (error) throw error;
      newId = data.id;
    }
    if (genAtStart === docGeneration) {
      currentDocId = docIdAtStart || newId;
      setDocTitle(title);
      pendingNewTitle = "";
      lastSavedSnapshot = content;
      setCloudState("saved");
    }
    documentsLoaded = false;
    if (currentView === "documents") loadDocumentsIfNeeded(true);
  } catch (err) {
    console.error(err);
    if (genAtStart === docGeneration) {
      if (!docIdAtStart) pendingNewTitle = title;
      setCloudState("error");
    }
  } finally {
    saveInFlight = false;
  }
}

function newDocument() {
  currentDocId = null;
  setDocTitle("");
  pendingNewTitle = "";
  docGeneration++;
  filename.value = "";
  editor.value = "";
  renderHighlight();
  schedulePreview();
  lastSavedSnapshot = "";
  setCloudState("unsaved");
  editor.focus();
}
function triggerNewDocument() {
  if (hasUnsavedWork()) {
    openConfirm({
      title: "Discard unsaved changes?",
      body: "You have unsaved changes. Discard and create a new document?",
      actionLabel: "Create new document",
      onConfirm: () => {
        newDocument();
        showEditorView();
      },
    });
  } else {
    newDocument();
    showEditorView();
  }
}
newDocBtn.addEventListener("click", triggerNewDocument);

function loadDocument(id) {
  if (id !== currentDocId && hasUnsavedWork()) {
    openConfirm({
      title: "Discard unsaved changes?",
      body: "You have unsaved changes. Discard them and open this document?",
      actionLabel: "Open document",
      onConfirm: () => {
        openDocument(id);
      },
    });
    return;
  }
  return openDocument(id);
}
async function openDocument(id) {
  showEditorView();
  if (id === currentDocId) return;
  const token = ++loadToken;
  docGeneration++;
  pane.classList.add("doc-switching");
  const { data, error } = await supabase
    .from("drafts")
    .select("id,title,content")
    .eq("id", id)
    .single();
  if (token !== loadToken) return;
  pane.classList.remove("doc-switching");
  if (error) {
    console.error(error);
    showDocumentsNotice(mapDocError());
    return;
  }
  currentDocId = data.id;
  setDocTitle(data.title || "Untitled");
  pendingNewTitle = "";
  editor.value = data.content || "";
  renderHighlight();
  schedulePreview();
  lastSavedSnapshot = editor.value;
  setCloudState("saved");
}

function resetEditorForSignOut() {
  currentDocId = null;
  setDocTitle("");
  pendingNewTitle = "";
  docGeneration++;
  documents = [];
  documentsLoaded = false;
  selectedDocIds.clear();
  docSearch = "";
  documentsSearchInput.value = "";
  filename.value = "";
  editor.value = "";
  renderHighlight();
  schedulePreview();
  lastSavedSnapshot = "";
  setCloudState("unsaved");
  if (currentView === "documents") renderDocumentsPage();
}

function showDocumentsNotice(msg) {
  documentsNoticeText.textContent = msg;
  documentsNotice.hidden = false;
  clearTimeout(showDocumentsNotice._t);
  showDocumentsNotice._t = setTimeout(() => {
    documentsNotice.hidden = true;
  }, 5000);
}
documentsNoticeDismiss.addEventListener("click", () => {
  documentsNotice.hidden = true;
  clearTimeout(showDocumentsNotice._t);
});

async function loadDocumentsIfNeeded(force) {
  if (!session) return;
  if (documentsLoaded && !force) return;
  documentsLoading = true;
  if (currentView === "documents") renderDocumentsPage();
  const { data, error } = await supabase
    .from("drafts")
    .select("id,title,content,updated_at")
    .order("updated_at", { ascending: false });
  documentsLoading = false;
  if (error) {
    console.error(error);
    showDocumentsNotice(mapDocError());
    if (currentView === "documents") renderDocumentsPage();
    return;
  }
  documents = data || [];
  documentsLoaded = true;
  const liveIds = new Set(documents.map((d) => d.id));
  selectedDocIds.forEach((id) => {
    if (!liveIds.has(id)) selectedDocIds.delete(id);
  });
  if (currentView === "documents") renderDocumentsPage();
}

function formatModified(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (diffDays === 0) return "Today, " + time;
  if (diffDays === 1) return "Yesterday, " + time;
  if (d.getFullYear() === now.getFullYear())
    return (
      d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }) +
      ", " +
      time
    );
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function formatSize(content) {
  const bytes = new TextEncoder().encode(content || "").length;
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024)
    return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function renderDocumentsSkeleton() {
  documentsBody.innerHTML = "";
  const table = document.createElement("div");
  table.className = "documents-table";
  for (let i = 0; i < 5; i++) {
    const row = document.createElement("div");
    row.className = "documents-skeleton-row";
    row.innerHTML = '<span class="sk title"></span>';
    table.appendChild(row);
  }
  documentsBody.appendChild(table);
}
function renderDocumentsEmpty() {
  documentsBody.innerHTML =
    '<div class="documents-empty"><h2>No documents yet</h2>' +
    "<p>Save your first Markdown document to access it from anywhere.</p></div>";
}
function renderDocumentsNoMatch() {
  documentsBody.innerHTML =
    '<div class="documents-empty"><h2>No matches</h2><p>No documents match “' +
    esc(docSearch.trim()) +
    "”.</p></div>";
}
function renderDocumentsSignedOut() {
  documentsBody.innerHTML =
    '<div class="documents-signedout"><h2>Your documents</h2>' +
    "<p>Sign in to save and access your Markdown documents across sessions.</p>" +
    '<button type="button" class="documents-empty-btn" id="documentsSignInBtn">Sign in</button></div>';
  document
    .getElementById("documentsSignInBtn")
    .addEventListener("click", () => openAuthModal("signin"));
}

function startRowRename(doc, titleEl) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "documents-name-edit";
  input.value = doc.title || "";
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  async function commit() {
    if (done) return;
    done = true;
    const newTitle = (input.value || "Untitled").trim() || "Untitled";
    input.replaceWith(titleEl);
    titleEl.textContent = newTitle;
    if (newTitle === doc.title) return;
    const prevTitle = doc.title;
    doc.title = newTitle;
    if (doc.id === currentDocId) setDocTitle(newTitle);
    const { error } = await supabase
      .from("drafts")
      .update({ title: newTitle, updated_at: new Date().toISOString() })
      .eq("id", doc.id);
    if (error) {
      console.error(error);
      doc.title = prevTitle;
      titleEl.textContent = prevTitle || "Untitled";
      if (doc.id === currentDocId) setDocTitle(prevTitle);
      showDocumentsNotice(mapDocError());
    } else {
      doc.updated_at = new Date().toISOString();
      renderDocumentsPage();
    }
  }
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    }
    if (e.key === "Escape") {
      done = true;
      input.replaceWith(titleEl);
    }
  });
  input.addEventListener("blur", commit);
}

function requestDeleteDocument(id) {
  openConfirm({
    title: "Delete document?",
    body: "This action cannot be undone.",
    actionLabel: "Delete",
    onConfirm: () => deleteDocument(id),
  });
}
async function deleteDocument(id) {
  const { data, error } = await supabase
    .from("drafts")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) {
    console.error(error);
    showDocumentsNotice(mapDocError());
    throw error;
  }
  if (!data || !data.length) {
    console.error("delete affected 0 rows for id " + id);
    showDocumentsNotice("Couldn't delete — you may not have permission.");
    throw new Error("delete affected 0 rows");
  }
  documents = documents.filter((d) => d.id !== id);
  selectedDocIds.delete(id);
  if (id === currentDocId) {
    currentDocId = null;
    setDocTitle("");
    docGeneration++;
    refreshCloudState();
  }
  renderDocumentsPage();
}

function requestBulkDelete() {
  const ids = Array.from(selectedDocIds);
  if (!ids.length) return;
  openConfirm({
    title: `Delete ${ids.length} document${ids.length === 1 ? "" : "s"}?`,
    body: "This action cannot be undone.",
    actionLabel: "Delete",
    onConfirm: () => bulkDeleteDocuments(ids),
  });
}
async function bulkDeleteDocuments(ids) {
  const { data, error } = await supabase
    .from("drafts")
    .delete()
    .in("id", ids)
    .select("id");
  if (error) {
    console.error(error);
    showDocumentsNotice(mapDocError());
    throw error;
  }
  const deletedIds = new Set((data || []).map((r) => r.id));
  documents = documents.filter((d) => !deletedIds.has(d.id));
  ids.forEach((id) => selectedDocIds.delete(id));
  if (deletedIds.has(currentDocId)) {
    currentDocId = null;
    setDocTitle("");
    docGeneration++;
    refreshCloudState();
  }
  if (deletedIds.size < ids.length) {
    showDocumentsNotice(
      "Some documents couldn't be deleted — you may not have permission.",
    );
  }
  renderDocumentsPage();
}
documentsBulkClearBtn.addEventListener("click", () => {
  selectedDocIds.clear();
  renderDocumentsPage();
});
documentsBulkDeleteBtn.addEventListener("click", requestBulkDelete);

function toggleRowMenu(kebabBtn, doc, titleEl) {
  const wasThis = kebabBtn.classList.contains("open");
  closeRowMenu();
  if (wasThis) return;
  kebabBtn.classList.add("open");
  const menu = document.createElement("div");
  menu.className = "documents-row-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML =
    '<button type="button" data-act="open">' +
    OPEN_ICON +
    "Open</button>" +
    '<button type="button" data-act="rename">' +
    RENAME_ICON +
    "Rename</button>" +
    '<button type="button" class="danger" data-act="delete">' +
    DELETE_ICON +
    "Delete</button>";
  document.body.appendChild(menu);
  const rect = kebabBtn.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.right = `${window.innerWidth - rect.right}px`;
  menu.querySelector('[data-act="open"]').addEventListener("click", (e) => {
    e.stopPropagation();
    closeRowMenu();
    loadDocument(doc.id);
  });
  menu.querySelector('[data-act="rename"]').addEventListener("click", (e) => {
    e.stopPropagation();
    closeRowMenu();
    startRowRename(doc, titleEl);
  });
  menu.querySelector('[data-act="delete"]').addEventListener("click", (e) => {
    e.stopPropagation();
    closeRowMenu();
    requestDeleteDocument(doc.id);
  });
  function onDocClick(e) {
    if (!menu.contains(e.target) && e.target !== kebabBtn) closeRowMenu();
  }
  document.addEventListener("click", onDocClick);
  closeRowMenu = () => {
    kebabBtn.classList.remove("open");
    menu.remove();
    document.removeEventListener("click", onDocClick);
    closeRowMenu = () => {};
  };
}

function renderDocumentsTable(list) {
  documentsBody.innerHTML = "";
  const table = document.createElement("div");
  table.className = "documents-table";

  const head = document.createElement("div");
  head.className = "documents-table-head";
  head.innerHTML =
    '<span class="documents-col-check"><input type="checkbox" id="documentsSelectAll" aria-label="Select all"></span>' +
    "<span>Name</span><span>Date</span>" +
    '<span class="documents-col-size">Size</span><span></span>';
  table.appendChild(head);
  const selectAllCb = head.querySelector("#documentsSelectAll");
  const allSelected =
    list.length > 0 && list.every((d) => selectedDocIds.has(d.id));
  selectAllCb.checked = allSelected;
  selectAllCb.indeterminate =
    !allSelected && list.some((d) => selectedDocIds.has(d.id));
  selectAllCb.addEventListener("change", () => {
    if (selectAllCb.checked) list.forEach((d) => selectedDocIds.add(d.id));
    else list.forEach((d) => selectedDocIds.delete(d.id));
    renderDocumentsPage();
  });

  for (const d of list) {
    const row = document.createElement("div");
    row.className = "documents-row";
    row.addEventListener("click", () => loadDocument(d.id));

    const checkWrap = document.createElement("div");
    checkWrap.className = "documents-col-check";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedDocIds.has(d.id);
    checkbox.setAttribute("aria-label", "Select " + (d.title || "Untitled"));
    checkbox.addEventListener("click", (e) => e.stopPropagation());
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedDocIds.add(d.id);
      else selectedDocIds.delete(d.id);
      renderDocumentsPage();
    });
    checkWrap.appendChild(checkbox);

    const nameWrap = document.createElement("div");
    nameWrap.className = "documents-name";
    const title = document.createElement("div");
    title.className = "documents-name-title";
    title.textContent = d.title || "Untitled";
    nameWrap.appendChild(title);

    const modified = document.createElement("div");
    modified.className = "documents-col-modified";
    modified.textContent = formatModified(d.updated_at);

    const size = document.createElement("div");
    size.className = "documents-col-size";
    size.textContent = formatSize(d.content);

    const menuWrap = document.createElement("div");
    menuWrap.className = "documents-row-menu-wrap";
    const kebab = document.createElement("button");
    kebab.type = "button";
    kebab.className = "documents-kebab";
    kebab.setAttribute("aria-label", "Document actions");
    kebab.innerHTML = KEBAB_ICON;
    kebab.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleRowMenu(kebab, d, title);
    });
    menuWrap.appendChild(kebab);

    row.appendChild(checkWrap);
    row.appendChild(nameWrap);
    row.appendChild(modified);
    row.appendChild(size);
    row.appendChild(menuWrap);
    table.appendChild(row);
  }
  documentsBody.appendChild(table);
}

function updateBulkBar() {
  const count = selectedDocIds.size;
  documentsBulkBar.hidden = count === 0;
  documentsBulkCount.textContent =
    count + (count === 1 ? " document selected" : " documents selected");
}

function renderDocumentsPage() {
  const signedIn = !!session && !sessionLoading;
  documentsSearchWrap.hidden = !(
    signedIn &&
    documentsLoaded &&
    documents.length > 0
  );
  if (sessionLoading) {
    renderDocumentsSkeleton();
    return;
  }
  if (!signedIn) {
    selectedDocIds.clear();
    updateBulkBar();
    renderDocumentsSignedOut();
    return;
  }
  if (documentsLoading && !documentsLoaded) {
    renderDocumentsSkeleton();
    return;
  }
  if (!documents.length) {
    selectedDocIds.clear();
    updateBulkBar();
    renderDocumentsEmpty();
    return;
  }
  const q = docSearch.trim().toLowerCase();
  const visible = q
    ? documents.filter((d) => (d.title || "Untitled").toLowerCase().includes(q))
    : documents;
  updateBulkBar();
  if (!visible.length) {
    renderDocumentsNoMatch();
    return;
  }
  renderDocumentsTable(visible);
}

documentsSearchInput.addEventListener("input", () => {
  docSearch = documentsSearchInput.value;
  renderDocumentsPage();
});
