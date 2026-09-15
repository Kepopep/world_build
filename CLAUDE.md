# CLAUDE.md

This file guides Claude Code when working in this repository. Implementation
progress, feature-completion status, and deferred/known-gap tracking live in
[TODO.md](TODO.md) instead — keep that file updated as work lands, not this
one.

## Project overview

**Mythos** (working name) is an Obsidian-style worldbuilding wiki: each
**World** holds a folder tree of **Entries** (locations, factions,
characters, lore, timelines, maps) written as tagged markdown documents,
cross-linked via `[[wikilinks]]` and typed **relations**, with a graph view
over those links.

**Design reference:** `2feef0b9-fc72-4a61-9c50-3c6d510e16f0.png` (repo root)
is the authoritative visual spec for the target UI — re-read it directly
before implementing a new screen if any detail below is ambiguous.

Current branch: `overhaul/obsidian-style`.

## UI breakdown (screenshot → components)

**Top bar:** app wordmark ("Mythos") · "Worlds" breadcrumb root with a
dropdown chevron (world switcher) · centered global search, scoped to the
active world · right side: theme toggle, link/share icon, notifications
bell, user avatar (avatar/auth is a placeholder, out of scope).

**Far-left icon rail** (thin, always visible, distinct from the tree
sidebar): view-switcher icons (page/notes, library, database, relation
graph) plus a settings gear pinned at the bottom — these switch what the
tree sidebar + main panel show.

**Left sidebar (tree):** current world name with a dropdown above a
collapsible folder tree. Top-level nodes are user-defined **folders**
containing **entries**, each with a small type icon; the open entry is
highlighted. Footer: pinned/favorites icon, new-note icon, `+` add button.

**Main content area:** breadcrumb (`Worlds > {World} > {Folder} > {Entry}`)
· content toolbar (edit, copy-link, duplicate, `...` overflow) · entry
header (circular type icon, title, one-line subtitle, colored tag pills) ·
right-aligned Created/Last modified metadata · editor toolbar (undo/redo,
block-style dropdown, bold/italic/underline/strikethrough, link, image,
lists, blockquote, inline code, fenced code block) · editor body as
**markdown source with syntax styling** (literal `#`/`##`/`-` visible but
styled — Obsidian-style source/live-preview, not WYSIWYG) · footer format
label + live word count.

**Right icon rail** (mirrors the left one): panel toggles for an outline
(heading TOC), a backlinks/related-notes panel, and a relation graph
centered on the current entry.

## Tech stack

- **Backend:** Java 21, Spring Boot (Spring Web MVC + Spring Data JPA),
  Gradle. Package root: `com.hisder.worldBuilding`.
- **Database:** PostgreSQL only (`jdbc:postgresql://localhost:5432/worldBuilding`).
  `spring.jpa.hibernate.ddl-auto=update` — schema auto-migrates from
  entities, no separate SQL migrations.
- **Frontend:** pure HTML + CSS + vanilla JS served as static resources from
  `src/main/resources/static/` — no framework, no bundler. Pages call the
  REST API with `fetch()`.
- **API docs:** springdoc-openapi at `GET /openapi` — document new endpoints
  as they're added.
- **Auth:** out of scope. The top-bar avatar is a placeholder; don't build a
  login system unless asked.

## Domain model

One feature package per entity under `com.hisder.worldBuilding` (`entity/`,
`repository`, `service`, `controller`, `contract/` for request/response
DTOs):

- **`World`** — `id`, `name`, `icon`, `createdAt`, `updatedAt`. Owns a folder
  tree and a tag set; everything else is scoped to a world.
- **`Folder`** (`folder/`) — `id`, `worldId`, `parentFolderId` (nullable,
  self-referential `@ManyToOne`, not a bare FK `Long`), `name`, `sortOrder`.
  Purely organizational. `sortOrder` is a world-wide count assigned at
  creation time, not scoped per sibling group — stable sort, just not a
  clean `0,1,2…` per parent; harmless since there's no reorder-within-folder
  UI.
- **`Entry`** (`entry/`) — `id`, `worldId`, `folderId` (real `@ManyToOne
  Folder`), `icon`, `title`, `summary` (one-line subtitle), `contentMarkdown`,
  `createdAt`, `updatedAt`. The core content unit. No `(worldId, title)`
  uniqueness constraint — wikilink resolution picks whichever entry an
  in-memory title map last wrote if titles collide (see Wikilinks below).
- **`Tag`** (`tag/`) — `id`, `worldId`, `name`, `color`. Plain `@ManyToMany`
  on `Entry` through an `entry_tags` join table — no standalone `EntryTag`
  entity.
- **`RelationDefinition`** (`relation/definition/`) — `id`, `world`, `name`,
  `reverseName` (e.g. `"rules"` / `"ruled by"` — reverseName is shown
  traversing the edge from the target side). CRUD logic lives in
  `RelationService` (always used together with `Relation`);
  `RelationDefinitionController` is a separate controller class since it
  owns a different resource root.
- **`Relation`** (`relation/`) — `id`, `sourceEntry`/`targetEntry`/
  `relationDefinition` (all real `@ManyToOne`, no bare FK `Long`s, no
  redundant `worldId` column — world membership derives from
  `sourceEntry.getWorld()` and is cross-checked against the other two).
  `RelationService.createRelation` rejects self-relations, 404s on any
  missing id, enforces all three share one `World`, and rejects a duplicate
  relation of the *same type* in either direction (different types between
  the same two entries are still allowed).
- **`GraphService`** (`graph/`) — read-only aggregation over `Entry`+
  `Relation`, no entity/storage of its own. `worldGraph`: every Entry as
  nodes, every Relation as edges. `entryGraph`: BFS-expanded from one entry
  to a given depth (both directions), depth clamped `0..5` server-side.

## Architecture notes & gotchas

Non-obvious behaviors that exist to work around specific bugs or browser
quirks — read before touching the related code, since they're easy to
accidentally regress.

### Editor: textarea + overlay, not contenteditable

The editor is a transparent, focus-owning `<textarea>` on top of a
non-interactive (`pointer-events: none`) overlay `<div>` whose `innerHTML`
is fully rebuilt on every keystroke, producing markdown source with
syntax-highlighted tokens (headers, bullets, bold/italic/code, wikilinks)
rather than a WYSIWYG render. Full rationale in
`docs/design/autocomplete-and-entity-references.md` §2.1 — short version:
the caret only ever lives in the textarea, never in the div that gets
rebuilt, so the overlay surviving re-tokenization is automatic, no Range
save/restore needed. Tokenizer is one ordered regex pass (codeblock →
block-line header/blockquote/list → inline wikilink/code/bold/italic).
`Entry.contentMarkdown` is persisted as-is; the view-mode preview is a
client-side render pass over the same raw markdown, not a stored second
copy.

### Wikilinks (`[[Entry Title]]`) & view/edit mode

Full design rationale and known accepted gaps:
`docs/design/autocomplete-and-entity-references.md`. Code:
`js/editor.js`/`js/app.js`/`css/editor.css`.

- Tokenized client-side (`/\[\[([^\[\]\n]+)\]\]/g`); resolution is looked up
  in an in-memory `Map<lowercaseTitle, entryId>` built from the
  already-loaded entry list — **no per-keystroke network calls**.
- Resolved (matching entry exists) → accent-colored solid underline;
  unresolved → warn-colored dotted underline.
- **Click** navigates only in view/read-only mode; in edit mode it's a no-op
  for navigation (just places the caret), so you can fix a typo inside a
  link without being yanked away.
- **Double-click** an unresolved reference creates a stub `Entry` with that
  title and flips the span to resolved in place (works in either mode).
- Hover-hand-cursor and hover-preview-popup only apply in view mode, since
  the overlay has `pointer-events: none` and never receives hover itself —
  `js/editor.js` hit-tests mouse position against the overlay tokens'
  `getClientRects()` on `mousemove`. The preview popup
  (`js/link-preview.js`/`css/link-preview.css`) is shared with the
  Backlinks panel's Active items, and deliberately gated to *resolved*
  links only at each call site rather than the popup module re-deriving
  resolution.
- `[[`-triggered autocomplete is debounced (~150ms,
  `AbortController`-cancelled) against
  `GET /api/worlds/{worldId}/entries/search`.
- Entries open **read-only by default** (`readonly` baked into
  `index.html`'s markup, not just toggled by JS) except a newly-created
  entry, which opens straight into edit mode. Escape/Edit-toggle flips
  `readOnly`; Escape is layered — first press closes the `[[` autocomplete
  popup if open, second press (or no popup) exits edit mode.
- **View mode is genuinely inert:** clicking anywhere except a resolved
  reference calls `event.preventDefault()` on `mousedown`, blocking caret
  placement *and* native text-selection — `readOnly` alone doesn't stop
  either. Since native mousedown is suppressed, `textareaEl.selectionStart`
  never reflects a click in view mode — click/dblclick routing there uses
  coordinate hit-testing (`findTokenAtPoint`) instead of offset-based
  lookup; edit mode still uses `selectionStart` normally.
- Exiting edit mode auto-saves if `state.dirty` and the entry still exists;
  a failed save keeps edit mode on instead of silently discarding.
- Both fields are explicitly `.blur()`red when leaving edit mode —
  otherwise a still-focused field can keep showing the browser's default
  focus ring, which looks identical to the accent "still editing" outline.

### Tags

`js/tags.js`/`css/tags.css` own this entirely; `app.js` only calls
`renderTags()` and reacts to callbacks (a feature module never reaches into
`app.js`'s `state` directly).

- Pills always render in both view and edit mode (tags are content);
  add/remove/color controls are edit-mode only.
- Dynamic creation: `POST /api/entries/{id}/tags` finds-or-creates the tag
  by name (case-insensitive) in the entry's world — no separate "create a
  tag" step.
- New tags get an automatic color from an 8-color server palette
  (`TagService.DEFAULT_PALETTE`), cycled by tag count. Color is edited
  per-`Tag` (`PATCH /api/tags/{id}`), not per-entry, so re-coloring updates
  every entry that carries it.
- **State-sync gotcha:** `app.js`'s `state.entries` array gets entry
  objects wholesale-replaced at several call sites (`onSaveEntry`,
  `onEntryTagsChanged`, `setEditing`, `openEntry`). `renderTags()` always
  re-fetches the current entry via `state.entries.find(...)` rather than
  caching a reference, and the tag color-dot handler mutates the tag object
  in place (relying on `state.entries` holding that same reference) instead
  of going through a callback. **If you add a new place that replaces a
  `state.entries` entry object, call `renderTags()` afterward or this
  mutation-in-place trick goes stale.**

### Navigation / drag-and-drop

`js/sidebar.js`/`css/sidebar.css` own the tree and drag-and-drop; `app.js`'s
`renderBreadcrumb()` handles the breadcrumb. `GET
/api/worlds/{worldId}/hierarchy` returns **flat** `{folders, entries}`
lists — the client builds the tree from `parentFolderId`/`folderId`.

- Entry create/delete route back to `app.js` (`onCreateEntry`/
  `onDeleteEntry`) since it owns edit-mode-open/editor-close logic; folder
  create/delete/move are handled entirely inside `sidebar.js`.
- Drag payloads use two distinct custom `dataTransfer` types
  (`application/x-mythos-entry-id`/`-folder-id`) — type-checking has to
  happen at `drop` time (`dataTransfer.getData()` returns `""`
  unconditionally during `dragover`/`dragenter`, by spec).
- **Drop targets are on the folder `<li>`, not its `.tree-folder-row`
  div** — the row is a *sibling* of the nested `.tree-children` list, not
  an ancestor, so a drop on a nested child would otherwise skip that
  folder's listener and bubble to the wrong ancestor. Listening on the
  `<li>` covers the whole subtree; `stopPropagation()` still keeps a
  deeper folder's own listener winning over its ancestors.
- **Cycle protection is server-side only:** `FolderService.moveFolder`
  walks the target's parent chain and rejects (400) if the folder being
  moved is found in it. Client only pre-checks the trivial self-drop case.
- "Move to root" has three entry points (background drop zone, a pinned
  "🏠 World root" row, and an "↑" button per row) — all funnel through
  `moveEntryTo`/`moveFolderTo(..., null)`.
- `#entry-sidebar` needs `overflow-x: auto` for long/deeply-nested names —
  `.tree-folder-name` must NOT have `overflow: hidden`/`text-overflow:
  ellipsis`, and `.entry-title-btn` needs `white-space: nowrap`, or long
  names silently truncate instead of becoming horizontally scrollable.

### Relations & graph

- `RelationResponse` is perspective-aware: `GET /api/entries/{id}/relations`
  returns both directions combined, using `definition.name` as the label
  when `{id}` is the source and `definition.reverseName` when it's the
  target.
- **Lesson from a real bug:** never map a lazy-loaded JPA entity (e.g.
  `Relation` → `RelationResponse`) *outside* the owning `@Transactional`
  service method and rely on something else (like `Stream.sorted()`) to
  have incidentally initialized the lazy proxy — `Stream.sorted()` skips
  the comparator entirely for 0/1-element streams, so a single-relation
  entry left its proxy uninitialized, and touching it later under
  `open-in-view` (autocommit, outside a real transaction) failed
  specifically on the `contentMarkdown` `@Lob`/CLOB column (Postgres
  large-object streaming needs a non-autocommit transaction). Always build
  the response DTO *inside* the `@Transactional` method.
- Frontend merges two edge kinds into one graph view (not toggleable
  modes): solid+labeled for formal `Relation`s, dashed for resolved
  `[[wikilink]]`s (`kind: 'relation' | 'wikilink'` on each edge). The
  full-world graph is a modal (`js/graph.js`); the per-entry graph is a
  small embedded right-rail panel using the same `createRenderer()`
  pipeline with independent simulation state.
- The graph is a live, hand-rolled force simulation (no d3-force
  dependency) — repulsion + spring edges + center-drift,
  `requestAnimationFrame` loop scaled by a cooling `alpha` that stops the
  loop once settled. Dragging pins the node (`fixed: true`) and reheats
  `alpha`; a `moved`-threshold guard stops a plain click from
  pinning/reheating, and the `click` handler ignores the synthetic click
  Chrome fires after a drag's `pointerup`.
- Resolved wikilinks are shown in the *graph* (dashed) but are **not**
  stored as `Relation` rows — wikilinks and formal relations remain two
  independent systems (deliberate, not a gap to casually merge).

### Right panel (Backlinks)

`js/backlinks.js`/`css/backlinks.css`, panel titled "Links" —
wikilink-derived (via `js/wikilink-parser.js` + `state.entries`), not
`Relation`-based (relation-creation UI doesn't exist, so a Relation-based
version would show empty). Two collapsible sections, "Linked to" above
"Linked from":
- **Linked to** (outgoing wikilinks) splits into Active (entry exists,
  clickable, navigates) / Inactive (doesn't exist, clickable — creates a
  stub and navigates straight into edit mode via `onLinkedToStubCreated`,
  which differs deliberately from the editor's own `onStubEntryCreated`
  that stays put on the current entry).
- **Linked from** (incoming) — every other entry whose content resolves a
  link back to this one; not split into Active/Inactive since it has to
  exist to have content.

### AI-powered entry generation (`ai/`)

- `AiGenerationService` composes `WorldService`/`EntryService`/
  `TagService` methods directly (a deliberate departure from every other
  service, which only touches its own repository) — reuses existing
  creation/attachment logic rather than reimplementing it.
- System prompt includes world name, up to `MAX_CONTEXT_ENTRIES` (30)
  most-recently-updated entries as `"- {title}: {summary}"`, and existing
  tag names, instructing the model to stay consistent with world lore.
- Uses `response_format: {"type": "json_object"}` + a prose shape
  description — provider-agnostic (any OpenAI-compatible aggregator), not
  a provider-specific strict-schema feature.
- Defensive parsing: missing/blank content, unparseable JSON, or
  missing/blank `title` all raise `AiGenerationException` → `502` via
  `GlobalExceptionHandler`. Never let a raw parse exception surface.
- No transaction wraps the whole flow — the network call to the aggregator
  must happen outside any DB transaction; each collaborator method
  (`createEntry`, `updateEntry`, `addTagToEntry`) carries its own
  transaction boundary, then a final `getEntry` re-fetch returns the
  fully-hydrated result.
- `GET /api/ai/models` proxies the aggregator's `/models` endpoint when
  `ai.aggregator.base-url` is reachable, else falls back to the static
  `ai.aggregator.models` CSV — never errors the request itself. Aggregator
  results are filtered to models whose (OpenRouter-shaped)
  `architecture.input_modalities`/`output_modalities` both include `"text"`
  — this feature only ever calls `/chat/completions` with plain text, so
  image/audio-only models are useless here — but fails open (keeps the
  model) if `architecture` is missing entirely, since not every
  OpenAI-compatible aggregator reports it. Both paths (aggregator and CSV
  fallback) are also restricted to OpenAI models only, filtered out before
  the response is ever built — a non-OpenAI model can never reach the
  frontend picker. `AiGenerationService.isOpenAiModel` (used for the live
  aggregator response, which carries the full JSON item) keeps a model if
  its `"<vendor>/"` id prefix is `openai/`, or — for a bare id with no
  prefix — if the item's `owned_by` field is `"openai"` (the shape OpenAI's
  own `/v1/models` returns); anything else, including an unverifiable bare
  id with neither signal, is excluded (fails closed, the opposite of the
  text-modality check above). `isOpenAiModelId` is the stricter string-only
  variant for the CSV fallback and for re-validating a `model` id posted
  straight to `generateEntry` (400 if it fails) — no JSON item to consult,
  so a bare id is never accepted there; `AI_AGGREGATOR_MODELS` entries must
  be vendor-prefixed (`openai/gpt-4o`) to be recognized. Both paths are
  sorted alphabetically by name before returning.
- Config (`ai.aggregator.base-url`/`-api-key`/`-models`) is entirely
  `${ENV_VAR:}`-backed — no secret is ever committed.

## File layout

### Backend (`src/main/java/com/hisder/worldBuilding/`)

```
world/                World, WorldRepository, WorldService, WorldController, contract/
                       (also owns GET /api/worlds/{worldId}/hierarchy)
folder/                Folder, FolderRepository, FolderService, FolderController, contract/
entry/                 Entry, EntryRepository, EntryService, EntryController, contract/
                       (EntryTitleSuggestion is the narrower {id,title,icon} wikilink typeahead)
tag/                   Tag, TagRepository, TagService, TagController, contract/
relation/              Relation, RelationRepository, RelationService, RelationController, contract/
                       (RelationService also owns RelationDefinition CRUD)
relation/definition/   RelationDefinition, RelationDefinitionRepository,
                       RelationDefinitionController, contract/
graph/                 GraphService (worldGraph/entryGraph, BFS depth-capped at 5),
                       GraphController, contract/ (GraphNode, GraphEdge, GraphResponse)
search/                SearchController -> EntryService.searchEntries (case-insensitive substring,
                       title/summary ranked before content-only matches)
ai/                    AiGenerationService, AiGenerationController, contract/
                       (EntryGenerationRequest, AiModelResponse)
common/                GlobalExceptionHandler (@RestControllerAdvice: EntityNotFoundException->404,
                       IllegalArgumentException->400, {EntityExistsException,IllegalStateException}->409,
                       AiGenerationException->502)
```

### Frontend (`src/main/resources/static/`)

Single app shell (`index.html` + `js/app.js`) with client-side
view-swapping, not one HTML file per entry.

```
index.html   top bar (world picker, search, theme toggle) + far-left icon rail (notes/graph) +
             folder/entry tree sidebar (+ "Generate with AI" header control) + content panel
             (breadcrumb, icon toolbar, entry header, tag row, editor) + right icon rail
             (outline/backlinks/entry-graph panels)
css/
  base.css           baseline layout/typography, entry header/avatar/timestamp styling,
                      [data-theme="light"] override block
  editor.css          wikilink highlighting, autocomplete popup, view/edit-mode styling,
                      syntax token styling, toolbar buttons, read-mode preview
  tags.css            tag pill colors/layout, color-swatch dot, add-tag form
  sidebar.css         folder/entry tree rows, drag-and-drop feedback, breadcrumb, AI-generate form
  graph.css           world-graph modal chrome, node/edge drawing, entry-graph panel
  rail.css            far-left/right icon rail strip layout
  outline.css         outline panel TOC styling
  backlinks.css       "Links" panel collapsible sections, Active/Inactive styling
  search.css          top-bar search dropdown styling
  link-preview.css    shared hover-preview popup card
js/
  api.js              fetch wrapper for every backend endpoint
  app.js              world/entry CRUD wiring, view/edit mode state, tag-row/sidebar/breadcrumb
                      re-render wiring, entry header rendering, AI-generate form
  editor.js           wikilink tokenizer + overlay renderer, click/dblclick routing, autocomplete,
                      syntax highlighting, toolbar wiring, word count, read-mode DOM preview
  sidebar.js          client-side tree building, collapse/expand, folder/entry CRUD, drag-and-drop
  outline.js          heading parsing + click-to-jump
  backlinks.js        wikilink-derived "Links" panel
  tags.js             pill rendering, add-tag form, color swatch
  graph.js            wikilink+relation graph merge, force simulation, modal + entry-graph panel
  search.js           debounced top-bar search dropdown
  theme.js            light/dark toggle, localStorage-persisted
  link-preview.js     shared hover-preview popup
```

`css/variables.css`, `css/layout.css`, `css/components.css`, and
`assets/icons/` from the original file-layout sketch were never split out —
theme tokens/shell layout live in `base.css`, small components live in
their own feature CSS files, and toolbar icons are inline `<svg>` in
`index.html`.

## REST API reference

```
GET    /api/worlds
POST   /api/worlds
GET    /api/worlds/{worldId}
GET    /api/worlds/{worldId}/hierarchy                  flat {folders, entries} -- client builds the tree
GET    /api/worlds/{worldId}/search?q=&limit=            general title/summary/content search (limit default 20);
                                                          blank q -> [], not 400
GET    /api/worlds/{worldId}/entries/search?q=&limit=    entry-title-only typeahead for wikilink autocomplete
                                                          (limit default 8); blank q -> []

GET    /api/worlds/{worldId}/folders
POST   /api/worlds/{worldId}/folders                     {name, parentFolderId?}
PATCH  /api/folders/{id}                                 {name?, parentFolderId?, sortOrder?} -- null = unchanged
PATCH  /api/folders/{id}/move                            {parentFolderId} -- always applied incl. null (move to
                                                          root); 400 if it would create a cycle
DELETE /api/folders/{id}                                 409 if it still has subfolders/entries

GET    /api/worlds/{worldId}/entries
GET    /api/entries/{id}
POST   /api/worlds/{worldId}/entries                     {..., folderId?} -- omit/null = world root
PATCH  /api/entries/{id}                                 {..., folderId?, summary?} -- null = unchanged
PATCH  /api/entries/{id}/move                            {folderId} -- always applied incl. null
DELETE /api/entries/{id}

GET    /api/worlds/{worldId}/tags
POST   /api/entries/{id}/tags                            {name, color?} -- finds-or-creates by name (ci); returns
                                                          the updated EntryResponse
DELETE /api/entries/{id}/tags/{tagId}                    detaches only, returns updated EntryResponse
PATCH  /api/tags/{id}                                    {name?, color?} -- edits the shared Tag row

GET    /api/worlds/{worldId}/relation-definitions
POST   /api/worlds/{worldId}/relation-definitions        {name, reverseName} both required -> 201
GET    /api/entries/{id}/relations                       both directions combined, sorted by relatedEntryTitle
POST   /api/relations                                    {sourceEntryId,targetEntryId,relationDefinitionId};
                                                          400 self-relation/cross-world; 404 missing id;
                                                          409 duplicate same-type relation
DELETE /api/relations/{id}

GET    /api/graph/world/{worldId}                        {nodes:[{id,title,icon}], edges:[{sourceId,targetId,
                                                          label,relationDefinitionId}]}
GET    /api/graph/entry/{id}?depth=1                      BFS-expanded, depth clamped 0-5 (400 outside range)

GET    /api/ai/models                                     proxies aggregator /models, falls back to static CSV
POST   /api/worlds/{worldId}/entries/generate             {prompt, model, folderId?} -> 201 EntryResponse;
                                                          400 blank prompt; 404 world; 502 aggregator failure
```

## Build & run

Gradle wrapper (`./gradlew` on bash, `gradlew.bat` / `.\gradlew` on
PowerShell):

- Run: `./gradlew bootRun`
- Build: `./gradlew build`
- All tests: `./gradlew test`
- Single test: `./gradlew test --tests "com.hisder.worldBuilding.WorldBuildingApplicationTests"`

Requires PostgreSQL matching `src/main/resources/application.properties`
(`jdbc:postgresql://localhost:5432/worldBuilding`, user `postgres`).
`spring.jpa.hibernate.ddl-auto=update` auto-migrates schema on startup.
OpenAPI docs at `/openapi`.

## Reference docs

- `docs/design/autocomplete-and-entity-references.md` — wikilink/edit-mode
  design rationale, full REST contract for that feature, and known
  accepted gaps.
- `2feef0b9-fc72-4a61-9c50-3c6d510e16f0.png` (repo root) — target UI
  screenshot.
- [TODO.md](TODO.md) — implementation progress, deferred work, and
  non-goals.
