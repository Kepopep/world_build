// Wikilink-aware markdown editor layer: tokenizes [[Title]] references plus
// general markdown syntax (headers/blockquote/lists/bold/italic/inline
// code/fenced code blocks) in the raw markdown source, renders a colored
// overlay behind the (transparent) raw textarea for edit mode, renders a
// real formatted-markdown DOM tree for view mode (see the "Rendered preview"
// section below -- app.js toggles which of the two is visible), routes
// click/dblclick against wikilink tokens on whichever surface is showing,
// drives the [[-triggered entity autocomplete popup (edit mode only), wires
// the formatting toolbar (#markdown-toolbar), and maintains a live word
// count.
//
// Design: docs/design/autocomplete-and-entity-references.md, sections 2.1-2.7,
// for the wikilink/autocomplete/click-routing pieces specifically -- the
// toolbar/general-syntax-highlighting/word-count pieces were added
// additively on top of that (see the Tokenizer and Markdown formatting
// toolbar sections below), per CLAUDE.md's editor implementation notes. The
// rendered preview is a further addition on top of the same tokenizer
// primitives, scoped to view mode only.
// Everything here works off the raw textarea value -- there is no DOM tree
// for the markdown itself in edit mode, only the overlay <div>'s disposable
// innerHTML; the preview <div> is real DOM, rebuilt wholesale on every
// resync (see renderPreviewInto()).

(function () {
  const WIKILINK_SOURCE = "\\[\\[([^\\[\\]\\n]+)\\]\\]";
  const AUTOCOMPLETE_DEBOUNCE_MS = 150;
  const AUTOCOMPLETE_LIMIT = 8;

  // Wired-up elements + callbacks, set by init(). editor.js only ever talks
  // to app.js through the callbacks passed here -- it never reaches into
  // app.js's `state` directly.
  let textareaEl = null;
  let overlayEl = null;
  let autocompleteEl = null;
  let toolbarEl = null;
  let wordCountEl = null;
  let previewEl = null;
  let worldId = null;
  let onNavigate = function () {};
  let onEntriesChanged = function () {};
  let onEscapeEdit = function () {};
  let listenersAttached = false;

  // Whether the entry is currently editable (app.js's edit-mode toggle,
  // read-only/view by default). Gates toolbar-control disabling
  // (updateToolbarDisabled) -- click-to-navigate no longer needs this flag
  // to disambiguate, since navigation now lives exclusively on the view-mode
  // preview surface (onPreviewClick) and the edit-mode textarea is a
  // completely separate, always-editable surface.
  let editingEnabled = false;

  // Map<lowercaseTitle, entryId> -- resolution index per 2.6. Rebuilt
  // wholesale on every init() call (app.js calls init() again whenever
  // state.entries changes), and updated incrementally in-place when
  // editor.js itself creates a stub entry (2.7).
  let titleIndex = new Map();

  // Token list for the text currently in the textarea, refreshed on every
  // input/render pass. Click/dblclick routing consults this instead of the
  // DOM, since the overlay's spans are not interactive (pointer-events: none).
  let currentTokens = [];

  // Wikilink-only view of currentTokens, same relative order. Extending the
  // tokenizer (below) to also produce header/list/blockquote/bold/italic/
  // code tokens means currentTokens is no longer exclusively wikilinks --
  // findTokenAtOffset (edit-mode dblclick-to-create-stub routing) must only
  // ever search wikilink tokens, so it's kept pointed at this filtered array
  // instead of currentTokens itself.
  let currentWikilinkTokens = [];

  // Autocomplete popup state.
  let acOpen = false;
  let acMatchStart = -1;
  let acSuggestions = [];
  let acSelectedIndex = 0;
  let acDebounceTimer = null;
  let acAbortController = null;

  function init(config) {
    textareaEl = config.textarea;
    overlayEl = config.overlay;
    autocompleteEl = config.autocompleteEl;
    toolbarEl = config.toolbarEl || null;
    wordCountEl = config.wordCountEl || null;
    previewEl = config.preview || null;
    worldId = config.worldId || null;
    onNavigate = typeof config.onNavigate === "function" ? config.onNavigate : function () {};
    onEntriesChanged = typeof config.onEntriesChanged === "function" ? config.onEntriesChanged : function () {};
    onEscapeEdit = typeof config.onEscapeEdit === "function" ? config.onEscapeEdit : function () {};
    editingEnabled = config.editing === true;

    titleIndex = buildTitleIndex(config.entries || []);

    if (!listenersAttached) {
      attachListeners();
      listenersAttached = true;
    }

    closeAutocomplete();
    refreshOverlay();
    updateToolbarDisabled();
    updateWordCount();
    renderPreviewInto();
  }

  function buildTitleIndex(entries) {
    const map = new Map();
    for (const entry of entries) {
      if (entry && entry.title) {
        map.set(entry.title.toLowerCase(), entry.id);
      }
    }
    return map;
  }

  // ---- Tokenizer -----------------------------------------------------
  //
  // Ordered pipeline, extended from the original wikilink-only single regex
  // pass (CLAUDE.md's "Editor implementation notes" always intended this to
  // be additive, not a rewrite):
  //   1. Fenced code blocks (```...```) -- opaque ranges; nothing else
  //      (including wikilinks) tokenizes inside them.
  //   2. Per-line block tokens (headers/blockquote/bullet/numbered list) --
  //      one token per whole line, skipping lines inside a codeblock range.
  //   3. Inline tokens (wikilink/inline-code/bold/italic) -- only on lines
  //      that a block token above didn't already claim, and outside
  //      codeblock ranges.
  //   4. Merge into one non-overlapping, start-sorted list: candidates are
  //      processed in priority order (codeblock > block-line > inline) and
  //      a candidate overlapping something already accepted is dropped.
  //
  // Known accepted v1 gap: a [[wikilink]] on the same line as a header/
  // bullet/blockquote marker won't tokenize as a wikilink -- the whole line
  // is already claimed by the block-line token in step 2, and step 3
  // deliberately skips claimed lines rather than trying to layer inline
  // tokens inside a block token's span. Not solved here on purpose.
  const CODEBLOCK_RE = /```[\s\S]*?```/g;
  const HEADER_LINE_RE = /^#{1,6}\s+/;
  const BLOCKQUOTE_LINE_RE = /^>\s?/;
  const BULLET_LINE_RE = /^\s*[-*]\s/;
  const NUMBERED_LINE_RE = /^\s*\d+\.\s/;
  const INLINE_CODE_RE = /`([^`\n]+)`/g;
  const BOLD_RE = /\*\*([^*\n]+)\*\*/g;
  // Guarded with lookaround so a lone `*` that's actually part of a `**bold**`
  // delimiter pair never matches as italic (see the tokenize() comment below
  // for a worked-through example of why this specific pattern avoids that).
  const ITALIC_RE = /(?<!\*)\*(?!\*)([^*\n]+)(?<!\*)\*(?!\*)/g;

  function splitLines(value) {
    const lines = [];
    let start = 0;
    let index = 0;
    while (start <= value.length) {
      let end = value.indexOf("\n", start);
      if (end === -1) {
        end = value.length;
      }
      lines.push({ start: start, end: end, index: index });
      if (end === value.length) {
        break;
      }
      start = end + 1;
      index++;
    }
    return lines;
  }

  function tokenize(value) {
    // 1. Fenced code block ranges.
    const codeblockRanges = [];
    CODEBLOCK_RE.lastIndex = 0;
    let cbMatch;
    while ((cbMatch = CODEBLOCK_RE.exec(value)) !== null) {
      codeblockRanges.push({ start: cbMatch.index, end: cbMatch.index + cbMatch[0].length });
    }
    function insideCodeblock(pos) {
      return codeblockRanges.some(function (r) {
        return pos >= r.start && pos < r.end;
      });
    }

    const candidates = codeblockRanges.map(function (r) {
      return { start: r.start, end: r.end, type: "codeblock", priority: 0 };
    });

    const lines = splitLines(value);
    const blockClaimedLines = new Set();

    // 2. Per-line block tokens.
    for (const line of lines) {
      if (line.start === line.end || insideCodeblock(line.start)) {
        continue;
      }
      const text = value.slice(line.start, line.end);
      let type = null;
      if (HEADER_LINE_RE.test(text)) {
        type = "header";
      } else if (BLOCKQUOTE_LINE_RE.test(text)) {
        type = "blockquote";
      } else if (BULLET_LINE_RE.test(text) || NUMBERED_LINE_RE.test(text)) {
        type = "list-marker";
      }
      if (type) {
        candidates.push({ start: line.start, end: line.end, type: type, priority: 1 });
        blockClaimedLines.add(line.index);
      }
    }

    // 3. Inline tokens, only on lines not already claimed above and outside
    // codeblock ranges.
    for (const line of lines) {
      if (line.start === line.end || insideCodeblock(line.start) || blockClaimedLines.has(line.index)) {
        continue;
      }
      const text = value.slice(line.start, line.end);
      let m;

      const wikiRe = new RegExp(WIKILINK_SOURCE, "g");
      while ((m = wikiRe.exec(text)) !== null) {
        const rawTitle = m[1];
        const start = line.start + m.index;
        const end = start + m[0].length;
        const entryId = titleIndex.get(rawTitle.toLowerCase());
        candidates.push({
          start: start,
          end: end,
          type: "wikilink",
          priority: 2,
          rawTitle: rawTitle,
          resolved: entryId !== undefined,
          entryId: entryId,
        });
      }

      INLINE_CODE_RE.lastIndex = 0;
      while ((m = INLINE_CODE_RE.exec(text)) !== null) {
        candidates.push({
          start: line.start + m.index,
          end: line.start + m.index + m[0].length,
          type: "inline-code",
          priority: 2,
        });
      }

      BOLD_RE.lastIndex = 0;
      while ((m = BOLD_RE.exec(text)) !== null) {
        candidates.push({
          start: line.start + m.index,
          end: line.start + m.index + m[0].length,
          type: "bold",
          priority: 2,
        });
      }

      ITALIC_RE.lastIndex = 0;
      while ((m = ITALIC_RE.exec(text)) !== null) {
        candidates.push({
          start: line.start + m.index,
          end: line.start + m.index + m[0].length,
          type: "italic",
          priority: 2,
        });
      }
    }

    // 4. Merge: priority order first (codeblock > block-line > inline), tie
    // broken by start offset; reject any candidate overlapping something
    // already accepted.
    candidates.sort(function (a, b) {
      return a.priority - b.priority || a.start - b.start;
    });
    const accepted = [];
    for (const candidate of candidates) {
      const overlaps = accepted.some(function (t) {
        return candidate.start < t.end && candidate.end > t.start;
      });
      if (!overlaps) {
        accepted.push(candidate);
      }
    }
    accepted.sort(function (a, b) {
      return a.start - b.start;
    });
    return accepted;
  }

  function findTokenAtOffset(offset) {
    return currentWikilinkTokens.find(function (token) {
      return offset > token.start && offset < token.end;
    });
  }

  // ---- Overlay renderer ------------------------------------------------

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Maps a token's `type` to the overlay span's CSS class. Wikilinks keep
  // their existing resolved/unresolved split (see css/editor.css); every
  // other type added by the extended tokenizer above maps 1:1 to one of the
  // new .md-* token classes (also css/editor.css), which are constrained to
  // color/font-weight/font-style/text-decoration/background-color only so
  // the overlay never drifts out of pixel alignment with the textarea.
  function tokenClassName(token) {
    switch (token.type) {
      case "wikilink":
        return token.resolved ? "wikilink-resolved" : "wikilink-unresolved";
      case "codeblock":
        return "md-code-block";
      case "header":
        return "md-header";
      case "blockquote":
        return "md-blockquote";
      case "list-marker":
        return "md-list-marker";
      case "inline-code":
        return "md-inline-code";
      case "bold":
        return "md-bold";
      case "italic":
        return "md-italic";
      default:
        return "";
    }
  }

  // Rebuilds the overlay's innerHTML from scratch. `caretOffset`, when a
  // number, gets a zero-width #caret-marker span inserted at that offset so
  // the autocomplete popup can position itself off the overlay (2.5) -- the
  // overlay already has identical font metrics to the textarea, so it
  // doubles as the "mirror" element instead of maintaining a second one.
  function renderOverlay(value, tokens, caretOffset) {
    const hasMarker = typeof caretOffset === "number";
    let html = "";
    let cursor = 0;

    function appendPlain(text, from) {
      if (hasMarker && caretOffset >= from && caretOffset <= from + text.length) {
        const localOffset = caretOffset - from;
        html +=
          escapeHtml(text.slice(0, localOffset)) +
          '<span id="caret-marker"></span>' +
          escapeHtml(text.slice(localOffset));
      } else {
        html += escapeHtml(text);
      }
    }

    for (const token of tokens) {
      appendPlain(value.slice(cursor, token.start), cursor);
      const cls = tokenClassName(token);
      html += '<span class="' + cls + '">' + escapeHtml(value.slice(token.start, token.end)) + "</span>";
      cursor = token.end;
    }
    appendPlain(value.slice(cursor), cursor);

    overlayEl.innerHTML = html;
  }

  function refreshOverlay() {
    const value = textareaEl.value;
    currentTokens = tokenize(value);
    currentWikilinkTokens = currentTokens.filter(function (t) {
      return t.type === "wikilink";
    });
    renderOverlay(value, currentTokens, null);
  }

  function syncOverlayScroll() {
    overlayEl.scrollTop = textareaEl.scrollTop;
    overlayEl.scrollLeft = textareaEl.scrollLeft;
  }

  // ---- Input handling: retokenize + autocomplete trigger ---------------

  function onTextareaInput() {
    const value = textareaEl.value;
    currentTokens = tokenize(value);
    currentWikilinkTokens = currentTokens.filter(function (t) {
      return t.type === "wikilink";
    });
    const caret = textareaEl.selectionStart;
    const trigger = detectTrigger(value, caret);

    renderOverlay(value, currentTokens, trigger ? caret : null);

    if (trigger) {
      openOrUpdateAutocomplete(trigger.matchStart, trigger.query);
    } else if (acOpen) {
      closeAutocomplete();
    }

    updateWordCount();
  }

  // Looks backward from the caret to the start of the current line for an
  // unclosed [[ -- per 2.5.
  function detectTrigger(value, caret) {
    const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
    const beforeCaret = value.slice(lineStart, caret);
    const m = beforeCaret.match(/\[\[([^\[\]]*)$/);
    if (!m) {
      return null;
    }
    return { matchStart: lineStart + m.index, query: m[1] };
  }

  // ---- Rendered preview (view mode) --------------------------------------
  //
  // View mode no longer shows the raw-source textarea+overlay at all (see
  // app.js's setEditing(), which hides #entry-content-wrapper and shows this
  // instead) -- it shows a real rendered DOM tree built from the same raw
  // markdown source. Rebuilt wholesale (innerHTML cleared, fresh DOM
  // appended) every time renderPreviewInto() runs, same "disposable, fully
  // rebuilt" spirit as the overlay's innerHTML, just with real elements
  // instead of styled spans. Block-level parsing here is intentionally
  // simple (no nested lists, no lazy blockquote continuation, no recursive
  // inline parsing inside bold/italic) -- known, accepted v1 gaps, not bugs.

  function renderPreviewInto() {
    if (!previewEl) {
      return;
    }
    previewEl.innerHTML = "";
    const frag = renderPreviewDOM(textareaEl.value);
    if (!frag.childNodes.length) {
      const empty = document.createElement("p");
      empty.className = "markdown-preview-empty";
      empty.textContent = "No content yet.";
      frag.appendChild(empty);
    }
    previewEl.appendChild(frag);
  }

  function renderPreviewDOM(value) {
    const frag = document.createDocumentFragment();
    const lines = value.split("\n");
    let i = 0;
    let paragraphBuf = [];
    let listBuf = null; // { type: "ul"|"ol", items: [] }

    function flushParagraph() {
      if (!paragraphBuf.length) {
        return;
      }
      const p = document.createElement("p");
      paragraphBuf.forEach(function (line, idx) {
        if (idx > 0) {
          p.appendChild(document.createElement("br"));
        }
        appendInline(p, line);
      });
      frag.appendChild(p);
      paragraphBuf = [];
    }
    function flushList() {
      if (!listBuf) {
        return;
      }
      const listEl = document.createElement(listBuf.type);
      listBuf.items.forEach(function (text) {
        const li = document.createElement("li");
        appendInline(li, text);
        listEl.appendChild(li);
      });
      frag.appendChild(listEl);
      listBuf = null;
    }

    while (i < lines.length) {
      const line = lines[i];

      const fence = line.match(/^```/);
      if (fence) {
        flushParagraph();
        flushList();
        const codeLines = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // skip closing fence if present
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = codeLines.join("\n");
        pre.appendChild(code);
        frag.appendChild(pre);
        continue;
      }

      if (line.trim() === "") {
        flushParagraph();
        flushList();
        i++;
        continue;
      }

      const header = line.match(/^(#{1,6})\s+(.*)$/);
      if (header) {
        flushParagraph();
        flushList();
        const h = document.createElement("h" + header[1].length);
        appendInline(h, header[2]);
        frag.appendChild(h);
        i++;
        continue;
      }

      if (BLOCKQUOTE_LINE_RE.test(line)) {
        flushParagraph();
        flushList();
        const bq = document.createElement("blockquote");
        let first = true;
        while (i < lines.length && BLOCKQUOTE_LINE_RE.test(lines[i])) {
          if (!first) {
            bq.appendChild(document.createElement("br"));
          }
          appendInline(bq, lines[i].replace(BLOCKQUOTE_LINE_RE, ""));
          first = false;
          i++;
        }
        frag.appendChild(bq);
        continue;
      }

      if (BULLET_LINE_RE.test(line)) {
        flushParagraph();
        if (!listBuf || listBuf.type !== "ul") {
          flushList();
          listBuf = { type: "ul", items: [] };
        }
        listBuf.items.push(line.replace(/^\s*[-*]\s/, ""));
        i++;
        continue;
      }
      if (NUMBERED_LINE_RE.test(line)) {
        flushParagraph();
        if (!listBuf || listBuf.type !== "ol") {
          flushList();
          listBuf = { type: "ol", items: [] };
        }
        listBuf.items.push(line.replace(/^\s*\d+\.\s/, ""));
        i++;
        continue;
      }

      flushList();
      paragraphBuf.push(line);
      i++;
    }
    flushParagraph();
    flushList();
    return frag;
  }

  // Inline pass: same regex constants + priority-merge idea as tokenize(),
  // scoped to one block's already-marker-stripped text (offset 0), not the
  // whole document. Deliberately NOT recursive (e.g. bold's inner text is
  // not re-scanned for wikilinks/italic) -- matches tokenize()'s existing
  // flat merge behavior so edit-mode and preview don't diverge on nested
  // markup. This is a known, accepted v1 gap, not a bug.
  function tokenizeInline(text) {
    const candidates = [];
    let m;
    const wikiRe = new RegExp(WIKILINK_SOURCE, "g");
    while ((m = wikiRe.exec(text)) !== null) {
      const entryId = titleIndex.get(m[1].toLowerCase());
      candidates.push({
        start: m.index,
        end: m.index + m[0].length,
        type: "wikilink",
        rawTitle: m[1],
        resolved: entryId !== undefined,
        entryId: entryId,
      });
    }
    INLINE_CODE_RE.lastIndex = 0;
    while ((m = INLINE_CODE_RE.exec(text)) !== null) {
      candidates.push({ start: m.index, end: m.index + m[0].length, type: "inline-code" });
    }
    BOLD_RE.lastIndex = 0;
    while ((m = BOLD_RE.exec(text)) !== null) {
      candidates.push({ start: m.index, end: m.index + m[0].length, type: "bold" });
    }
    ITALIC_RE.lastIndex = 0;
    while ((m = ITALIC_RE.exec(text)) !== null) {
      candidates.push({ start: m.index, end: m.index + m[0].length, type: "italic" });
    }

    candidates.sort(function (a, b) {
      return a.start - b.start;
    });
    const accepted = [];
    for (const c of candidates) {
      const overlaps = accepted.some(function (t) {
        return c.start < t.end && c.end > t.start;
      });
      if (!overlaps) {
        accepted.push(c);
      }
    }
    return accepted;
  }

  function appendInline(container, text) {
    const tokens = tokenizeInline(text);
    let cursor = 0;
    for (const token of tokens) {
      if (token.start > cursor) {
        container.appendChild(document.createTextNode(text.slice(cursor, token.start)));
      }
      container.appendChild(renderInlineToken(token, text));
      cursor = token.end;
    }
    if (cursor < text.length) {
      container.appendChild(document.createTextNode(text.slice(cursor)));
    }
  }

  function renderInlineToken(token, text) {
    switch (token.type) {
      case "wikilink": {
        const span = document.createElement("span");
        span.className = token.resolved ? "wikilink-resolved" : "wikilink-unresolved";
        span.textContent = token.rawTitle;
        span.dataset.wikilinkTitle = token.rawTitle;
        if (token.resolved) {
          span.dataset.entryId = token.entryId;
        }
        return span;
      }
      case "inline-code": {
        const code = document.createElement("code");
        code.textContent = text.slice(token.start + 1, token.end - 1);
        return code;
      }
      case "bold": {
        const strong = document.createElement("strong");
        strong.textContent = text.slice(token.start + 2, token.end - 2);
        return strong;
      }
      case "italic": {
        const em = document.createElement("em");
        em.textContent = text.slice(token.start + 1, token.end - 1);
        return em;
      }
      default:
        return document.createTextNode(text.slice(token.start, token.end));
    }
  }

  function onPreviewClick(event) {
    const el = event.target.closest(".wikilink-resolved");
    if (el) {
      onNavigate(Number(el.dataset.entryId));
    }
  }

  function onPreviewDblClick(event) {
    const el = event.target.closest(".wikilink-unresolved");
    if (el) {
      event.preventDefault();
      createStubEntry({ rawTitle: el.dataset.wikilinkTitle });
    }
  }

  // ---- Mouse handling: edit mode only ------------------------------------
  //
  // View mode no longer routes through the textarea at all -- it's simply
  // `hidden` (see app.js's setEditing(), which shows #entry-content-preview
  // in its place), not click-suppressed/inert the way it used to be. The
  // former view-mode-only concerns (native mousedown suppression,
  // coordinate-based token hit-testing via findTokenAtPoint, hover-cursor
  // swapping) have moved to the preview surface -- see onPreviewClick/
  // onPreviewDblClick above, which hit-test real rendered DOM elements
  // instead of textarea coordinates, and rely on ordinary CSS `cursor`
  // rules on those elements rather than a JS-driven cursor swap. What's
  // left here only ever fires while editing, so it's plain textarea
  // dblclick-to-create-stub using normal offset-based lookup.

  function onTextareaDblClick(event) {
    const token = findTokenAtOffset(textareaEl.selectionStart);
    if (token && !token.resolved) {
      event.preventDefault(); // suppress native double-click word-selection
      createStubEntry(token);
    }
    // dblclick + resolved -> no distinct behavior, per spec.
  }

  // ---- Stub creation -> flip the span in place (2.7) --------------------

  async function createStubEntry(token) {
    const key = token.rawTitle.toLowerCase();
    if (titleIndex.has(key)) {
      // Defensive re-check: became resolved by another update since the
      // last tokenize pass. Just refresh so the overlay/preview reflect it.
      refreshOverlay();
      renderPreviewInto();
      return;
    }
    try {
      const entry = await window.api.createEntry(worldId, {
        title: token.rawTitle,
        contentMarkdown: "",
      });
      titleIndex.set(entry.title.toLowerCase(), entry.id);
      refreshOverlay();
      renderPreviewInto();
      onEntriesChanged(entry);
    } catch (err) {
      console.error('Failed to create stub entry for "' + token.rawTitle + '":', err);
    }
  }

  // ---- Autocomplete popup (2.5) -----------------------------------------

  function openOrUpdateAutocomplete(matchStart, query) {
    acOpen = true;
    acMatchStart = matchStart;
    positionAutocomplete();
    scheduleSearch(query);
  }

  function scheduleSearch(query) {
    clearTimeout(acDebounceTimer);
    acDebounceTimer = setTimeout(function () {
      fetchSuggestions(query);
    }, AUTOCOMPLETE_DEBOUNCE_MS);
  }

  async function fetchSuggestions(query) {
    if (!worldId) {
      return;
    }
    if (acAbortController) {
      acAbortController.abort();
    }
    const controller = new AbortController();
    acAbortController = controller;
    try {
      const results = await window.api.searchEntryTitles(worldId, query, AUTOCOMPLETE_LIMIT, controller.signal);
      if (controller.signal.aborted || !acOpen) {
        return;
      }
      acSuggestions = results || [];
      acSelectedIndex = 0;
      renderAutocompletePopup();
      positionAutocomplete();
    } catch (err) {
      if (err && err.name === "AbortError") {
        return;
      }
      acSuggestions = [];
      renderAutocompletePopup();
    }
  }

  function renderAutocompletePopup() {
    autocompleteEl.innerHTML = "";
    if (!acOpen || acSuggestions.length === 0) {
      autocompleteEl.hidden = true;
      return;
    }
    acSuggestions.forEach(function (suggestion, index) {
      const item = document.createElement("div");
      item.className = "wikilink-suggestion" + (index === acSelectedIndex ? " selected" : "");
      item.textContent = suggestion.title;
      // mousedown (not click) + preventDefault so the textarea never loses
      // focus/selection before the suggestion is accepted.
      item.addEventListener("mousedown", function (e) {
        e.preventDefault();
        acceptSuggestion(suggestion);
      });
      autocompleteEl.appendChild(item);
    });
    autocompleteEl.hidden = false;
  }

  function positionAutocomplete() {
    const marker = overlayEl.querySelector("#caret-marker");
    if (!marker) {
      return;
    }
    const rect = marker.getBoundingClientRect();
    autocompleteEl.style.left = rect.left + "px";
    autocompleteEl.style.top = rect.bottom + 4 + "px";
  }

  function acceptSuggestion(suggestion) {
    if (acMatchStart < 0) {
      return;
    }
    const value = textareaEl.value;
    const caret = textareaEl.selectionStart;
    const newValue = value.slice(0, acMatchStart) + "[[" + suggestion.title + "]]" + value.slice(caret);
    const newCaret = acMatchStart + 2 + suggestion.title.length + 2;

    closeAutocomplete();

    textareaEl.value = newValue;
    textareaEl.setSelectionRange(newCaret, newCaret);
    textareaEl.focus();
    // Dispatch a real input event rather than calling our own handler
    // directly -- app.js's own "input" listener (markDirty) keeps working
    // unmodified, and this handler's own input listener retokenizes/
    // re-renders the overlay as a side effect.
    textareaEl.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function closeAutocomplete() {
    acOpen = false;
    acSuggestions = [];
    acSelectedIndex = 0;
    acMatchStart = -1;
    clearTimeout(acDebounceTimer);
    if (acAbortController) {
      acAbortController.abort();
      acAbortController = null;
    }
    if (autocompleteEl) {
      autocompleteEl.hidden = true;
      autocompleteEl.innerHTML = "";
    }
  }

  function onTextareaKeydown(event) {
    // Escape is handled first and independent of the autocomplete-only
    // guard below: with the popup open it just closes the popup (existing
    // behavior); with the popup closed and the entry editable, it exits
    // edit mode entirely via app.js's callback (state/DOM changes editor.js
    // doesn't own -- see the module doc comment). A layered escape, same as
    // most editors: first press dismisses the nearer thing.
    if (event.key === "Escape") {
      if (acOpen) {
        event.preventDefault();
        closeAutocomplete();
      } else if (editingEnabled) {
        event.preventDefault();
        onEscapeEdit();
      }
      return;
    }

    if (!acOpen) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (acSuggestions.length > 0) {
        acSelectedIndex = (acSelectedIndex + 1) % acSuggestions.length;
        renderAutocompletePopup();
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (acSuggestions.length > 0) {
        acSelectedIndex = (acSelectedIndex - 1 + acSuggestions.length) % acSuggestions.length;
        renderAutocompletePopup();
      }
    } else if (event.key === "Tab" || event.key === "Enter") {
      if (acSuggestions.length === 0) {
        return; // nothing to accept -- let Tab/Enter do their normal thing
      }
      event.preventDefault();
      acceptSuggestion(acSuggestions[acSelectedIndex]);
    }
  }

  function onDocumentClick(event) {
    if (!acOpen) {
      return;
    }
    if (autocompleteEl.contains(event.target)) {
      return;
    }
    closeAutocomplete();
  }

  // ---- Word count --------------------------------------------------------

  function updateWordCount() {
    if (!wordCountEl) {
      return;
    }
    const text = textareaEl.value.trim();
    const count = text === "" ? 0 : text.split(/\s+/).length;
    wordCountEl.textContent = count === 1 ? "1 word" : count + " words";
  }

  // ---- Markdown formatting toolbar ---------------------------------------
  //
  // Toolbar actions insert/wrap raw markdown syntax at the cursor rather
  // than manipulating a rich-text DOM, per CLAUDE.md's editor notes -- the
  // textarea's raw value is the only source of truth. Undo/redo deliberately
  // ride the browser's native undo stack (document.execCommand) instead of a
  // custom one: every insertion below also goes through execCommand
  // ('insertText'), which is what makes each toolbar action a single
  // undoable step indistinguishable from a real keystroke.

  // Replaces textareaEl[start:end] with `text` using the native
  // 'insertText' edit command (so it lands on the browser's own undo/redo
  // stack), falling back to a direct value assignment + a synthetic "input"
  // dispatch only if execCommand is unsupported/fails (some non-evergreen
  // or non-browser test environments). The success path already fires a
  // real "input" event on its own -- app.js's markDirty and this module's
  // own onTextareaInput (retokenize + word count) both run from that,
  // unmodified.
  function insertAtSelection(start, end, text) {
    textareaEl.focus();
    textareaEl.setSelectionRange(start, end);
    let ok = false;
    try {
      ok = document.execCommand && document.execCommand("insertText", false, text);
    } catch (err) {
      ok = false;
    }
    if (!ok) {
      const value = textareaEl.value;
      textareaEl.value = value.slice(0, start) + text + value.slice(end);
      const newPos = start + text.length;
      textareaEl.setSelectionRange(newPos, newPos);
      textareaEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  // Wraps the current selection in `before`/`after`. With no selection,
  // inserts before+placeholder+after and leaves `placeholder` selected so
  // the user can immediately overtype it (matches how most markdown editors
  // handle an empty-selection bold/italic/etc. click).
  function wrapSelection(before, after, placeholder) {
    const start = textareaEl.selectionStart;
    const end = textareaEl.selectionEnd;
    const hasSelection = end > start;
    const inner = hasSelection ? textareaEl.value.slice(start, end) : placeholder;
    const text = before + inner + after;
    insertAtSelection(start, end, text);
    if (hasSelection) {
      const pos = start + text.length;
      textareaEl.setSelectionRange(pos, pos);
    } else {
      const selStart = start + before.length;
      const selEnd = selStart + placeholder.length;
      textareaEl.setSelectionRange(selStart, selEnd);
    }
    textareaEl.focus();
  }

  // Line-based: strips any existing ATX `#` prefix from the caret's current
  // line, then applies the new one (level 0 = Normal/no prefix).
  function applyHeading(level) {
    const caret = textareaEl.selectionStart;
    const value = textareaEl.value;
    const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
    let lineEnd = value.indexOf("\n", caret);
    if (lineEnd === -1) {
      lineEnd = value.length;
    }
    const line = value.slice(lineStart, lineEnd);
    const stripped = line.replace(HEADER_LINE_RE, "");
    const prefix = level > 0 ? "#".repeat(level) + " " : "";
    const newLine = prefix + stripped;
    insertAtSelection(lineStart, lineEnd, newLine);
    const newCaret = lineStart + newLine.length;
    textareaEl.setSelectionRange(newCaret, newCaret);
    textareaEl.focus();
  }

  // Applies `makeLine(line)` to every line the current selection spans
  // (even a caret with no selection still counts as spanning its own
  // line), replacing that whole block in one insertAtSelection call so it's
  // one undo step. Used for bulleted/numbered lists and blockquote, each of
  // which toggles its own prefix on/off inside `makeLine`.
  function applyLinePrefixToSelection(makeLine) {
    const value = textareaEl.value;
    let start = textareaEl.selectionStart;
    let end = textareaEl.selectionEnd;
    // If the selection's end sits right after a trailing newline (e.g. a
    // triple-click / whole-line selection), don't let that pull a following
    // empty line into the block.
    if (end > start && value[end - 1] === "\n") {
      end -= 1;
    }
    const blockStart = value.lastIndexOf("\n", start - 1) + 1;
    let blockEnd = value.indexOf("\n", end);
    if (blockEnd === -1) {
      blockEnd = value.length;
    }
    const block = value.slice(blockStart, blockEnd);
    const newBlock = block.split("\n").map(makeLine).join("\n");
    insertAtSelection(blockStart, blockEnd, newBlock);
    const newCaret = blockStart + newBlock.length;
    textareaEl.setSelectionRange(newCaret, newCaret);
    textareaEl.focus();
  }

  function toggleBulletList() {
    applyLinePrefixToSelection(function (line) {
      if (BULLET_LINE_RE.test(line)) {
        return line.replace(/^(\s*)[-*]\s/, "$1");
      }
      if (line.trim() === "") {
        return line;
      }
      return line.replace(/^(\s*)/, "$1- ");
    });
  }

  function toggleNumberedList() {
    let n = 1;
    applyLinePrefixToSelection(function (line) {
      if (NUMBERED_LINE_RE.test(line)) {
        return line.replace(/^(\s*)\d+\.\s/, "$1");
      }
      if (line.trim() === "") {
        return line;
      }
      return line.replace(/^(\s*)/, "$1" + n++ + ". ");
    });
  }

  function toggleBlockquote() {
    applyLinePrefixToSelection(function (line) {
      if (BLOCKQUOTE_LINE_RE.test(line)) {
        return line.replace(BLOCKQUOTE_LINE_RE, "");
      }
      if (line.trim() === "") {
        return line;
      }
      return "> " + line;
    });
  }

  // Inserts `[text](url)` / `![alt](url)`, using the current selection as
  // the label/alt text if there is one, and leaves the `url` placeholder
  // selected for immediate overtyping.
  function insertLinkOrImage(isImage) {
    const start = textareaEl.selectionStart;
    const end = textareaEl.selectionEnd;
    const selected = textareaEl.value.slice(start, end);
    const label = selected || (isImage ? "alt text" : "link text");
    const url = "url";
    const prefix = isImage ? "![" : "[";
    const text = prefix + label + "](" + url + ")";
    insertAtSelection(start, end, text);
    const urlStart = start + prefix.length + label.length + 2; // "](".length
    const urlEnd = urlStart + url.length;
    textareaEl.setSelectionRange(urlStart, urlEnd);
    textareaEl.focus();
  }

  function updateToolbarDisabled() {
    if (!toolbarEl) {
      return;
    }
    const controls = toolbarEl.querySelectorAll("[data-md-action], select");
    controls.forEach(function (el) {
      el.disabled = !editingEnabled;
    });
  }

  function onToolbarClick(event) {
    const btn = event.target.closest("[data-md-action]");
    if (!btn || !toolbarEl.contains(btn) || !editingEnabled) {
      return;
    }
    event.preventDefault();
    switch (btn.dataset.mdAction) {
      case "undo":
        textareaEl.focus();
        document.execCommand("undo");
        break;
      case "redo":
        textareaEl.focus();
        document.execCommand("redo");
        break;
      case "bold":
        wrapSelection("**", "**", "bold text");
        break;
      case "italic":
        wrapSelection("*", "*", "italic text");
        break;
      case "underline":
        wrapSelection("<u>", "</u>", "underlined text");
        break;
      case "strikethrough":
        wrapSelection("~~", "~~", "strikethrough text");
        break;
      case "link":
        insertLinkOrImage(false);
        break;
      case "image":
        insertLinkOrImage(true);
        break;
      case "bullet-list":
        toggleBulletList();
        break;
      case "numbered-list":
        toggleNumberedList();
        break;
      case "blockquote":
        toggleBlockquote();
        break;
      case "inline-code":
        wrapSelection("`", "`", "code");
        break;
      case "code-block":
        wrapSelection("```\n", "\n```", "code");
        break;
      default:
        break;
    }
    updateWordCount();
  }

  function onHeadingSelectChange(event) {
    if (!editingEnabled) {
      return;
    }
    applyHeading(parseInt(event.target.value, 10) || 0);
    updateWordCount();
  }

  // ---- Wiring -----------------------------------------------------------

  function attachListeners() {
    textareaEl.addEventListener("input", onTextareaInput);
    textareaEl.addEventListener("dblclick", onTextareaDblClick);
    textareaEl.addEventListener("keydown", onTextareaKeydown);
    textareaEl.addEventListener("blur", closeAutocomplete);
    textareaEl.addEventListener("scroll", syncOverlayScroll);
    document.addEventListener("click", onDocumentClick);

    if (toolbarEl) {
      toolbarEl.addEventListener("click", onToolbarClick);
      const headingSelect = toolbarEl.querySelector("[data-md-heading]");
      if (headingSelect) {
        headingSelect.addEventListener("change", onHeadingSelectChange);
      }
    }

    if (previewEl) {
      previewEl.addEventListener("click", onPreviewClick);
      previewEl.addEventListener("dblclick", onPreviewDblClick);
    }
  }

  window.editor = {
    init: init,
  };
})();
