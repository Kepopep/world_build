// Bootstrap/wiring for the app shell: world picker, a folder/entry tree
// sidebar (see sidebar.js), a title+summary+markdown editor (see editor.js),
// the tag pill row (see tags.js), the far-left/far-right icon rails, the
// three right-rail panels (outline.js/backlinks.js/graph.js's embedded entry
// panel), the top-bar world search (search.js), and the theme toggle
// (theme.js -- self-initializing, not wired from here).

const state = {
  worlds: [],
  selectedWorldId: null,
  folders: [],
  entries: [],
  openEntryId: null,
  dirty: false,
  // Entries open read-only by default -- text is not editable just because
  // it was opened (or just created); the user must click Edit first.
  editing: false,
  // Which right-rail panel is open, if any -- "outline" | "backlinks" |
  // "entry-graph" | null. Pure presentation state, same reasoning as
  // sidebar.js's collapsedFolderIds: only one panel is ever visible at a
  // time (see togglePanel()).
  rightPanel: null,
  // "Generate with AI" model picker -- fetched lazily the first time the
  // form is opened (models aren't world-scoped, so this only needs to
  // happen once per page load) rather than eagerly at startup.
  aiModels: [],
  aiModelsLoaded: false,
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  els.worldSelect = document.getElementById("world-select");
  els.newWorldName = document.getElementById("new-world-name");
  els.newWorldBtn = document.getElementById("new-world-btn");
  els.entryTree = document.getElementById("entry-tree");
  els.newFolderBtn = document.getElementById("new-folder-btn");
  els.newEntryBtn = document.getElementById("new-entry-btn");
  els.generateAiBtn = document.getElementById("generate-ai-btn");
  els.aiGenerateForm = document.getElementById("ai-generate-form");
  els.aiGeneratePrompt = document.getElementById("ai-generate-prompt");
  els.aiGenerateModel = document.getElementById("ai-generate-model");
  els.aiGenerateModelSearch = document.getElementById("ai-generate-model-search");
  els.aiGenerateSubmitBtn = document.getElementById("ai-generate-submit-btn");
  els.aiGenerateCancelBtn = document.getElementById("ai-generate-cancel-btn");
  els.aiGenerateStatus = document.getElementById("ai-generate-status");
  els.editor = document.getElementById("editor");
  els.editorEmpty = document.getElementById("editor-empty");
  els.breadcrumb = document.getElementById("breadcrumb");
  els.entryTitle = document.getElementById("entry-title");
  els.entryContent = document.getElementById("entry-content");
  els.entryContentOverlay = document.getElementById("entry-content-overlay");
  els.entryContentWrapper = document.getElementById("entry-content-wrapper");
  els.entryContentPreview = document.getElementById("entry-content-preview");
  els.wikilinkAutocomplete = document.getElementById("wikilink-autocomplete");
  els.markdownToolbar = document.getElementById("markdown-toolbar");
  els.editorWordCount = document.getElementById("editor-word-count");
  els.entryTags = document.getElementById("entry-tags");
  els.editToggleBtn = document.getElementById("edit-toggle-btn");
  els.saveBtn = document.getElementById("save-btn");
  els.deleteBtn = document.getElementById("delete-btn");
  els.entryGraphBtn = document.getElementById("entry-graph-btn");
  els.worldGraphBtn = document.getElementById("world-graph-btn");
  els.graphModal = document.getElementById("graph-modal");
  els.graphModalClose = document.getElementById("graph-modal-close");
  els.graphModalTitle = document.getElementById("graph-modal-title");
  els.graphRecenterBtn = document.getElementById("graph-recenter-btn");
  els.statusMessage = document.getElementById("status-message");

  // Entry header (icon/title/summary) + metadata.
  els.entryIcon = document.getElementById("entry-icon");
  els.entrySummary = document.getElementById("entry-summary");
  els.entryTimestamps = document.getElementById("entry-timestamps");

  // Theme toggle is self-initializing (js/theme.js) -- nothing to wire here.

  // Top-bar search.
  els.searchInput = document.getElementById("search-input");
  els.searchResults = document.getElementById("search-results");

  // Far-left view-switcher rail -- "notes" and "graph" are the only two
  // modes that exist; there is no library/database view.
  els.railGraphBtn = document.getElementById("rail-graph-btn");

  // Far-right panel-toggle rail + the panel host.
  els.rightPanel = document.getElementById("right-panel");
  els.railOutlineToggleBtn = document.getElementById("rail-outline-toggle-btn");
  els.railBacklinksToggleBtn = document.getElementById("rail-backlinks-toggle-btn");
  els.railEntryGraphToggleBtn = document.getElementById("rail-entry-graph-toggle-btn");
  els.outlinePanel = document.getElementById("outline-panel");
  els.outlinePanelBody = document.getElementById("outline-panel-body");
  els.backlinksPanel = document.getElementById("backlinks-panel");
  els.backlinksPanelBody = document.getElementById("backlinks-panel-body");
  els.entryGraphPanel = document.getElementById("entry-graph-panel");

  els.worldSelect.addEventListener("change", onWorldSelected);
  els.newWorldBtn.addEventListener("click", onCreateWorld);
  els.newFolderBtn.addEventListener("click", onCreateFolder);
  // Wrapped rather than passed directly -- onCreateEntry now takes an
  // optional folderId, and addEventListener would otherwise hand it the
  // click MouseEvent as that argument.
  els.newEntryBtn.addEventListener("click", () => onCreateEntry());
  els.generateAiBtn.addEventListener("click", onOpenAiGenerateForm);
  els.aiGenerateCancelBtn.addEventListener("click", onCancelAiGenerate);
  els.aiGenerateModelSearch.addEventListener("input", () => renderAiModelOptions(els.aiGenerateModelSearch.value));
  els.aiGenerateSubmitBtn.addEventListener("click", onGenerateEntry);
  els.editToggleBtn.addEventListener("click", onToggleEditing);
  els.saveBtn.addEventListener("click", onSaveEntry);
  els.deleteBtn.addEventListener("click", () => onDeleteEntry(state.openEntryId));
  els.entryGraphBtn.addEventListener("click", onOpenEntryGraph);
  els.worldGraphBtn.addEventListener("click", onOpenWorldGraph);
  els.graphModalClose.addEventListener("click", () => window.graph.close());
  // Resets only the camera (pan/zoom) back to the default framed view --
  // the graph's own force-layout shape is untouched, see js/graph.js's
  // recenter(). A plain click handler, not gated on anything, since the
  // button only exists inside the modal to begin with (it's only reachable
  // while the modal is open).
  els.graphRecenterBtn.addEventListener("click", () => window.graph.recenter());
  // Click-outside-to-close: #graph-modal is the full-screen dimmed overlay,
  // .modal-panel the actual box inside it -- a click only reaches the
  // overlay's own listener as event.target === els.graphModal when it
  // didn't land on (and bubble up from) the panel or anything in it,
  // exactly the "outside the panel" case. Guards against the graph canvas's
  // own click handling (node click-to-navigate, drag) already having
  // stopped/consumed the event -- those never bubble this far as a plain
  // click on the overlay itself.
  els.graphModal.addEventListener("click", (e) => {
    if (e.target === els.graphModal) {
      window.graph.close();
    }
  });
  // Escape closes the graph modal from anywhere (the canvas has no natural
  // focus target to hang a scoped keydown listener off of, unlike the
  // title/summary/content Escape handling below) -- scoped to only act
  // while the modal is actually open so it never interferes with editor.js's
  // own Escape handling (autocomplete-close / exit-edit-mode) elsewhere.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.graphModal.hidden) {
      window.graph.close();
    }
  });
  // Title input also drives the header avatar's letter/color live, not just
  // on the next openEntry()/save -- see renderEntryAvatar().
  els.entryTitle.addEventListener("input", () => {
    markDirty();
    renderEntryAvatar({ title: els.entryTitle.value });
  });
  els.entryContent.addEventListener("input", markDirty);
  els.entrySummary.addEventListener("input", markDirty);
  // editor.js owns Escape for the content textarea (it's layered there --
  // first press closes the autocomplete popup if one is open, next exits
  // edit mode). The title/summary fields have no popup of their own, so a
  // direct listener on each is simplest.
  els.entryTitle.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.editing) {
      e.preventDefault();
      setEditing(false);
    }
  });
  els.entrySummary.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.editing) {
      e.preventDefault();
      setEditing(false);
    }
  });
  // Same view-mode treatment as the content textarea (editor.js's
  // onTextareaMouseDown): readOnly alone still lets the browser focus the
  // field, place a caret, and highlight a selection on click. Suppressing
  // the native mousedown action in view mode blocks all of that, so the
  // title/summary are genuinely inert until Edit is clicked, not just
  // uneditable.
  els.entryTitle.addEventListener("mousedown", (e) => {
    if (!state.editing) {
      e.preventDefault();
    }
  });
  els.entrySummary.addEventListener("mousedown", (e) => {
    if (!state.editing) {
      e.preventDefault();
    }
  });

  els.railGraphBtn.addEventListener("click", onOpenWorldGraph);
  els.railOutlineToggleBtn.addEventListener("click", () => togglePanel("outline"));
  els.railBacklinksToggleBtn.addEventListener("click", () => togglePanel("backlinks"));
  els.railEntryGraphToggleBtn.addEventListener("click", () => togglePanel("entry-graph"));

  updateActionStates();
  initSearch();
  init();
});

async function init() {
  try {
    state.worlds = await window.api.listWorlds();
    renderWorldOptions();
    if (state.worlds.length > 0) {
      state.selectedWorldId = state.worlds[0].id;
      els.worldSelect.value = state.selectedWorldId;
      await loadHierarchy();
    }
  } catch (err) {
    showStatus(err.message, true);
  }
  // Re-run now that state.selectedWorldId may have just been set -- the
  // DOMContentLoaded call site runs before listWorlds() resolves, so the
  // search box would otherwise stay disabled even once a world loads.
  initSearch();
  updateActionStates();
}

// Enables/disables actions that require a world/entry to be selected.
// Called after every state change that could affect these preconditions.
function updateActionStates() {
  els.newFolderBtn.disabled = !state.selectedWorldId;
  els.newEntryBtn.disabled = !state.selectedWorldId;
  els.generateAiBtn.disabled = !state.selectedWorldId;
  els.editToggleBtn.disabled = !state.openEntryId;
  // Saving only makes sense while editing -- fields are read-only otherwise,
  // so nothing could have changed.
  els.saveBtn.disabled = !state.openEntryId || !state.editing;
  els.deleteBtn.disabled = !state.openEntryId;
  els.entryGraphBtn.disabled = !state.openEntryId;
  els.worldGraphBtn.disabled = !state.selectedWorldId;
  els.railGraphBtn.disabled = !state.selectedWorldId;
  els.railOutlineToggleBtn.disabled = !state.openEntryId;
  els.railBacklinksToggleBtn.disabled = !state.openEntryId;
  els.railEntryGraphToggleBtn.disabled = !state.openEntryId;
}

// Wires up js/search.js with the current world id -- called on every world
// change (init(), onWorldSelected(), onCreateWorld()), same reasoning as
// syncEditorState(): the module needs to know which world to search within,
// and there's no other channel to tell it.
function initSearch() {
  window.search.init({
    inputEl: els.searchInput,
    resultsEl: els.searchResults,
    worldId: state.selectedWorldId,
    onNavigate: (id) => openEntry(id),
  });
}

// Opens the modal graph view (js/graph.js) centered on the currently open
// entry -- its direct (1-hop) [[wikilink]] neighbors only, in+out, per
// CLAUDE.md's graph feature spec. graph.js never reaches into `state`
// directly; everything it needs is handed to it here via `config`, same
// arm's-length pattern as syncEditorState()/renderSidebar()/renderTags().
function onOpenEntryGraph() {
  if (!state.openEntryId) {
    return;
  }
  els.graphModalTitle.textContent = "Entry graph";
  window.graph.render(els.graphModal, {
    mode: "entry",
    worldId: state.selectedWorldId,
    entries: state.entries,
    centerEntryId: state.openEntryId,
    onNavigate: (id) => {
      window.graph.close();
      openEntry(id);
    },
    onEntryCreated: onStubEntryCreated,
    onError: (msg) => showStatus(msg, true),
  });
}

// Opens the modal graph view for the whole world -- every entry as a node,
// every [[wikilink]] between them as an edge.
function onOpenWorldGraph() {
  if (!state.selectedWorldId) {
    return;
  }
  els.graphModalTitle.textContent = "World graph";
  window.graph.render(els.graphModal, {
    mode: "world",
    worldId: state.selectedWorldId,
    entries: state.entries,
    onNavigate: (id) => {
      window.graph.close();
      openEntry(id);
    },
    onEntryCreated: onStubEntryCreated,
    onError: (msg) => showStatus(msg, true),
  });
}

function renderWorldOptions() {
  els.worldSelect.innerHTML = "";
  if (state.worlds.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "No worlds yet";
    opt.disabled = true;
    opt.selected = true;
    els.worldSelect.appendChild(opt);
    return;
  }
  for (const world of state.worlds) {
    const opt = document.createElement("option");
    opt.value = world.id;
    opt.textContent = world.name;
    els.worldSelect.appendChild(opt);
  }
}

async function onWorldSelected() {
  state.selectedWorldId = els.worldSelect.value;
  closeEditor();
  await loadHierarchy();
  initSearch();
  updateActionStates();
}

async function onCreateWorld() {
  const name = els.newWorldName.value.trim();
  if (!name) {
    showStatus("World name is required.", true);
    return;
  }
  try {
    const world = await window.api.createWorld({ name });
    state.worlds.push(world);
    renderWorldOptions();
    els.worldSelect.value = world.id;
    state.selectedWorldId = world.id;
    els.newWorldName.value = "";
    closeEditor();
    await loadHierarchy();
    initSearch();
    showStatus(`World "${world.name}" created.`);
  } catch (err) {
    showStatus(err.message, true);
  }
  updateActionStates();
}

async function loadHierarchy() {
  if (!state.selectedWorldId) {
    state.folders = [];
    state.entries = [];
    renderSidebar();
    syncEditorState();
    return;
  }
  try {
    const hierarchy = await window.api.getHierarchy(state.selectedWorldId);
    state.folders = hierarchy.folders;
    state.entries = hierarchy.entries;
    renderSidebar();
    // Also the refresh path after sidebar.js's drag-and-drop moves an entry
    // between folders (via onHierarchyChanged) -- if that was the open
    // entry, its breadcrumb folder path just changed.
    renderBreadcrumb();
    // state.entries was just wholesale-replaced -- refresh whichever
    // right-rail panel is open (outline/backlinks both read from it).
    refreshRightPanel();
  } catch (err) {
    showStatus(err.message, true);
  }
  syncEditorState();
}

// Renders the folder/entry tree via sidebar.js. Called after anything that
// changes state.folders, state.entries, or state.openEntryId (for the
// active-entry highlight) -- see the call sites throughout this file, same
// "re-render from current state" pattern as renderTags()/syncEditorState().
function renderSidebar() {
  window.sidebar.render(els.entryTree, {
    worldId: state.selectedWorldId,
    folders: state.folders,
    entries: state.entries,
    openEntryId: state.openEntryId,
    onOpenEntry: openEntry,
    onCreateEntry: onCreateEntry,
    onDeleteEntry: onDeleteEntry,
    // Folder create/delete happen entirely inside sidebar.js (see its own
    // header comment for why) -- this is its way of saying "the hierarchy
    // changed on the server, please refetch" rather than patching
    // state.folders/state.entries piecemeal in place.
    onHierarchyChanged: loadHierarchy,
    onError: (msg) => showStatus(msg, true),
  });
}

// Prompts for a folder name and creates it at the world's root -- the
// current sidebar UI doesn't expose creating nested subfolders (see
// CLAUDE.md's Navigation section), only top-level ones. Uses a native
// prompt() rather than an inline reveal-form (contrast tags.js's "+ Add
// tag"): folder creation is comparatively rare, so the extra UI weight of
// an inline form isn't worth it here, and confirm()-style native dialogs
// are already this codebase's convention for infrequent actions (delete
// confirmations).
async function onCreateFolder() {
  if (!state.selectedWorldId) {
    showStatus("Select or create a world first.", true);
    return;
  }
  const name = prompt("Folder name:");
  if (!name || !name.trim()) {
    return;
  }
  try {
    await window.api.createFolder(state.selectedWorldId, { name: name.trim() });
    await loadHierarchy();
    showStatus(`Folder "${name.trim()}" created.`);
  } catch (err) {
    showStatus(err.message, true);
  }
}

// Reveals the inline "Generate with AI" form (same reveal-on-click pattern
// as tags.js's "+ Add tag" control) and lazily fetches the model list the
// first time it's opened -- models aren't world-scoped, so this only needs
// to happen once per page load, not on every open.
async function onOpenAiGenerateForm() {
  if (!state.selectedWorldId) {
    showStatus("Select or create a world first.", true);
    return;
  }
  els.aiGenerateForm.hidden = false;
  els.aiGeneratePrompt.focus();
  if (!state.aiModelsLoaded) {
    try {
      state.aiModels = await window.api.listAiModels();
      // Only latch aiModelsLoaded on success -- a transient/misconfigured
      // failure shouldn't permanently wedge the picker at "no models" for
      // the rest of the page session; the next open retries the fetch.
      state.aiModelsLoaded = true;
    } catch {
      // An unreachable/misconfigured aggregator shouldn't block opening the
      // form -- the model select just renders empty and generation itself
      // will surface a clear error when actually submitted.
      state.aiModels = [];
    }
  }
  // Re-render unconditionally, not just on first load -- onCancelAiGenerate
  // clears the search box, and a stale filtered <select> would otherwise
  // persist across a cancel/reopen even though the search input looks empty.
  renderAiModelOptions();
}

// The backend already returns models filtered to text-API support and
// sorted alphabetically -- filterText here is a pure client-side substring
// match over that list, no re-sort needed.
function renderAiModelOptions(filterText = "") {
  els.aiGenerateModel.innerHTML = "";
  const query = filterText.trim().toLowerCase();
  const models = query
    ? state.aiModels.filter((model) => model.name.toLowerCase().includes(query))
    : state.aiModels;
  if (models.length === 0) {
    const opt = document.createElement("option");
    // Explicit empty value -- an <option> with no value attribute defaults
    // its .value to its text content, which would otherwise get sent as the
    // "model" field below instead of null.
    opt.value = "";
    opt.textContent = state.aiModels.length === 0 ? "No models configured" : "No matching models";
    opt.disabled = true;
    opt.selected = true;
    els.aiGenerateModel.appendChild(opt);
    return;
  }
  for (const model of models) {
    const opt = document.createElement("option");
    opt.value = model.id;
    opt.textContent = model.name;
    els.aiGenerateModel.appendChild(opt);
  }
}

function onCancelAiGenerate() {
  els.aiGenerateForm.hidden = true;
  els.aiGeneratePrompt.value = "";
  els.aiGenerateModelSearch.value = "";
  els.aiGenerateStatus.textContent = "";
}

// Submits the prompt to POST .../entries/generate, a blocking multi-second
// LLM call -- disables the submit button and shows a status message for the
// duration. On success, lands in edit mode on the new entry (same "ready to
// type immediately" treatment onCreateEntry gives every freshly created
// entry) so the draft can be reviewed/adjusted before it's really saved. On
// failure the form stays open with the prompt intact and the error shown
// inline, rather than losing the prompt text.
async function onGenerateEntry() {
  if (!state.selectedWorldId) {
    showStatus("Select or create a world first.", true);
    return;
  }
  const prompt = els.aiGeneratePrompt.value.trim();
  if (!prompt) {
    els.aiGenerateStatus.textContent = "Describe what to generate first.";
    return;
  }
  els.aiGenerateSubmitBtn.disabled = true;
  els.aiGenerateStatus.textContent = "Generating...";
  try {
    const entry = await window.api.generateEntry(state.selectedWorldId, {
      prompt,
      model: els.aiGenerateModel.value || null,
      folderId: null,
    });
    state.entries.push(entry);
    renderSidebar();
    onCancelAiGenerate();
    await openEntry(entry.id, { startEditing: true });
    showStatus(`Generated "${entry.title}".`);
  } catch (err) {
    els.aiGenerateStatus.textContent = err.message;
  } finally {
    els.aiGenerateSubmitBtn.disabled = false;
  }
}

// Worlds > {World} > {Folder path...} > {Entry}, per CLAUDE.md's UI
// breakdown. Walks entry.folderId up through state.folders' parentFolderId
// chain to build the folder path; renders nothing if no entry is open.
function renderBreadcrumb() {
  els.breadcrumb.innerHTML = "";
  const world = state.worlds.find((w) => String(w.id) === String(state.selectedWorldId));
  const entry = state.entries.find((e) => e.id === state.openEntryId);
  if (!world || !entry) {
    return;
  }

  const foldersById = new Map(state.folders.map((f) => [f.id, f]));
  const folderPath = [];
  let folderId = entry.folderId;
  // Defensively bounded (state.folders is small and this is a tree, not a
  // graph, so it shouldn't ever cycle) -- guards against a malformed chain
  // hanging the loop rather than just rendering a short/wrong path.
  let guard = 0;
  while (folderId != null && guard++ < 50) {
    const folder = foldersById.get(folderId);
    if (!folder) {
      break;
    }
    folderPath.unshift(folder.name);
    folderId = folder.parentFolderId;
  }

  const parts = ["Worlds", world.name, ...folderPath, entry.title || "Untitled"];
  parts.forEach((part, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-separator";
      sep.textContent = "›";
      els.breadcrumb.appendChild(sep);
    }
    const span = document.createElement("span");
    span.className = "breadcrumb-part" + (i === parts.length - 1 ? " current" : "");
    span.textContent = part;
    els.breadcrumb.appendChild(span);
  });
}

// ---- Entry header: avatar + timestamps -------------------------------
//
// There's no icon-picker UX yet (CLAUDE.md's Entry viewing note), so the
// circular header icon is a deliberate stand-in: the entry title's first
// letter on a color hashed from the title, same idea as GitHub/Slack-style
// letter avatars. Purely derived/display state -- nothing here is persisted
// (Entry.icon exists on the model but this doesn't read/write it).

// Small, stable string -> hue hash (not cryptographic, just deterministic)
// so the same title always gets the same color across renders/reloads.
function hashToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

// Called on openEntry() and live on every title keystroke (see the
// #entry-title "input" listener in DOMContentLoaded) so the avatar tracks
// an in-progress rename instead of only updating on save. `entry` may be
// null (closeEditor()) to reset to the empty state.
function renderEntryAvatar(entry) {
  const title = ((entry && entry.title) || "").trim();
  els.entryIcon.textContent = title ? title.charAt(0).toUpperCase() : "";
  els.entryIcon.style.background = title ? hashToColor(title.toLowerCase()) : "";
}

// Created/last-modified metadata, right-aligned per CLAUDE.md's UI
// breakdown. Same "re-render from state.entries" pattern as renderTags() --
// always looks the open entry up fresh rather than caching a reference.
function renderTimestamps() {
  els.entryTimestamps.innerHTML = "";
  const entry = state.entries.find((e) => e.id === state.openEntryId);
  if (!entry) {
    return;
  }
  const created = document.createElement("span");
  created.textContent = `Created ${formatTimestamp(entry.createdAt)}`;
  const modified = document.createElement("span");
  modified.textContent = `Last modified ${formatTimestamp(entry.updatedAt)}`;
  els.entryTimestamps.appendChild(created);
  els.entryTimestamps.appendChild(modified);
}

function formatTimestamp(isoString) {
  if (!isoString) {
    return "—";
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

// ---- Right rail: outline / backlinks / entry-graph panels ---------------
//
// Only one panel is ever open at a time (or none) -- clicking an already-
// open panel's rail button closes it, clicking a different one switches.
// Each panel's actual content rendering is delegated to its own module
// (outline.js/backlinks.js/graph.js's renderEntryPanel), same arm's-length
// callback pattern as renderSidebar()/renderTags(); this function only owns
// which panel is visible.
function togglePanel(panel) {
  state.rightPanel = state.rightPanel === panel ? null : panel;

  els.rightPanel.hidden = !state.rightPanel;
  els.outlinePanel.hidden = state.rightPanel !== "outline";
  els.backlinksPanel.hidden = state.rightPanel !== "backlinks";
  els.entryGraphPanel.hidden = state.rightPanel !== "entry-graph";

  for (const btn of [els.railOutlineToggleBtn, els.railBacklinksToggleBtn, els.railEntryGraphToggleBtn]) {
    btn.setAttribute("aria-pressed", btn.dataset.panel === state.rightPanel ? "true" : "false");
  }

  refreshRightPanel();
}

function closeRightPanel() {
  if (state.rightPanel) {
    togglePanel(state.rightPanel); // toggling the currently-open panel closes it
  }
}

// Re-renders whichever right-rail panel is currently open from the latest
// state.entries/state.openEntryId -- called from every place that changes
// either (setEditing, onSaveEntry, openEntry via setEditing, loadHierarchy,
// onDeleteEntry, onStubEntryCreated), same "single re-render funnel" idea as
// renderTags()/renderBreadcrumb(). A no-op if no panel is open.
function refreshRightPanel() {
  if (!state.rightPanel) {
    return;
  }
  const entry = state.entries.find((e) => e.id === state.openEntryId);

  if (state.rightPanel === "outline") {
    window.outline.render(els.outlinePanelBody, {
      markdown: entry ? entry.contentMarkdown : "",
      onSelect: onOutlineSelect,
    });
  } else if (state.rightPanel === "backlinks") {
    window.backlinks.render(els.backlinksPanelBody, {
      entries: state.entries,
      currentEntry: entry,
      worldId: state.selectedWorldId,
      onNavigate: (id) => openEntry(id),
      // Inactive "Linked to" items (an unresolved [[wikilink]] title) create
      // a stub entry on click, same POST editor.js's dblclick-to-create-stub
      // makes -- but unlike that in-place flip, clicking here navigates
      // straight into the new entry in edit mode (see onLinkedToStubCreated).
      onEntriesChanged: onLinkedToStubCreated,
    });
  } else if (state.rightPanel === "entry-graph") {
    if (!entry) {
      return;
    }
    window.graph.renderEntryPanel(els.entryGraphPanel, {
      mode: "entry",
      canvasSelector: "#entry-graph-panel-canvas",
      worldId: state.selectedWorldId,
      entries: state.entries,
      centerEntryId: entry.id,
      onNavigate: (id) => openEntry(id),
      onEntryCreated: onStubEntryCreated,
      onError: (msg) => showStatus(msg, true),
    });
  }
}

// Outline click -> jump to that heading. In edit mode, places the caret on
// the textarea's real raw-source line (the only surface that's actually
// visible while editing). In view mode the textarea is hidden entirely (see
// editor.js's rendered-preview section), so this scrolls the corresponding
// rendered heading element instead, matched by its position among all
// headings (outline.js hands back the same `index` it rendered with, which
// lines up with the preview's own heading order since both are parsed from
// the same source in document order).
function onOutlineSelect(heading) {
  if (state.editing) {
    els.entryContent.focus();
    els.entryContent.setSelectionRange(heading.offset, heading.offset + heading.lineLength);
  } else {
    const headingEls = els.entryContentPreview.querySelectorAll("h1, h2, h3, h4, h5, h6");
    const target = headingEls[heading.index];
    if (target && target.scrollIntoView) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}

// Re-wires editor.js with the current world id, entry list (for its
// [[wikilink]] title-resolution index), and the shared textarea/overlay/
// popup elements. Called after anything that changes state.selectedWorldId
// or state.entries, and after the textarea's content is set programmatically
// (openEntry/closeEditor), since editor.js's own "input" listener never
// fires for those -- editor.js's init() re-tokenizes and re-renders the
// overlay from the textarea's current value as part of wiring up.
function syncEditorState() {
  window.editor.init({
    textarea: els.entryContent,
    overlay: els.entryContentOverlay,
    autocompleteEl: els.wikilinkAutocomplete,
    toolbarEl: els.markdownToolbar,
    wordCountEl: els.editorWordCount,
    preview: els.entryContentPreview,
    worldId: state.selectedWorldId,
    entries: state.entries,
    editing: state.editing,
    onNavigate: openEntry,
    onEntriesChanged: onStubEntryCreated,
    onEscapeEdit: () => setEditing(false),
  });
}

// Entries open read-only; the user opts into editing per-entry via the Edit
// button (or exits via Escape -- see editor.js's onEscapeEdit callback
// above). Applies state.editing to the actual DOM (readOnly attributes +
// the .editing outline marker) and re-syncs editor.js, which gates
// click-to-navigate on [[references]] by this same flag (2.4's design
// assumed view mode; while editing, a reference click must not change the
// current file -- it just places the caret, like any other text).
//
// Exiting edit mode (editing: false) with unsaved changes auto-saves first,
// rather than silently going read-only with the changes stranded only in
// the DOM -- but only when there's still an entry to save onto:
// state.openEntryId is already cleared by the time this runs from
// closeEditor()/a just-completed delete, so the guard below naturally skips
// saving in those cases (nothing to save the content back onto).
async function setEditing(editing) {
  if (!editing && state.editing && state.dirty && state.openEntryId) {
    const saved = await onSaveEntry();
    if (!saved) {
      // Save failed (e.g. blank title) or was a no-op -- stay in edit mode
      // so the user can see the error / fix it, rather than discarding.
      return;
    }
  }
  state.editing = editing;
  els.entryTitle.readOnly = !editing;
  els.entrySummary.readOnly = !editing;
  els.entryContent.readOnly = !editing;
  els.entryContentWrapper.hidden = !editing;
  els.entryContentPreview.hidden = editing;
  els.editor.classList.toggle("editing", editing);
  // Icon-only buttons -- swapping textContent would blow away the SVG, so
  // the pressed-state visual (accent fill, see editor.css) plus an updated
  // tooltip/label are the only things that change.
  els.editToggleBtn.setAttribute("aria-pressed", editing ? "true" : "false");
  els.editToggleBtn.title = editing ? "Done editing" : "Edit";
  els.editToggleBtn.setAttribute("aria-label", editing ? "Done editing" : "Edit");
  syncEditorState();
  updateActionStates();
  // Single call site for both directions of the view/edit transition --
  // openEntry(), closeEditor(), onToggleEditing(), and both Escape paths all
  // funnel through setEditing(), so this is enough to keep the tag pill
  // row, breadcrumb, timestamps, and whichever right-rail panel is open in
  // sync without needing a call in each of them.
  renderTags();
  renderBreadcrumb();
  renderTimestamps();
  refreshRightPanel();
  if (editing) {
    els.entryContent.focus();
  } else {
    // Setting readOnly doesn't blur a field that's already focused (e.g.
    // the user was mid-typing when they hit Escape) -- left alone, the
    // browser's own default focus ring can keep showing on it after the
    // .editing outline above is removed, which looks exactly like edit mode
    // never actually turned off. Neither field should hold focus in view
    // mode anyway, since nothing there is interactive.
    els.entryTitle.blur();
    els.entrySummary.blur();
    els.entryContent.blur();
  }
}

function onToggleEditing() {
  if (!state.openEntryId) {
    return;
  }
  setEditing(!state.editing);
}

// Re-renders the tag pill row for the currently open entry, if any.
// Editability (add/remove/color-change controls) tracks state.editing, same
// gating rule as the title/content fields -- tags are always visible, just
// not editable outside edit mode. Always looks the entry up fresh from
// state.entries rather than caching a reference, since several call sites
// (onSaveEntry, tag add/remove) replace that array's entry objects wholesale
// with a new server response.
function renderTags() {
  if (!state.openEntryId) {
    els.entryTags.innerHTML = "";
    return;
  }
  const entry = state.entries.find((e) => e.id === state.openEntryId);
  if (!entry) {
    els.entryTags.innerHTML = "";
    return;
  }
  window.tags.render(els.entryTags, entry, {
    editable: state.editing,
    worldId: state.selectedWorldId,
    onEntryChanged: onEntryTagsChanged,
    onError: (msg) => showStatus(msg, true),
  });
}

// Called by tags.js after a tag is added to or removed from the open entry
// (both return the updated EntryResponse). Mirrors the pattern
// onStubEntryCreated/onSaveEntry already use for keeping state.entries in
// sync with a fresh server response.
function onEntryTagsChanged(updatedEntry) {
  const idx = state.entries.findIndex((e) => e.id === updatedEntry.id);
  if (idx !== -1) {
    state.entries[idx] = updatedEntry;
  }
  renderTags();
}

// Called by editor.js after it creates a stub entry for a double-clicked
// unresolved [[Title]] link (design doc 2.7). editor.js already updated its
// own title-resolution index; this just mirrors the new entry into
// state.entries so the sidebar picks it up too.
function onStubEntryCreated(entry) {
  state.entries.push(entry);
  renderSidebar();
  // A new entry could change the currently-open entry's backlinks (if it
  // resolves a link that pointed at the just-created title) -- cheap enough
  // to just always refresh rather than trying to detect that specifically.
  refreshRightPanel();
}

// Called by backlinks.js after it creates a stub entry for a clicked
// "Linked to -> Inactive" title. Unlike onStubEntryCreated above (editor.js's
// double-click-to-create-stub, which flips the clicked span to resolved in
// place and deliberately stays on the current entry so an in-progress edit
// isn't interrupted), the backlinks panel is display-only -- there's no
// editing session to preserve, so this navigates straight into the new
// entry in edit mode instead, same "ready to type immediately" treatment
// onCreateEntry gives every other freshly-created entry. openEntry() already
// takes care of pushing/replacing the entry in state.entries and
// re-rendering the sidebar, so nothing else is needed here.
function onLinkedToStubCreated(entry) {
  openEntry(entry.id, { startEditing: true });
}

// folderId: creates the entry inside that folder, or at the world's root if
// omitted/null. Called both by the header's "+ New entry" button (always
// root-level, see the wrapped listener in DOMContentLoaded) and by
// sidebar.js's per-folder "+" button (via the onCreateEntry callback).
async function onCreateEntry(folderId) {
  if (!state.selectedWorldId) {
    showStatus("Select or create a world first.", true);
    return;
  }
  try {
    const entry = await window.api.createEntry(state.selectedWorldId, {
      title: "Untitled",
      contentMarkdown: "",
      folderId: folderId || null,
    });
    state.entries.push(entry);
    renderSidebar();
    // Drop straight into edit mode -- a freshly created entry is empty, so
    // making the user click Edit before they can type anything into it
    // would just be friction.
    await openEntry(entry.id, { startEditing: true });
  } catch (err) {
    showStatus(err.message, true);
  }
}

// startEditing: opens straight into edit mode instead of the usual
// read-only view -- used only for just-created entries (see onCreateEntry).
// Sidebar clicks and wikilink navigation (editor.js's onNavigate callback)
// call this with no options and get the normal read-only default.
async function openEntry(id, { startEditing = false } = {}) {
  if (state.dirty && !confirm("Discard unsaved changes?")) {
    return;
  }
  try {
    const entry = await window.api.getEntry(id);
    // Refresh state.entries' copy too, not just the visible fields below --
    // the list endpoint's snapshot could be stale (e.g. a tag changed since
    // load), and renderTags() always reads from state.entries.
    const idx = state.entries.findIndex((e) => e.id === entry.id);
    if (idx !== -1) {
      state.entries[idx] = entry;
    } else {
      state.entries.push(entry);
    }
    state.openEntryId = entry.id;
    state.dirty = false;
    els.entryTitle.value = entry.title || "";
    els.entrySummary.value = entry.summary || "";
    els.entryContent.value = entry.contentMarkdown || "";
    els.editor.hidden = false;
    els.editorEmpty.hidden = true;
    renderEntryAvatar(entry);
    renderSidebar();
    // Entries open read-only by default, except startEditing (new entries --
    // see onCreateEntry). Either way this also resyncs editor.js -- setting
    // .value directly above doesn't fire "input", so editor.js's own
    // overlay would never see this entry's content otherwise.
    setEditing(startEditing);
  } catch (err) {
    showStatus(err.message, true);
    updateActionStates();
  }
}

function closeEditor() {
  state.openEntryId = null;
  state.dirty = false;
  els.entryTitle.value = "";
  els.entrySummary.value = "";
  els.entryContent.value = "";
  els.editor.hidden = true;
  els.editorEmpty.hidden = false;
  renderEntryAvatar(null);
  closeRightPanel();
  setEditing(false);
}

function markDirty() {
  state.dirty = true;
}

// Returns whether the save actually went through -- setEditing()'s
// auto-save-on-exit uses this to decide whether it's safe to drop into
// read-only mode, or whether it should stay in edit mode instead (e.g. a
// blank title) so the user can see/fix the problem.
async function onSaveEntry() {
  if (!state.openEntryId) {
    return false;
  }
  const title = els.entryTitle.value.trim();
  if (!title) {
    showStatus("Title cannot be blank.", true);
    els.entryTitle.focus();
    return false;
  }
  els.saveBtn.disabled = true;
  try {
    const updated = await window.api.updateEntry(state.openEntryId, {
      title,
      summary: els.entrySummary.value,
      contentMarkdown: els.entryContent.value,
    });
    state.dirty = false;
    const idx = state.entries.findIndex((e) => e.id === updated.id);
    if (idx !== -1) {
      state.entries[idx] = updated;
    }
    renderSidebar();
    // Title may have changed -- rebuild editor.js's wikilink resolution
    // index so other [[Title]] references pick up the rename.
    syncEditorState();
    // state.entries[idx] above is now a new object (the fresh server
    // response) -- re-render tags from it so tags.js's event handlers stay
    // bound to the same object state.entries holds, not a stale one from
    // before this save.
    renderTags();
    // Title may be the breadcrumb's last segment.
    renderBreadcrumb();
    // Title drives the avatar letter/color; updatedAt just changed too.
    renderEntryAvatar(updated);
    renderTimestamps();
    // Content/title may have changed -- outline headings, backlink matches
    // (a title rename can resolve/unresolve other entries' links to this
    // one), and the relation graph's node label can all be stale otherwise.
    refreshRightPanel();
    showStatus("Saved.");
    return true;
  } catch (err) {
    showStatus(err.message, true);
    return false;
  } finally {
    updateActionStates();
  }
}

async function onDeleteEntry(id) {
  if (!id) {
    return;
  }
  if (!confirm("Delete this entry?")) {
    return;
  }
  try {
    await window.api.deleteEntry(id);
    state.entries = state.entries.filter((e) => e.id !== id);
    if (state.openEntryId === id) {
      closeEditor();
    } else {
      // The deleted entry may be referenced by a [[Title]] link in the
      // currently-open entry -- rebuild the resolution index so it flips
      // to unresolved. (closeEditor() already does this in the other branch.)
      syncEditorState();
      // Same reasoning -- the deleted entry may have been a backlink source,
      // an entry-graph neighbor, or (moot for outline, but harmless) needed
      // for something else keyed off state.entries.
      refreshRightPanel();
    }
    renderSidebar();
    showStatus("Entry deleted.");
  } catch (err) {
    showStatus(err.message, true);
  }
  updateActionStates();
}

function showStatus(message, isError = false) {
  els.statusMessage.textContent = message;
  els.statusMessage.classList.toggle("error", isError);
}
