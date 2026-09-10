// Folder/entry tree, rendered into the sidebar. Builds the tree client-side
// from the flat {folders, entries} lists the hierarchy endpoint returns
// (see docs -- CLAUDE.md's WorldHierarchyResponse note explains why the wire
// format stays flat). Same arm's-length pattern as editor.js/tags.js: this
// module only ever talks back to app.js through the callbacks passed to
// render(), never touching app.js's `state` directly.
//
// Folder create/delete are handled entirely inside this module (they don't
// interact with editor/edit-mode state); entry create/delete are routed
// back to app.js via callbacks instead, since app.js's onCreateEntry/
// onDeleteEntry already own the "open the new entry"/"confirm + close the
// editor if it was open" logic and that shouldn't be duplicated here.
//
// Drag-and-drop (moving entries and folders in/out of folders) is handled
// entirely here too, like folder create/delete -- it's a structural/
// organizational action, not an edit-mode-gated content edit, so it's
// always available via the native HTML5 Drag and Drop API. Both entry and
// folder <li>s are drag sources; a folder's subtree or the tree's own
// background (for "move to root") are the drop targets. Entries and folders
// use distinct custom dataTransfer types (see DRAG_TYPE below) so a drop
// handler can tell which kind it received without touching getData() during
// dragover (browsers only allow reading drag data on the actual drop).

(function () {
  // Which folder ids are collapsed -- pure presentation state, kept here
  // rather than in app.js's state (same reasoning as editor.js's
  // autocomplete-open state) so app.js doesn't need to know about it. The
  // last render() args are cached so toggling a chevron can re-render
  // without needing app.js to call render() again.
  const collapsedFolderIds = new Set();
  let lastContainer = null;
  let lastConfig = null;

  // The tree <ul> passed in from app.js is the same element across every
  // render() call (only its children get replaced) -- unlike the folder/
  // entry rows below, which are recreated fresh every render and so never
  // risk duplicate listeners, this container needs its root-drop-zone
  // listeners attached exactly once, guarded by this flag.
  let rootDropListenersAttached = false;

  // config: { worldId, folders, entries, openEntryId, onOpenEntry(id),
  //   onCreateEntry(folderId), onDeleteEntry(id), onHierarchyChanged(),
  //   onError(message) }
  function render(container, config) {
    lastContainer = container;
    lastConfig = config;

    if (!rootDropListenersAttached) {
      attachRootDropZone(container);
      rootDropListenersAttached = true;
    }

    container.innerHTML = "";

    // Explicit, always-visible drag target for "move to root" -- the
    // container's own background (attachRootDropZone, above) already
    // accepts a drop anywhere that isn't over a folder, but a full or
    // deeply-nested tree may not have much empty background left to aim
    // for. Complements the click-based "↑" buttons on nested rows (see
    // renderFolderNode/renderEntryNode) with a drag-based equivalent.
    container.appendChild(renderRootDropTarget());

    const { rootFolders, rootEntries } = buildTree(config.folders || [], config.entries || []);

    for (const folder of rootFolders) {
      container.appendChild(renderFolderNode(folder, config));
    }
    for (const entry of rootEntries) {
      container.appendChild(renderEntryNode(entry, config));
    }

    if (rootFolders.length === 0 && rootEntries.length === 0) {
      const empty = document.createElement("li");
      empty.className = "entry-list-empty";
      empty.textContent = "No entries yet.";
      container.appendChild(empty);
    }
  }

  function rerender() {
    if (lastContainer && lastConfig) {
      render(lastContainer, lastConfig);
    }
  }

  // ---- Drag-and-drop: moving entries and folders in/out of folders -------

  const ENTRY_DRAG_TYPE = "application/x-mythos-entry-id";
  const FOLDER_DRAG_TYPE = "application/x-mythos-folder-id";

  // Reads whichever of the two drag types is present -- only valid to call
  // from a "drop" handler; dataTransfer.getData() returns "" unconditionally
  // during dragover/dragenter in every browser, by spec, so this would
  // always report "nothing dragged" if called from those.
  function readDragPayload(dataTransfer) {
    const entryRaw = dataTransfer.getData(ENTRY_DRAG_TYPE);
    if (entryRaw) {
      const id = Number(entryRaw);
      if (Number.isFinite(id)) {
        return { type: "entry", id };
      }
    }
    const folderRaw = dataTransfer.getData(FOLDER_DRAG_TYPE);
    if (folderRaw) {
      const id = Number(folderRaw);
      if (Number.isFinite(id)) {
        return { type: "folder", id };
      }
    }
    return null;
  }

  // Both shared by every drop target below (a folder's subtree and the
  // tree's own background). Always use lastConfig rather than closing over
  // the config a particular row was rendered with, so a stale callback from
  // an earlier render can't fire.
  async function moveEntryTo(entryId, folderId) {
    try {
      await window.api.moveEntry(entryId, folderId);
      lastConfig && lastConfig.onHierarchyChanged && lastConfig.onHierarchyChanged();
    } catch (err) {
      lastConfig && lastConfig.onError && lastConfig.onError(err.message);
    }
  }

  async function moveFolderTo(folderId, parentFolderId) {
    // Self-drop is a client-side no-op (dragging a folder onto itself);
    // deeper cycles (into one of its own subfolders) aren't checked here --
    // the server rejects those (400) and the error surfaces via onError,
    // same as any other invalid move. Not worth duplicating the ancestry
    // walk client-side just to pre-empt a round trip.
    if (folderId === parentFolderId) {
      return;
    }
    try {
      await window.api.moveFolder(folderId, parentFolderId);
      lastConfig && lastConfig.onHierarchyChanged && lastConfig.onHierarchyChanged();
    } catch (err) {
      lastConfig && lastConfig.onError && lastConfig.onError(err.message);
    }
  }

  function handleDrop(dataTransfer, targetFolderId) {
    const payload = readDragPayload(dataTransfer);
    if (!payload) {
      return;
    }
    if (payload.type === "entry") {
      moveEntryTo(payload.id, targetFolderId);
    } else {
      moveFolderTo(payload.id, targetFolderId);
    }
  }

  // The tree's background is the "move to root" drop target -- a drop that
  // lands on a folder's subtree stops propagation (see renderFolderNode)
  // before it reaches here, so this only fires for drops that aren't over
  // any folder.
  function attachRootDropZone(container) {
    container.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "move";
      }
    });
    container.addEventListener("drop", (e) => {
      e.preventDefault();
      handleDrop(e.dataTransfer, null);
    });
  }

  // A small always-present "World root" row, recreated fresh every render
  // (same as folder/entry rows -- no duplicate-listener guard needed,
  // unlike attachRootDropZone's container-level listeners). stopPropagation
  // so a drop here doesn't also re-trigger the container's own background
  // drop zone for the same event -- both would resolve to the same move,
  // but there's no reason to fire it twice.
  function renderRootDropTarget() {
    const li = document.createElement("li");
    li.className = "tree-root-zone";
    li.textContent = "\u{1F3E0} World root";
    li.title = "Drop here to move to the world root";

    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "move";
      }
      li.classList.add("drag-over");
    });
    li.addEventListener("dragleave", () => {
      li.classList.remove("drag-over");
    });
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      li.classList.remove("drag-over");
      handleDrop(e.dataTransfer, null);
    });

    return li;
  }

  // Nests the flat folder/entry lists into a tree. Unknown/dangling
  // parentFolderId or folderId references (shouldn't happen given the
  // backend's cross-world/existence validation, but defensively) fall back
  // to root rather than being dropped.
  function buildTree(folders, entries) {
    const byId = new Map(folders.map((f) => [f.id, { ...f, children: [], entries: [] }]));
    const rootFolders = [];
    for (const folder of byId.values()) {
      const parent = folder.parentFolderId != null ? byId.get(folder.parentFolderId) : null;
      if (parent) {
        parent.children.push(folder);
      } else {
        rootFolders.push(folder);
      }
    }

    const rootEntries = [];
    for (const entry of entries) {
      const folder = entry.folderId != null ? byId.get(entry.folderId) : null;
      if (folder) {
        folder.entries.push(entry);
      } else {
        rootEntries.push(entry);
      }
    }

    sortTree(rootFolders);
    sortEntries(rootEntries);
    return { rootFolders, rootEntries };
  }

  function sortTree(folders) {
    folders.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
    );
    for (const folder of folders) {
      sortEntries(folder.entries);
      sortTree(folder.children);
    }
  }

  function sortEntries(entries) {
    entries.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  }

  function renderFolderNode(folder, config) {
    const li = document.createElement("li");
    li.className = "tree-folder";

    const row = document.createElement("div");
    row.className = "tree-folder-row";

    const collapsed = collapsedFolderIds.has(folder.id);

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "tree-toggle" + (collapsed ? " collapsed" : "");
    toggleBtn.setAttribute("aria-label", collapsed ? "Expand folder" : "Collapse folder");
    toggleBtn.addEventListener("click", () => {
      if (collapsedFolderIds.has(folder.id)) {
        collapsedFolderIds.delete(folder.id);
      } else {
        collapsedFolderIds.add(folder.id);
      }
      rerender();
    });
    row.appendChild(toggleBtn);

    const nameSpan = document.createElement("span");
    nameSpan.className = "tree-folder-name";
    nameSpan.textContent = folder.name;
    nameSpan.addEventListener("click", () => toggleBtn.click());
    row.appendChild(nameSpan);

    const addSubfolderBtn = document.createElement("button");
    addSubfolderBtn.type = "button";
    addSubfolderBtn.className = "tree-action-btn";
    addSubfolderBtn.title = "New subfolder";
    addSubfolderBtn.setAttribute("aria-label", `New subfolder in ${folder.name}`);
    addSubfolderBtn.textContent = "+\u{1F4C1}"; // "+" + folder emoji, distinct from the plain "+" below
    addSubfolderBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const name = prompt("Subfolder name:");
      if (!name || !name.trim()) {
        return;
      }
      try {
        await window.api.createFolder(config.worldId, { name: name.trim(), parentFolderId: folder.id });
        config.onHierarchyChanged();
      } catch (err) {
        config.onError && config.onError(err.message);
      }
    });
    row.appendChild(addSubfolderBtn);

    const addEntryBtn = document.createElement("button");
    addEntryBtn.type = "button";
    addEntryBtn.className = "tree-action-btn";
    addEntryBtn.title = "New entry in this folder";
    addEntryBtn.setAttribute("aria-label", `New entry in ${folder.name}`);
    addEntryBtn.textContent = "+";
    addEntryBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      config.onCreateEntry(folder.id);
    });
    row.appendChild(addEntryBtn);

    // Explicit alternative to dragging all the way out to the tree's empty
    // background (attachRootDropZone) -- only shown for a folder that's
    // actually nested somewhere, since it'd be a no-op on one already at
    // root. Reuses moveFolderTo, same as a drag-and-drop move would.
    if (folder.parentFolderId != null) {
      const moveToRootBtn = document.createElement("button");
      moveToRootBtn.type = "button";
      moveToRootBtn.className = "tree-action-btn";
      moveToRootBtn.title = "Move to world root";
      moveToRootBtn.setAttribute("aria-label", `Move folder ${folder.name} to the world root`);
      moveToRootBtn.textContent = "↑";
      moveToRootBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        moveFolderTo(folder.id, null);
      });
      row.appendChild(moveToRootBtn);
    }

    const deleteFolderBtn = document.createElement("button");
    deleteFolderBtn.type = "button";
    deleteFolderBtn.className = "tree-action-btn danger";
    deleteFolderBtn.title = "Delete folder";
    deleteFolderBtn.setAttribute("aria-label", `Delete folder ${folder.name}`);
    deleteFolderBtn.textContent = "×";
    deleteFolderBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete folder "${folder.name}"?`)) {
        return;
      }
      try {
        await window.api.deleteFolder(folder.id);
        config.onHierarchyChanged();
      } catch (err) {
        config.onError && config.onError(err.message);
      }
    });
    row.appendChild(deleteFolderBtn);
    li.appendChild(row);

    // Drag source: dragging this row moves the whole folder (see
    // moveFolderTo). Listener goes on `li` -- dragging any part of the row
    // still starts the drag from the same source element.
    li.draggable = true;
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData(FOLDER_DRAG_TYPE, String(folder.id));
      e.dataTransfer.effectAllowed = "move";
      li.classList.add("dragging");
    });
    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
    });

    // Drop target: dropping a dragged entry OR folder anywhere in this
    // folder's subtree (its own row, or any of its nested rows) moves it
    // into this folder. Listeners go on `li`, not `row` -- `row` is a
    // *sibling* of tree-children below, not an ancestor of it, so a drop
    // landing on a nested child would otherwise skip this folder entirely
    // and bubble straight to whatever ancestor is listening (wrongly "move
    // to root" if this is a top-level folder). `li` is an ancestor of both,
    // so this covers the whole subtree; stopPropagation still stops it from
    // also reaching the tree's root drop zone, and a MORE deeply nested
    // folder's own `li` listener (with its own stopPropagation) correctly
    // wins over this one when hovering specifically over it. `row` stays
    // the element that visually highlights, via classList calls from these
    // handlers. A dropped folder that would create a cycle (onto itself or
    // one of its own descendants) is rejected server-side, not here -- see
    // moveFolderTo.
    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "move";
      }
      row.classList.add("drag-over");
    });
    li.addEventListener("dragleave", (e) => {
      // dragleave also fires when moving between two elements *inside* this
      // subtree (e.g. from the row to a child entry) -- only clear the
      // highlight when actually leaving the subtree, not on every internal
      // boundary crossing.
      if (!li.contains(e.relatedTarget)) {
        row.classList.remove("drag-over");
      }
    });
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove("drag-over");
      handleDrop(e.dataTransfer, folder.id);
    });

    if (!collapsed) {
      const childList = document.createElement("ul");
      childList.className = "tree-children";
      for (const child of folder.children) {
        childList.appendChild(renderFolderNode(child, config));
      }
      for (const entry of folder.entries) {
        childList.appendChild(renderEntryNode(entry, config));
      }
      li.appendChild(childList);
    }

    return li;
  }

  function renderEntryNode(entry, config) {
    const li = document.createElement("li");
    li.className = "tree-entry entry-list-item";
    if (entry.id === config.openEntryId) {
      li.classList.add("active");
    }

    li.draggable = true;
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData(ENTRY_DRAG_TYPE, String(entry.id));
      e.dataTransfer.effectAllowed = "move";
      li.classList.add("dragging");
    });
    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
    });

    const titleBtn = document.createElement("button");
    titleBtn.type = "button";
    titleBtn.className = "entry-title-btn";
    titleBtn.textContent = entry.title || "Untitled";
    titleBtn.addEventListener("click", () => config.onOpenEntry(entry.id));
    li.appendChild(titleBtn);

    // Explicit alternative to dragging all the way out to the tree's empty
    // background (attachRootDropZone) -- only shown for an entry that's
    // actually inside a folder, since it'd be a no-op on one already at
    // root. Reuses moveEntryTo, same as a drag-and-drop move would.
    if (entry.folderId != null) {
      const moveToRootBtn = document.createElement("button");
      moveToRootBtn.type = "button";
      moveToRootBtn.className = "tree-action-btn";
      moveToRootBtn.title = "Move to world root";
      moveToRootBtn.setAttribute("aria-label", `Move ${entry.title || "entry"} to the world root`);
      moveToRootBtn.textContent = "↑";
      moveToRootBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        moveEntryTo(entry.id, null);
      });
      li.appendChild(moveToRootBtn);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "entry-delete-btn";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      config.onDeleteEntry(entry.id);
    });
    li.appendChild(deleteBtn);

    return li;
  }

  window.sidebar = { render };
})();
