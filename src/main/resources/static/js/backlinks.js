// Right-rail "Links" panel: two collapsible, wikilink-derived sections for
// the currently open entry, "Linked to" above "Linked from" --
//   - Linked to: titles the open entry's own [[wikilink]]s reference,
//     split into "Active" (an entry with that title exists -- clickable,
//     navigates) and "Inactive" (no entry with that title exists yet --
//     display-only, styled like editor.js's unresolved wikilink highlight).
//   - Linked from: OTHER entries whose content resolves a
//     [[This Entry's Title]] reference back to the open entry (incoming
//     references) -- always "active" since a Linked-from entry has to exist
//     to have content in the first place, so this section isn't split.
// Both are wikilink-derived only, same resolution convention (case-
// insensitive title match) editor.js/graph.js already use -- NOT blocked on
// the backend Relation system. A future "Related via ..." section built on
// formal Relations can sit alongside these later; this panel is
// deliberately scoped to just the wikilink-derived halves.
//
// Same arm's-length pattern as sidebar.js/tags.js/graph.js: only ever talks
// back to app.js via the onNavigate callback passed to render(), and reads
// state.entries only via what's handed to it in config, never reaching into
// app.js's `state` directly.

(function () {
  // Which of the two top-level sections are collapsed -- pure client-side
  // presentation state, not persisted or sent to the server, same reasoning
  // as sidebar.js's collapsedFolderIds: it lives here (module scope) rather
  // than in app.js's state so it survives across render() calls (switching
  // entries) without app.js needing to know or care about it. Both start
  // expanded, per spec.
  const collapsedSections = { "linked-to": false, "linked-from": false };

  // config: { entries, currentEntry, onNavigate(id) }
  function render(container, config) {
    container.innerHTML = "";
    const currentEntry = config.currentEntry;
    if (!currentEntry) {
      renderEmpty(container, "No entry open.");
      return;
    }

    const entries = config.entries || [];
    const titleLower = (currentEntry.title || "").trim().toLowerCase();

    const entryByTitle = new Map();
    for (const entry of entries) {
      if (entry.id === currentEntry.id) {
        continue;
      }
      const key = (entry.title || "").trim().toLowerCase();
      if (key) {
        entryByTitle.set(key, entry);
      }
    }

    // "Linked to": every distinct title the open entry's own [[wikilink]]s
    // reference, split by whether an entry with that title exists yet.
    const referencedTitles = window.wikilinkParser.extractWikilinks(currentEntry.contentMarkdown);
    const seenLower = new Set();
    const linkedToActive = [];
    const linkedToInactive = [];
    for (const rawTitle of referencedTitles) {
      const lower = rawTitle.toLowerCase();
      if (!lower || seenLower.has(lower)) {
        continue;
      }
      seenLower.add(lower);
      const target = entryByTitle.get(lower);
      if (target) {
        linkedToActive.push(target);
      } else {
        linkedToInactive.push(rawTitle);
      }
    }
    linkedToActive.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    linkedToInactive.sort((a, b) => a.localeCompare(b));

    // "Linked from": every OTHER entry whose content resolves a
    // [[Open Entry's Title]] reference back here. Always "active" -- a
    // Linked-from entry exists by definition (it has content to search).
    const linkedFrom = entries.filter((entry) => {
      if (!titleLower || entry.id === currentEntry.id) {
        return false;
      }
      const refs = window.wikilinkParser
        .extractWikilinks(entry.contentMarkdown)
        .map((t) => t.toLowerCase());
      return refs.includes(titleLower);
    });
    linkedFrom.sort((a, b) => (a.title || "").localeCompare(b.title || ""));

    renderSection(
      container,
      "linked-to",
      "Linked to",
      linkedToActive.length + linkedToInactive.length,
      (body) => {
        renderSubgroup(
          body,
          "active",
          "Active",
          linkedToActive,
          "No links to existing entries yet.",
          (entry) => makeActiveItem(entry, config.onNavigate)
        );
        renderSubgroup(
          body,
          "inactive",
          "Inactive",
          linkedToInactive,
          "No links to not-yet-created entries.",
          (title) => makeInactiveItem(title, config.worldId, config.onEntriesChanged)
        );
      }
    );

    renderSection(container, "linked-from", "Linked from", linkedFrom.length, (body) => {
      renderList(body, linkedFrom, "No entries link here yet.", (entry) =>
        makeActiveItem(entry, config.onNavigate)
      );
    });
  }

  // Builds one collapsible top-level section: a toggle header (chevron +
  // label + a pill count badge) and a body populated by `fillBody(body)`.
  // Collapse state is read/written from the shared `collapsedSections` map
  // above, keyed by `key` ("linked-to" / "linked-from").
  function renderSection(container, key, label, count, fillBody) {
    const section = document.createElement("div");
    section.className = "backlink-section";

    const collapsed = collapsedSections[key];

    const header = document.createElement("button");
    header.type = "button";
    header.className = "backlink-section-header";
    header.setAttribute("aria-expanded", String(!collapsed));

    const toggle = document.createElement("span");
    toggle.className = "backlink-section-toggle" + (collapsed ? " collapsed" : "");
    header.appendChild(toggle);

    const title = document.createElement("span");
    title.className = "backlink-section-title";
    title.textContent = label;
    header.appendChild(title);

    const badge = document.createElement("span");
    badge.className = "backlink-count-badge";
    badge.textContent = String(count);
    header.appendChild(badge);

    const body = document.createElement("div");
    body.className = "backlink-section-body";
    body.hidden = collapsed;

    header.addEventListener("click", () => {
      const nowCollapsed = !body.hidden;
      body.hidden = nowCollapsed;
      collapsedSections[key] = nowCollapsed;
      toggle.classList.toggle("collapsed", nowCollapsed);
      header.setAttribute("aria-expanded", String(!nowCollapsed));
    });

    fillBody(body);

    section.appendChild(header);
    section.appendChild(body);
    container.appendChild(section);
  }

  // A labeled sub-group inside the "Linked to" section body (Active /
  // Inactive), rendered as its own scrollable .backlink-list. `kind` is
  // "active"/"inactive" -- drives the small color-coded dot next to the
  // subgroup label (css/backlinks.css), matching the accent/warn colors the
  // items themselves use.
  function renderSubgroup(body, kind, label, items, emptyMessage, makeItem) {
    const subgroup = document.createElement("div");
    subgroup.className = "backlink-subgroup";

    const heading = document.createElement("h5");
    heading.className = `backlink-subgroup-title backlink-subgroup-title-${kind}`;
    heading.textContent = `${label} (${items.length})`;
    subgroup.appendChild(heading);

    renderList(subgroup, items, emptyMessage, makeItem);
    body.appendChild(subgroup);
  }

  function renderList(container, items, emptyMessage, makeItem) {
    const list = document.createElement("div");
    list.className = "backlink-list";

    if (items.length === 0) {
      const p = document.createElement("p");
      p.className = "side-panel-empty";
      p.textContent = emptyMessage;
      list.appendChild(p);
    } else {
      for (const item of items) {
        list.appendChild(makeItem(item));
      }
    }

    container.appendChild(list);
  }

  // A clickable, navigable item for an entry that exists -- same accent
  // color as editor.css's .wikilink-resolved, so "this points at a real
  // entry" reads identically here and in the main content block. Also
  // carries the same hover-preview popup (js/link-preview.js) as a resolved
  // [[wikilink]] in the main text -- this item IS a link to an entry that
  // already exists, so it qualifies the same way.
  function makeActiveItem(entry, onNavigate) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "backlink-item backlink-item-active";
    btn.textContent = entry.title || "Untitled";
    btn.addEventListener("click", () => onNavigate(entry.id));
    window.linkPreview.attach(btn, entry);
    return btn;
  }

  // A [[wikilink]] title with no matching entry yet -- same "not created
  // yet" visual language as editor.css's .wikilink-unresolved, and the same
  // underlying create-stub call as double-clicking an unresolved reference
  // in the main text (editor.js's createStubEntry): creates an
  // empty-content Entry with this exact title, then hands it to
  // config.onEntriesChanged. What happens next is entirely up to the
  // caller -- app.js's onLinkedToStubCreated navigates straight into the
  // new entry in edit mode (unlike editor.js's own in-place flip, there's
  // no in-progress edit on *this* entry to preserve, since the panel is
  // otherwise display-only), which also takes care of refreshing this
  // panel for the newly-opened entry.
  function makeInactiveItem(title, worldId, onEntriesChanged) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "backlink-item backlink-item-inactive";
    btn.textContent = title;
    btn.title = `Click to create "${title}"`;
    btn.addEventListener("click", () => createStubEntry(title, worldId, onEntriesChanged, btn));
    return btn;
  }

  async function createStubEntry(title, worldId, onEntriesChanged, triggerEl) {
    if (triggerEl) {
      triggerEl.disabled = true;
      triggerEl.classList.add("creating");
    }
    try {
      const entry = await window.api.createEntry(worldId, { title, contentMarkdown: "" });
      if (onEntriesChanged) {
        onEntriesChanged(entry);
      }
    } catch (err) {
      console.error('Failed to create stub entry for "' + title + '":', err);
      if (triggerEl) {
        triggerEl.disabled = false;
        triggerEl.classList.remove("creating");
      }
    }
  }

  function renderEmpty(container, message) {
    const p = document.createElement("p");
    p.className = "side-panel-empty";
    p.textContent = message;
    container.appendChild(p);
  }

  window.backlinks = { render };
})();
