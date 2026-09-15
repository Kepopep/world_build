# Design: Inline Autocomplete + Wikilink Entity References

Status: proposed, not implemented.
Scope: two editor features layered onto the current World+Entry skeleton
(no Folder/Tag/Relation/Graph -- see "Explicit non-goals" at the end).

Level analyzed: single-module feature design (the entry editor + a narrow
slice of the Entry backend). Not a system-wide redesign.

## 0. What exists today (baseline this design builds on)

- EntryController (src/main/java/com/hisder/worldBuilding/entry/EntryController.java:19)
  exposes GET/POST /api/worlds/{worldId}/entries, GET/PATCH/DELETE /api/entries/{id}.
- EntryService (.../entry/EntryService.java:14) does simple CRUD; createEntry
  only validates title non-blank, no uniqueness check.
- Entry (.../entry/Entry.java:32) has no unique constraint on (worldId, title).
- Frontend editor is a plain <textarea id="entry-content">
  (src/main/resources/static/index.html:36) with no tokenizing, no overlay,
  no toolbar -- js/app.js just reads/writes .value and calls
  markDirty()/PATCH on Save (src/main/resources/static/js/app.js:191,229).
- js/app.js already loads the entire flat entry list for a world into
  state.entries on world switch (js/app.js:118, via GET /api/worlds/{worldId}/entries)
  -- there is no Folder scoping or pagination yet, so this list is a complete,
  already-in-memory picture of "every entry title in this world."

That last point drives a key decision below: do not build new backend
infrastructure to answer a question the frontend can already answer from
data it has already fetched.

## 1. REST contract additions

### New: entry-title typeahead endpoint

```
GET /api/worlds/{worldId}/entries/search?q={text}&limit={n}
```

- 200 -> List<EntryTitleSuggestion>, where
  EntryTitleSuggestion { id: Long, title: String, icon: String|null }
  -- deliberately leaner than EntryResponse (no contentMarkdown,
  summary, timestamps) since this fires on every debounced keystroke.
- limit optional, default 8.
- q optional; blank/missing q -> [] (not a 400 -- the popup calls this
  with a partial/empty query while the user is mid-[[, and an error there
  would be a UX bug, not a real client error).
- 404 if worldId does not exist (same getWorldOrThrow pattern already
  used in EntryService).
- Case-insensitive substring match on title, ordered alphabetically.
  Prefix-priority ranking (prefix matches before mid-string matches) is a
  nice-to-have, not required for v1 -- call it out as a follow-up, do not
  build it now.

Where this lives: EntryService, not a new SearchService/search/ package.
This is a single-field query over Entry.title scoped by worldId -- it does
not need its own component. CLAUDE.md's suggested layout explicitly leaves
search/ query logic as "in EntryService or its own service" -- this is
exactly the case where reusing EntryService is the right call, since
introducing a search/ package now would be scaffolding for the general
content search feature (title+summary+content, checklist item,
GET /api/worlds/{worldId}/search?q=) that is not in scope yet. When that
lands, it can promote/absorb this method; no need to guess its shape now.

Repository addition (EntryRepository):

```java
@Query("select e from Entry e where e.world.id = :worldId "
     + "and lower(e.title) like lower(concat('%', :query, '%')) "
     + "order by e.title asc")
List<Entry> searchByTitle(@Param("worldId") Long worldId,
                           @Param("query") String query,
                           Pageable pageable);
```
called with PageRequest.of(0, limit) purely to cap result count.

### Stub entry creation: reuse the existing endpoint, no new one

POST /api/worlds/{worldId}/entries (EntryController.java:35) already takes
{title, contentMarkdown} and returns 201 EntryResponse. That is sufficient
for stub creation -- the frontend calls it with
{ title: <wikilink text>, contentMarkdown: "" }. No leaner variant is
warranted; the payload is already minimal. No backend change needed here.

### Open question this surfaces: no unique-title constraint

Entry has no (worldId, title) uniqueness constraint today, but wikilink
resolution assumes a title maps to one entry within a world. Nothing in
this design requires adding that constraint (out of scope -- it is a
schema change with its own migration/UX implications, e.g. what happens to
existing duplicate titles). Recommendation: resolution logic should pick a
deterministic winner among duplicates (e.g. lowest id / first created) and
this should be called out to whoever implements it as a known, accepted
gap -- not silently ignored. Flagging for the user to decide whether to
also add a uniqueness constraint now or defer it.

## 2. Frontend architecture

### 2.1 Rendering approach: textarea + overlay, not contenteditable

CLAUDE.md's editor notes leave the choice open ("a contenteditable (or
textarea + overlay)"). This design picks textarea + overlay:

- A transparent <textarea id="entry-content"> sits on top, owns focus,
  caret, selection, and all keyboard/pointer input -- nothing new here
  versus what exists today.
- A non-interactive <div id="entry-content-overlay"> sits directly behind
  it (position: absolute; inset: 0, identical font/line-height/padding),
  showing the same text re-rendered with [[...]] tokens wrapped in colored
  spans. pointer-events: none on the overlay -- all clicks land on the
  textarea.
- Scroll positions are kept in sync (textarea scroll event copies
  scrollTop/scrollLeft to the overlay).

Why not contenteditable: this problem needs the raw markdown source to stay
literally editable text (per CLAUDE.md's editor notes -- visible #, [[,
etc.) while re-rendering colored spans on every keystroke. contenteditable
makes that re-render step dangerous -- replacing innerHTML while the caret
lives inside that same DOM tree requires manually saving/restoring a Range
on every input, and gets materially harder once IME composition or
multi-node selections are involved. With the overlay split, the caret never
lives in the div that gets re-rendered -- the overlay's innerHTML can be
thrown away and rebuilt on every keystroke (or after a stub is created)
with zero cursor-position bookkeeping, because the textarea holding focus
is a completely separate element that is never touched by that rebuild.
This directly answers the "how does the overlay survive active
typing/re-tokenization" question: by construction, not by save/restore
logic.

Trade-off accepted: this does not give per-character inline formatting
inside the textarea itself (e.g. you cannot literally bold-render text
within the input surface) -- but that is already true of the "raw markdown
source" spec (headers/bullets are meant to stay visible as literal #/-,
not rendered), so it costs nothing here.

### 2.2 Tokenizer / overlay renderer

Single regex pass, scoped only to [[...]] for this design:

```js
const WIKILINK_RE = /\[\[([^\[\]\n]+)\]\]/g;
```

For each match: { start, end, rawTitle, resolved: bool, entryId?: number }.
resolved comes from an in-memory title index, not a network call (see 2.6).
Non-token text is HTML-escaped and passed through unstyled -- no
header/bold/list token coloring in this design.

Scope call: CLAUDE.md's implementation order lists full markdown syntax
highlighting (headers/bold/lists/code) as a separate later step (item 7).
This design deliberately does not build that now -- it only wraps [[...]]
spans. The tokenizer function is structured as one regex pass over the
source producing a token list consumed by the overlay renderer, so adding
header/bold/list passes later is an additive change to the same function,
not a rewrite.

### 2.3 Two highlight states -- CSS

```css
#entry-content {
  position: relative; z-index: 1;
  color: transparent; caret-color: var(--color-text);
  background: transparent;
}
#entry-content-overlay {
  position: absolute; inset: 0; z-index: 0;
  pointer-events: none; white-space: pre-wrap; word-wrap: break-word;
}
.wikilink-resolved   { color: var(--color-accent); text-decoration: underline; cursor: pointer; }
.wikilink-unresolved { color: var(--color-warn, #d98c46); text-decoration: underline dotted; }
```

Both states keep the literal [[/]] visible (per the raw-source spec) --
only the color/decoration differs. cursor: pointer is cosmetic only, since
the overlay does not receive pointer events; the textarea's own cursor
style would need a matching rule when the caret is over a resolved span,
which is a minor nice-to-have, not required for function.

### 2.4 Click vs double-click, against raw-source text (not DOM spans)

Because the overlay has pointer-events: none, clicks always land on the
textarea, never on a span. So token targeting cannot be "attach a listener
to the span" -- instead:

1. On click/dblclick, read textarea.selectionStart. The browser has already
   placed the caret at the clicked character offset by the time the event
   fires -- no coordinate math needed.
2. Look up that offset in the current token list (start < offset < end,
   strict interior so a caret sitting exactly on a bracket boundary does
   not count as "inside").
3. Route by event type and resolution state:
   - click + resolved token -> navigate (call the existing entry-open flow
     with token.entryId).
   - click + unresolved token -> no-op (per spec, unresolved links are not
     clickable).
   - dblclick + unresolved token -> event.preventDefault() (suppress the
     browser's native double-click word-selection), create the stub entry.
   - dblclick + resolved token -> no distinct behavior defined by spec;
     falls through to whatever click already did (see the race note
     below).

This click/dblclick split turns out not to need the usual
"delay-single-click-in-case-a-dblclick-follows" debounce trick. That trick
exists when click and dblclick both do something on the same condition;
here they do not overlap -- click only acts on resolved tokens, dblclick
only acts on unresolved tokens, and each no-ops on the other's condition.
The browser still fires click before dblclick in both cases, but since
click on an unresolved token is a genuine no-op, there is nothing to race
against.

Known edge case, called out rather than engineered around: rapid
double-click on a resolved link fires click first, which navigates
immediately (replacing the editor's content for the newly-opened entry);
the subsequent dblclick then lands on whatever text is now at that pixel
position in the new entry. This is cosmetically odd (a stray second click
after navigation) but not harmful -- no data is corrupted, worst case is an
unwanted caret placement or word-selection in the newly loaded entry. If
this proves annoying in practice, gating navigation behind
event.detail === 1 with a short timeout is the standard fix; not building
that preemptively.

Separate open question worth flagging to the user: per spec, a single
click on a resolved link navigates immediately. That means there is no way
to click into an existing resolved [[Title]] span to place the caret there
for editing (e.g. fixing a typo in the title) -- any click on it leaves the
entry. Implemented as literally specified, but this is a real
editing-ergonomics trade-off; a Ctrl/Cmd+click-to-navigate /
plain-click-to-position-caret split is the usual fix if this turns out to
matter in practice.

### 2.5 Autocomplete: trigger, positioning, dismissal

Trigger (on every input event, after retokenizing): look backward from
textarea.selectionStart to the start of the current line for an unclosed
[[:

```js
const beforeCaret = value.slice(lineStart, caret);
const m = beforeCaret.match(/\[\[([^\[\]]*)$/);
```

If matched: matchStart = lineStart + m.index, query = m[1] (may be empty
right after typing [[) -> open/update the popup. If not matched -> hide
the popup.

Scope call -- entity-only, no generic markdown snippet completion. Keeping
this single-purpose for v1: one trigger pattern ([[), one provider (entry
titles). Generic snippet completion (## -> heading, code fence, etc.) is a
different trigger surface (any token position, not just after [[) with a
different, currently-nonexistent data source (a snippet dictionary that
does not exist in this codebase yet, and is not requested by any CLAUDE.md
checklist item). Bolting it onto this feature now would mean inventing a
snippet config format under time pressure rather than as a deliberate
follow-up. The trigger-detection -> provider -> popup shape here is generic
enough that adding a second provider later (matched on a different trigger
regex) is additive, not a redesign -- so deferring does not box this in.

Suggestion source: the new GET /api/worlds/{worldId}/entries/search
endpoint, debounced ~150ms, with the in-flight request aborted
(AbortController) if a newer keystroke supersedes it before the response
lands (avoids a slow stale response clobbering a newer, faster one).

Positioning, reusing the overlay rather than building a second mirror
element: the overlay already renders the textarea's text with identical
font metrics, so while the popup is open, the overlay-build step inserts a
zero-width <span id="caret-marker"></span> at the caret offset; the popup
is positioned via caretMarker.getBoundingClientRect(). This avoids
maintaining a second hidden "mirror div" purely for caret-position
measurement -- the overlay already is that mirror.

Accept (Tab or Enter) -- splice into raw source, not the DOM:

```js
const newValue = value.slice(0, matchStart) + "[[" + suggestion.title + "]]" + value.slice(caret);
textarea.value = newValue;
const newCaret = matchStart + 2 + suggestion.title.length + 2;
textarea.setSelectionRange(newCaret, newCaret);
textarea.dispatchEvent(new Event("input", { bubbles: true }));
```

Dispatching a real input event (rather than calling internal functions
directly) is deliberate: js/app.js's existing
els.entryContent.addEventListener("input", markDirty) keeps working
unmodified -- editor.js does not need to know about app.js's
dirty-tracking or reimplement it.

Dismiss: Escape closes without accepting; clicking outside the popup
closes it; the trigger regex failing to match on the next input (e.g. the
user types a space or closes ]] manually) closes it naturally. Arrow
Up/Down move the highlighted suggestion within the open popup.

### 2.6 Resolution state: in-memory index, not a per-keystroke network call

Retokenizing runs on every keystroke, so resolution (resolved vs
unresolved color) must not hit the network. Instead: maintain a
Map<lowercaseTitle, entryId> built once from state.entries (already
fetched for the sidebar) when a world is opened, and updated
incrementally: push on create (including stub creation, see 2.7), update
on rename (PATCH response), delete on entry delete. The tokenizer consults
this map synchronously. The new search endpoint (2.5) is used only for the
autocomplete suggestion list, which legitimately wants fuzzy/substring
matching and a server round-trip is acceptable there since it is debounced
and user-paced, not fired on every keystroke of body text.

### 2.7 Stub creation -> flipping the span in place

Double-click on an unresolved token:

1. Re-check the local title index for rawTitle (defensive -- guards
   against the token having just become resolved by another update since
   the last tokenize pass).
2. api.createEntry(worldId, { title: rawTitle, contentMarkdown: "" }).
3. On success: add the new entry to state.entries (sidebar list picks it
   up) and to the title index map.
4. Re-run tokenize + overlay rebuild only. The textarea's .value is
   untouched -- the raw source text [[Title]] did not change, only its
   resolution status changed -- so the caret position is preserved
   automatically, by construction, the same way typing-time
   re-tokenization preserves it (2.1). No full editor re-render, no
   save/restore of selection state needed.

## 3. File-level breakdown

### Backend

| File | Change |
|---|---|
| src/main/java/com/hisder/worldBuilding/entry/EntryRepository.java | add searchByTitle(worldId, query, Pageable) @Query method |
| src/main/java/com/hisder/worldBuilding/entry/EntryService.java | add searchEntriesByTitle(worldId, query, limit) -- blank/null query -> empty list, otherwise delegates to repo with PageRequest.of(0, limit) |
| src/main/java/com/hisder/worldBuilding/entry/EntryController.java | add GET /api/worlds/{worldId}/entries/search?q=&limit= |
| src/main/java/com/hisder/worldBuilding/entry/contract/EntryTitleSuggestion.java | new record (Long id, String title, String icon) + from(Entry), mirroring EntryResponse.from |

No entity changes, no migration, no GlobalExceptionHandler changes (404 for
bad worldId already covered by the existing EntityNotFoundException
mapping).

### Frontend

| File | Change |
|---|---|
| src/main/resources/static/js/editor.js | new. Tokenizer, overlay renderer, click/dblclick routing, autocomplete trigger/popup/accept, title-index maintenance, stub-creation flow. Exposes a small init function app.js calls with the textarea/overlay elements, current world id, and callbacks (onNavigate(entryId), onEntriesChanged()) |
| src/main/resources/static/js/api.js | add searchEntryTitles(worldId, q, limit) wrapper for the new endpoint |
| src/main/resources/static/js/app.js | wire editor.js in on openEntry/world switch (pass state.entries for the initial title index, supply the navigate callback that reuses the existing openEntry(id) function, keep state.entries in sync when editor.js reports a stub was created) |
| src/main/resources/static/index.html | replace the plain <textarea id="entry-content"> with the wrapper: overlay <div id="entry-content-overlay"> + textarea, plus <div id="wikilink-autocomplete" hidden> popup container; add <link> for editor.css |
| src/main/resources/static/css/editor.css | new. Overlay/textarea stacking, .wikilink-resolved/.wikilink-unresolved, autocomplete popup styling |

css/base.css is left as-is; not folding this into CLAUDE.md's fuller
variables.css/layout.css/components.css split, since that split does not
exist yet in the current skeleton and redoing it is a separate, unrelated
refactor.

### Contract boundary between the two implementers

- Backend owns: the shape of EntryTitleSuggestion and the search endpoint's
  query/ranking semantics.
- Frontend owns: everything about tokenizing, rendering, and event routing
  inside the editor -- none of it requires backend changes beyond the one
  endpoint above and the already-existing create/update endpoints.
- Both sides can build independently against the contract in section 1;
  the frontend can stub the search endpoint's response shape and develop
  the popup/tokenizer against a fake array of {id, title, icon} while the
  backend endpoint is built in parallel.

## 4. Explicit non-goals (do not touch)

- Folder -- does not exist; not needed by either feature. Entries remain
  flat within a world for this design.
- Tag / EntryTag -- untouched; tag pills are unrelated to wikilinks.
- RelationDefinition / Relation / GraphService -- untouched. A resolved
  [[Title]] link is not wired into the Relation system in this design -- it
  does not create a Relation row, and backlinks (which per CLAUDE.md are
  relation-based) will not show wikilink references. Turning resolved
  wikilinks into implicit relations is a plausible future enhancement but
  depends on RelationDefinition existing first (what relation type would an
  implicit wikilink-derived edge use?) -- flagging as a real open question
  rather than deciding it here.
- World-wide search (GET /api/worlds/{worldId}/search) -- the checklist's
  general title/summary/content search feature is separate from the narrow
  title-only typeahead added here; not building it now.
- Toolbar (bold/italic/heading buttons etc.), outline panel, right-rail
  graph -- all untouched; this design only changes the editor's text
  surface and its two new behaviors.
