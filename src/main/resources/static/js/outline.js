// Right-rail outline panel: a clickable, indented list of the open entry's
// #{1,6} markdown headings, parsed client-side from its raw contentMarkdown
// (no server round trip -- the content is already loaded). Same arm/s-length
// pattern as sidebar.js/tags.js/graph.js: only ever talks back to app.js via
// the onSelect callback passed to render().
//
// The heading-line regex mirrors editor.js's own header detection (its
// tokenizer's HEADER_LINE_RE / renderPreviewDOM's ATX-heading match) rather
// than importing it -- editor.js doesn't expose either as a reusable
// function (they're private to its closure), and re-deriving one small regex
// pass here is simpler than changing editor.js's module boundary just for
// this.

(function () {
  const HEADER_LINE_RE = /^(#{1,6})\s+(.*)$/;

  // Returns [{ level, text, offset, lineLength }, ...] in source order.
  // `offset` is the char offset of the heading line's start in `markdown`
  // (including its leading `#`s) -- what app.js needs to place the textarea
  // caret there in edit mode.
  function parseHeadings(markdown) {
    const headings = [];
    if (!markdown) {
      return headings;
    }
    const lines = markdown.split("\n");
    let offset = 0;
    for (const line of lines) {
      const m = line.match(HEADER_LINE_RE);
      if (m) {
        headings.push({
          level: m[1].length,
          text: m[2].trim(),
          offset: offset,
          lineLength: line.length,
        });
      }
      offset += line.length + 1; // +1 for the "\n" split() stripped
    }
    return headings;
  }

  // config: { markdown, onSelect(heading) } -- heading also carries `index`
  // (its position among all headings, in source order), which callers can
  // use to find the matching rendered-preview element when the textarea
  // itself isn't visible (view mode).
  function render(container, config) {
    container.innerHTML = "";
    const headings = parseHeadings(config.markdown || "");

    if (headings.length === 0) {
      const empty = document.createElement("p");
      empty.className = "side-panel-empty";
      empty.textContent = "No headings yet.";
      container.appendChild(empty);
      return;
    }

    headings.forEach((heading, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "outline-item";
      btn.dataset.level = String(heading.level);
      btn.textContent = heading.text || "(untitled heading)";
      btn.addEventListener("click", () => {
        config.onSelect && config.onSelect(Object.assign({ index: index }, heading));
      });
      container.appendChild(btn);
    });
  }

  window.outline = { render };
})();
