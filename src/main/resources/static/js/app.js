// Bootstrap/wiring for the narrow first-slice UI: world picker, a
// folder/entry tree sidebar (see sidebar.js), a title+markdown editor (see
// editor.js), and the tag pill row (see tags.js). No relations, search, or
// theming yet -- those come in later phases per CLAUDE.md.

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
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  els.worldSelect = document.getElementById("world-select");
  els.newWorldName = document.getElementById("new-world-name");
  els.newWorldBtn = document.getElementById("new-world-btn");
  els.entryTree = document.getElementById("entry-tree");
  els.newFolderBtn = document.getElementById("new-folder-btn");
  els.newEntryBtn = document.getElementById("new-entry-btn");
  els.editor = document.getElementById("editor");
  els.editorEmpty = document.getElementById("editor-empty");
  els.breadcrumb = document.getElementById("breadcrumb");
  els.entryTitle = document.getElementById("entry-title");
  els.entryContent = document.getElementById("entry-content");
  els.entryContentOverlay = document.getElementById("entry-content-overlay");
  els.wikilinkAutocomplete = document.getElementById("wikilink-autocomplete");
  els.entryTags = document.getElementById("entry-tags");
  els.editToggleBtn = document.getElementById("edit-toggle-btn");
  els.saveBtn = document.getElementById("save-btn");
  els.deleteBtn = document.getElementById("delete-btn");
  els.statusMessage = document.getElementById("status-message");

  els.worldSelect.addEventListener("change", onWorldSelected);
  els.newWorldBtn.addEventListener("click", onCreateWorld);
  els.newFolderBtn.addEventListener("click", onCreateFolder);
  // Wrapped rather than passed directly -- onCreateEntry now takes an
  // optional folderId, and addEventListener would otherwise hand it the
  // click MouseEvent as that argument.
  els.newEntryBtn.addEventListener("click", () => onCreateEntry());
  els.editToggleBtn.addEventListener("click", onToggleEditing);
  els.saveBtn.addEventListener("click", onSaveEntry);
  els.deleteBtn.addEventListener("click", () => onDeleteEntry(state.openEntryId));
  els.entryTitle.addEventListener("input", markDirty);
  els.entryContent.addEventListener("input", markDirty);
  // editor.js owns Escape for the content textarea (it's layered there --
  // first press closes the autocomplete popup if one is open, next exits
  // edit mode). The title field has no popup of its own, so a direct
  // listener here is simplest.
  els.entryTitle.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.editing) {
      e.preventDefault();
      setEditing(false);
    }
  });
  // Same view-mode treatment as the content textarea (editor.js's
  // onTextareaMouseDown): readOnly alone still lets the browser focus the
  // field, place a caret, and highlight a selection on click. Suppressing
  // the native mousedown action in view mode blocks all of that, so the
  // title is genuinely inert until Edit is clicked, not just uneditable.
  els.entryTitle.addEventListener("mousedown", (e) => {
    if (!state.editing) {
      e.preventDefault();
    }
  });

  updateActionStates();
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
  updateActionStates();
}

// Enables/disables actions that require a world/entry to be selected.
// Called after every state change that could affect these preconditions.
function updateActionStates() {
  els.newFolderBtn.disabled = !state.selectedWorldId;
  els.newEntryBtn.disabled = !state.selectedWorldId;
  els.editToggleBtn.disabled = !state.openEntryId;
  // Saving only makes sense while editing -- fields are read-only otherwise,
  // so nothing could have changed.
  els.saveBtn.disabled = !state.openEntryId || !state.editing;
  els.deleteBtn.disabled = !state.openEntryId;
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
  els.entryContent.readOnly = !editing;
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
  // row's editable controls and the breadcrumb in sync without needing a
  // call in each of them.
  renderTags();
  renderBreadcrumb();
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
    els.entryContent.value = entry.contentMarkdown || "";
    els.editor.hidden = false;
    els.editorEmpty.hidden = true;
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
  els.entryContent.value = "";
  els.editor.hidden = true;
  els.editorEmpty.hidden = false;
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
