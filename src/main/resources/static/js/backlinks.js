// Right-rail "Linked from" panel: every OTHER entry in the world whose raw
// markdown contains a resolved [[This Entry's Title]] reference back to the
// currently open entry. Wikilink-derived only, same resolution convention
// (case-insensitive title match) editor.js/graph.js already use -- NOT
// blocked on the backend Relation system. A future "Related via ..." section
// built on formal Relations can sit alongside this later; this panel is
// deliberately scoped to just the wikilink-derived half.
//
// Same arm's-length pattern as sidebar.js/tags.js/graph.js: only ever talks
// back to app.js via the onNavigate callback passed to render(), and reads
// state.entries only via what's handed to it in config, never reaching into
// app.js's `state` directly.

(function () {
  // config: { entries, currentEntry, onNavigate(id) }
  function render(container, config) {
    container.innerHTML = "";
    const currentEntry = config.currentEntry;
    if (!currentEntry) {
      renderEmpty(container, "No entry open.");
      return;
    }

    const titleLower = (currentEntry.title || "").trim().toLowerCase();
    const linkers = (config.entries || []).filter((entry) => {
      if (!titleLower || entry.id === currentEntry.id) {
        return false;
      }
      const referencedTitles = window.wikilinkParser
        .extractWikilinks(entry.contentMarkdown)
        .map((t) => t.toLowerCase());
      return referencedTitles.includes(titleLower);
    });

    if (linkers.length === 0) {
      renderEmpty(container, "No entries link here yet.");
      return;
    }

    linkers.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    for (const entry of linkers) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "backlink-item";
      btn.textContent = entry.title || "Untitled";
      btn.addEventListener("click", () => config.onNavigate(entry.id));
      container.appendChild(btn);
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
