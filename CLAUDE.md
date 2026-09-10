# CLAUDE.md

This file guides Claude Code when working in this repository.

## Project overview

**Mythos** (working name, per the screenshot's wordmark) is an Obsidian-style
worldbuilding wiki: each **World** the user creates holds a folder tree of
**Entries** — locations, factions, characters, lore, timelines, maps — written
as tagged markdown documents that can be linked to each other via typed
**relations**, with a graph view over those links.

**Design reference:** `2feef0b9-fc72-4a61-9c50-3c6d510e16f0.png` (repo root)
is a screenshot of the target UI and is the authoritative visual spec until a
newer reference replaces it. The breakdown below was derived from it — re-read
the image directly before implementing a screen if any detail here is
ambiguous.

**Current state:** branch `overhaul/obsidian-style`. The previous
implementation (a D3 force-graph homepage + a mock-data entry-view page,
documented in the now-deleted `docs/`) was removed wholesale in
`5eafafe feat!: delete all` to restart from this reference design. Since then
the rebuild has produced a working (if still narrow) vertical slice rather
than the full screenshot UI:

- **Backend:** `World`, `Folder`, `Entry`, and `Tag` entities + CRUD are
  implemented (`world/`, `folder/`, `entry/`, `tag/` packages), plus an
  entry-title typeahead endpoint (`GET /api/worlds/{worldId}/entries/search`)
  for the wikilink autocomplete below and a `GET /api/worlds/{worldId}/hierarchy`
  aggregation endpoint for the sidebar tree. `RelationDefinition`/`Relation`
  and `GraphService` do not exist yet — see Domain model.
- **Frontend:** a shell (`index.html` + `js/app.js` + `js/api.js`) with a
  real folder/entry tree sidebar (`js/sidebar.js` + `css/sidebar.css`), an
  entry editor, and a tag pill row — no far-left icon rail or right rail yet.
  Four features are well ahead of the "Suggested implementation order" below
  — Obsidian-style `[[entity]]` cross-references with autocomplete, an
  explicit view/edit mode toggle, dynamically-created colored tags, and (now
  catching the tree/folder work up to where the other three already were)
  drag-and-drop folder/entry organization — while the general markdown
  toolbar, header/bullet/bold syntax highlighting, and entry header (icon +
  summary) the full design calls for are still missing. See "Wikilink
  references & edit mode", "Tags", and "Navigation" below for what's
  actually implemented, and
  `docs/design/autocomplete-and-entity-references.md` for the wikilink
  design rationale (textarea+overlay rendering, click/dblclick routing,
  known accepted gaps).

## Tech stack (target)

- **Backend:** Java 21, Spring Boot (Spring Web MVC + Spring Data JPA),
  Gradle. Package root: `com.hisder.worldBuilding`.
- **Database:** PostgreSQL only. `application.properties` is Postgres-only
  (`jdbc:postgresql://localhost:5432/worldBuilding`). `build.gradle` no
  longer pulls in `com.mysql:mysql-connector-j` and only declares
  `spring-boot-starter-webmvc` (not also `-web`) — both were leftover/
  redundant dependencies flagged in an earlier pass of this file and have
  since been cleaned up (see Cleanup items). `.idea/dataSources.xml` may
  still have a stale MySQL entry; that's IDE metadata, not something
  Gradle/the app reads, so it's low priority.
- **Frontend:** pure HTML + CSS + vanilla JS served as static resources from
  `src/main/resources/static/` — **no framework** (no React/Vue/Thymeleaf),
  same pattern the prior implementation used. Pages call the REST API with
  `fetch()`. No bundler/build step for the frontend.
- **API docs:** springdoc-openapi is already wired (`GET /openapi`) — keep it,
  document new endpoints as they're added.
- **Auth:** out of scope. The top-bar avatar in the screenshot is a
  placeholder; don't build a user/login system unless asked.

## UI breakdown (screenshot → components)

**Top bar:** app logo/wordmark ("Mythos") · "Worlds" breadcrumb root with a
dropdown chevron (world switcher) · centered global search — "Search in
current world..." (scoped to the active world) · right side: theme toggle,
a link/share icon, a notifications bell, a user avatar.

**Far-left icon rail** (thin, always visible, distinct from the tree
sidebar): a stack of view-switcher icons — page/notes view, library/compendium
view, database view, relation/graph view — plus a settings gear pinned at the
bottom. These switch what the tree sidebar + main panel show; treat as
top-level navigation modes.

**Left sidebar (tree):** current world name with a dropdown (world icon +
name + chevron) above a collapsible folder tree. Each top-level node is a
**folder** (`Overview`, `Locations`, `Factions`, `Characters`, `Lore` in the
screenshot — user-defined, not fixed categories) containing **entries**
(`Ravinia`, `Elion`, `Morgath`, ...), each with a small type icon. The
currently-open entry is highlighted. Sidebar footer: a pinned/favorites icon,
a new-note icon, and a `+` add button (new entry/folder).

**Main content area:**
- Breadcrumb: `Worlds > {World} > {Folder} > {Entry}`.
- Content toolbar (top-right of panel): edit (pencil), copy-link, duplicate,
  and a `...` overflow menu (rename, move, delete, etc.).
- Entry header: circular type icon, large title, one-line description/
  subtitle, and a row of colored tag pills (e.g. `Ravinia`, `City`,
  `Theocracy`, `Elion` — each tag has its own color).
- Metadata, right-aligned: `Created {date time}` / `Last modified {date time}`.
- Editor toolbar: Undo, Redo, a block-style dropdown (`Normal` / headings),
  Bold, Italic, Underline, Strikethrough, Link, Image, bullet list, numbered
  list, blockquote, inline code, fenced code block.
- Editor body: **markdown source with syntax styling**, not a WYSIWYG render —
  literal `#`/`##`/`###` headers, `-` bullets, etc. are visible in the editor
  but styled/colored (headers colored, in a larger weight), i.e. an
  Obsidian-style "source/live-preview" markdown editor, not a rich-text tree.
- Footer of the content panel: format label + live count, e.g.
  `Markdown · 1,248 words`.

**Right icon rail** (mirrors the left one): panel toggles for an outline
(heading TOC of the current entry), a backlinks/related-notes panel, and a
relation graph view centered on the current entry.

## Domain model

Entities to add under `com.hisder.worldBuilding`, one feature package each
(`entity/`, `repository`, `service`, `controller`, `contract/` for
request/response DTOs — mirrors the prior codebase's structure):

- **`World`** — `id`, `name`, `icon`, `createdAt`, `updatedAt`. Owns a folder
  tree and a tag set; everything else is scoped to a world.
- ✅ **`Folder`** — `id`, `worldId`, `parentFolderId` (nullable,
  self-referential for nesting), `name`, `sortOrder`. Purely organizational,
  not renderable content itself. Implemented as specified, as a real
  `@ManyToOne` self-relation (not a bare FK `Long`) — see "Navigation" below
  for the full behavior (nested creation, drag-and-drop, cycle protection)
  and REST contract. Known accepted gap: `sortOrder` is assigned as a
  world-wide count at creation time, not scoped per sibling group, so it's
  not a clean `0,1,2...` sequence within one parent's children -- harmless
  (still produces a stable sort), just not tidy; no reorder-within-a-folder
  UI exists yet to make this matter.
- ✅ **`Entry`** — `id`, `worldId`, `folderId`, `icon`, `title`, `summary`
  (one-line description shown under the title), `contentMarkdown`,
  `createdAt`, `updatedAt`. This is the core content unit (a "page").
  `folderId` is a real `@ManyToOne Folder folder` relation (upgraded from an
  initial bare-`Long` placeholder once `Folder` existed to point at), not a
  raw column.
- ✅ **`Tag`** — `id`, `worldId`, `name`, `color`. Implemented as a plain
  `@ManyToMany` on `Entry` through an `entry_tags` join table (the "or a
  `@ManyToMany` join table" alternative this line originally offered) rather
  than a standalone `EntryTag` entity — see "Tags" below for the full
  behavior (dynamic creation, color editing, etc.) and REST contract.
- **`RelationDefinition`** — `id`, `worldId`, `name`, `reverseName` (e.g.
  `"rules"` / `"ruled by"` — the reverse name is what's shown traversing the
  edge from the target side). Reuse this pattern from the prior
  implementation; it's what drives readable, directional relation labels.
- **`Relation`** — `id`, `sourceEntryId`, `targetEntryId`,
  `relationDefinitionId`. Service layer should reject self-relations and
  duplicate relations in either direction (prior codebase did this in
  `RelationService` — worth carrying forward).

`GraphService` (read-only aggregation over `Entry` + `Relation`, no storage of
its own) reshapes rows into graph nodes/edges for both the right-panel
per-entry graph and any full-world graph view behind the far-left graph icon.

## Feature checklist

- **World management:** create/list/switch worlds; world switcher dropdown in
  the top bar and left sidebar header. Partially built: a plain `<select>` +
  "create world" form in the top bar does create/list/switch, but it's not
  yet the icon+name+chevron dropdown the screenshot shows, and there's no
  left-sidebar header copy of it (there's no left sidebar tree at all yet).
- ✅ **Navigation (mostly implemented):** collapsible folder/entry tree
  scoped to the active world; breadcrumb reflecting the open entry's folder
  path; far-left rail for switching between notes/library/database/graph
  modes. The tree and breadcrumb are built — see "Navigation" below for full
  behavior (nested folders, drag-and-drop, horizontal scroll). **Still not
  built:** the far-left icon rail (its other modes — library/database/graph
  — don't have views to switch to yet, so it was deliberately deferred, see
  the earlier scope discussion in "Navigation" below).
- **Search:** search box scoped to "current world", searching entry
  title/summary/content (and maybe tags). **Not built as a UI search box
  yet.** What exists is narrower and serves a different purpose: an
  entry-title-only typeahead (`GET /api/worlds/{worldId}/entries/search`)
  built specifically to back the wikilink `[[`-autocomplete popup, not a
  general top-bar search box. This checklist item (title+summary+content,
  wired to the top search bar) is still open — see the REST API sketch's
  distinction between the two endpoints.
- **Entry viewing:** header (icon, title, summary, tags), created/modified
  timestamps, breadcrumb, content toolbar (edit/link/duplicate/more). ⚠️
  Partially superseded by the simpler toolbar actually built — see below.
  Of the header's pieces, the tag row (see "Tags" below) and the breadcrumb
  (see "Navigation" below) are built; no icon, summary, or timestamp display
  yet, and no dedicated header section containing them — the breadcrumb,
  title input, and tag row are just sibling elements stacked in the content
  panel today, not a single "header" block.
- **Entry editing:** markdown source editor with a formatting toolbar
  (headings dropdown, bold/italic/underline/strikethrough, link, image,
  bullet/numbered list, quote, inline code, code block, undo/redo); toolbar
  actions insert/wrap markdown syntax at the cursor rather than manipulating a
  rich-text DOM. Live word count + format label in the footer. **Not built
  yet** — the current editor only highlights `[[wikilink]]` tokens (see
  below), not general markdown syntax, and has no formatting toolbar or word
  count.
- ✅ **Entity cross-references (implemented, ahead of schedule):**
  Obsidian-style `[[Entry Title]]` wikilinks in the markdown source, with
  inline `[[`-triggered autocomplete, resolved/unresolved highlighting,
  click-to-navigate, and double-click-to-create-stub. See "Wikilink
  references & edit mode" below — this landed well before the general
  toolbar/highlighting work above, on direct request, and does not depend on
  `RelationDefinition`/`Relation` (a resolved wikilink is not currently
  wired into the Relation system — see that section's non-goals).
- ✅ **View/edit mode (implemented, ahead of schedule):** entries open
  read-only by default; an explicit Edit toggle (or Escape) is required to
  make title/content editable. Not originally in this checklist, but now a
  prerequisite for how the editor and wikilink click-routing behave — see
  below.
- ✅ **Tags (implemented, ahead of schedule):** colored tag pills, rendered
  under the title (not yet "on the entry header" — there is no entry header
  section, see the Entry viewing note above); create/assign/remove tags per
  entry, scoped per world; tags are created dynamically (typing a new name
  creates it) rather than through a separate "manage tags" screen. See
  "Tags" below.
- **Relations & graph:** define relation types (`RelationDefinition`), link
  entries, view a relation graph centered on the open entry (right rail) and
  a full-world graph (far-left rail). **Not built yet.**
- **Right panel:** outline (parsed from the entry's own markdown headings),
  backlinks (other entries with a relation pointing at this one).
- **Misc:** light/dark theme toggle (persist choice, e.g. `localStorage`);
  notifications bell — stub only, no feed exists yet; keep out of scope
  unless asked.

## Suggested file layout

### Backend (`src/main/java/com/hisder/worldBuilding/`)

```
world/            ✅ built: World, WorldRepository, WorldService, WorldController, contract/
                  (WorldController also owns GET /api/worlds/{worldId}/hierarchy -- see
                  world/contract/WorldHierarchyResponse.java and "Navigation" below)
folder/           ✅ built: Folder, FolderRepository, FolderService, FolderController, contract/
                  (contract/ has FolderResponse, FolderCreateRequest, FolderUpdateRequest,
                  FolderMoveRequest -- the last one is the drag-and-drop reparent endpoint, see
                  "Navigation" below)
entry/            ✅ built: Entry, EntryRepository, EntryService, EntryController, contract/
                  (contract/ has EntryCreateRequest, EntryResponse, EntryUpdateRequest,
                  EntryMoveRequest, and EntryTitleSuggestion — the last one backs the wikilink
                  autocomplete, see "Wikilink references & edit mode" below; it's a narrower
                  {id,title,icon} typeahead result, not full entry search)
tag/              ✅ built: Tag, TagRepository, TagService, TagController, contract/
                  (contract/ has TagResponse, TagCreateRequest, TagUpdateRequest. No standalone
                  EntryTag entity -- Entry.tags is a plain @ManyToMany through an entry_tags
                  join table. See "Tags" below.)
relation/         not built: Relation, RelationRepository, RelationService, RelationController, contract/
relation/definition/  not built: RelationDefinition, RelationDefinitionRepository, contract/
graph/            not built: GraphService, GraphController, GraphData/GraphNode/GraphEdge records
search/           not built: SearchController for the general title/summary/content search
                  checklist item. (EntryService already has a narrower title-only search method
                  for the wikilink typeahead above — a future SearchController could absorb it.)
common/           ✅ built: GlobalExceptionHandler (@RestControllerAdvice: EntityNotFoundException→404,
                  IllegalArgumentException→400, {EntityExistsException,IllegalStateException}→409 —
                  services throw, controllers don't catch)
```

### Frontend (`src/main/resources/static/`)

Sidebar and top bar persist across entries, so prefer a single app shell with
client-side view-swapping over full page reloads (`history.pushState` +
dynamic content injection), rather than one HTML file per entry. What
actually exists today is a much smaller slice of this than the full target
below — no far-left rail, right rail, icon+chevron world dropdown, or graph
yet — but the editor, tags, and sidebar/navigation slices
(`editor.js`/`editor.css`, `js/tags.js`/`css/tags.css`,
`js/sidebar.js`/`css/sidebar.css`) are real and do more than originally
sketched here (wikilinks + view/edit mode; dynamic colored tags; a real
folder/entry tree with drag-and-drop — not yet the general
toolbar/syntax-highlighting/autosave this list originally described for the
editor):

```
index.html            ✅ built (partial): top bar (world picker) + folder/entry tree sidebar +
                       content panel (breadcrumb, icon toolbar, title input, tag row, editor).
                       No far-left rail or right rail yet.
css/
  variables.css        not built — theme tokens still live as :root vars directly in base.css
  layout.css           not built — shell layout rules still live in base.css
  base.css             ✅ built (not in the original sketch): baseline layout/typography for the
                       current shell, dark-theme-only for now (no light/dark toggle yet)
  editor.css           ✅ built, different scope than sketched: wikilink resolved/unresolved
                       highlighting, autocomplete popup styling, view/edit-mode outline marker +
                       cursor rules, minimalist icon-button toolbar. No header/bullet/bold token
                       styling or toolbar-button styling yet (no general toolbar exists).
  tags.css              ✅ built (not in the original sketch, which put tag-pill styling in
                       components.css): tag pill colors/layout, color-swatch dot, add-tag form.
  sidebar.css            ✅ built (not in the original sketch): folder/entry tree rows,
                       drag-and-drop feedback (drag-over highlight, dragging opacity), the
                       "World root" drop-zone row, breadcrumb. See "Navigation" below.
  components.css        not built — no dropdowns exist yet to style; tag pills and breadcrumb
                       (the pieces of this that are built) live in tags.css/sidebar.css instead
js/
  api.js               ✅ built: fetch wrapper, now including searchEntryTitles() for the
                       wikilink typeahead; listWorldTags/addEntryTag/removeEntryTag/updateTag for
                       tags; getHierarchy/createFolder/deleteFolder/moveFolder/moveEntry for
                       navigation
  app.js               ✅ built (partial): world/entry CRUD wiring, view/edit mode state
                       (setEditing/onToggleEditing), auto-save-on-exit-edit, tag-row re-render
                       wiring (renderTags/onEntryTagsChanged), sidebar re-render wiring
                       (renderSidebar/loadHierarchy), breadcrumb rendering (renderBreadcrumb --
                       simple enough to live here rather than its own module). Not yet a real
                       "shell bootstrap + view routing" — there's only one view.
  editor.js             ✅ built, different scope than sketched: [[wikilink]] tokenizer +
                       overlay renderer, click/dblclick routing (view-mode navigate vs.
                       edit-mode caret-only), hover hand-cursor, [[-triggered autocomplete
                       popup, Escape-to-exit-edit-mode callback. Textarea+overlay rendering (not
                       contenteditable) — see the design doc. No toolbar button wiring, no
                       header/bullet/bold syntax highlighting, no standalone autosave-while-typing
                       (saving currently only happens via the Save button or on edit-mode exit).
  sidebar.js            ✅ built, different scope than sketched: client-side folder/entry tree
                       building from the flat hierarchy response, collapse/expand, folder
                       create/delete/nested-create, entry create/delete (routed back to app.js --
                       see "Navigation" below for why), and drag-and-drop for both entries and
                       folders. See "Navigation" below.
  entry-view.js          not built — header (icon/summary)/metadata display not implemented yet
                       (breadcrumb is built, but lives in app.js -- see above)
  tags.js                ✅ built: pill rendering, add-tag form (with a <datalist> of the
                       world's existing tag names), remove button, color-swatch dot that opens a
                       native <input type="color">. See "Tags" below.
  graph.js                not built
  search.js               not built — see the search/ backend note above
  theme.js                 not built — no light/dark toggle yet
assets/icons/          not built — the toolbar's pencil/save/trash icons are inline <svg> in
                       index.html rather than separate files; revisit this if icon reuse grows
```

## REST API sketch

Endpoints marked ✅ are implemented; everything else here is still the
target sketch, not yet built.

```
GET    /api/worlds                            ✅
POST   /api/worlds                            ✅
GET    /api/worlds/{worldId}                  ✅
GET    /api/worlds/{worldId}/hierarchy        ✅ flat {folders: [FolderResponse...],
                                               # entries: [EntryResponse...]} -- not nested; the
                                               # sidebar (js/sidebar.js) builds the tree client-side.
                                               # See "Navigation" below.
GET    /api/worlds/{worldId}/search?q=...     # general title/summary/content search (checklist
                                               # item) -- distinct from the narrower endpoint below

GET    /api/worlds/{worldId}/entries/search?q=&limit=   ✅ entry-title-only typeahead backing the
                                               # wikilink [[-autocomplete popup (EntryTitleSuggestion:
                                               # {id,title,icon}; blank/missing q -> [], not 400;
                                               # limit defaults to 8). Not a substitute for the
                                               # general search endpoint above when that gets built.

GET    /api/worlds/{worldId}/folders          ✅
POST   /api/worlds/{worldId}/folders          ✅ {name, parentFolderId?} -- parentFolderId nests
                                               # the new folder; omitting it creates a top-level one.
PATCH  /api/folders/{id}                      ✅ {name?, parentFolderId?, sortOrder?} -- each null
                                               # field means "leave unchanged" (not currently used by
                                               # any UI -- no rename/manual-move flow exists; the
                                               # drag-and-drop move below uses a separate endpoint).
PATCH  /api/folders/{id}/move                 ✅ {parentFolderId} -- unlike the PATCH above,
                                               # parentFolderId is *always* applied, including null
                                               # (move to root) -- that's the whole reason this is a
                                               # separate endpoint (a null-means-unchanged field can't
                                               # express "move to root"). Rejects (400) a move that
                                               # would create a cycle. Drives the sidebar's
                                               # drag-and-drop and "↑ move to root" button.
DELETE /api/folders/{id}                      ✅ 409 if the folder still has subfolders or entries
                                               # in it -- no cascade, no orphaning.

GET    /api/worlds/{worldId}/entries          ✅
GET    /api/entries/{id}                      ✅
POST   /api/worlds/{worldId}/entries          ✅ now also takes folderId? (omit/null = world root)
PATCH  /api/entries/{id}                      ✅ now also takes folderId?, same null-means-unchanged
                                               # convention as title/contentMarkdown -- see the move
                                               # endpoint below for why that's not enough for drag-and-drop
PATCH  /api/entries/{id}/move                 ✅ {folderId} -- same reasoning/pattern as the folder
                                               # move endpoint above; always applies folderId,
                                               # including null. Drives the sidebar's drag-and-drop
                                               # and "↑ move to root" button.
DELETE /api/entries/{id}                      ✅

GET    /api/worlds/{worldId}/tags             ✅ all tags in a world, for the add-tag form's
                                               # <datalist> suggestions (not in the original sketch)
POST   /api/entries/{id}/tags                 ✅ {name, color?} -- attaches a tag, creating it in
                                               # the entry's world first if no same-named tag exists
                                               # yet (the "dynamic" part); color is only used the
                                               # moment a new tag is actually created. Returns the
                                               # updated EntryResponse, not a bare TagResponse.
DELETE /api/entries/{id}/tags/{tagId}         ✅ detaches (doesn't delete the tag itself). Returns
                                               # the updated EntryResponse.
PATCH  /api/tags/{id}                         ✅ {name?, color?} -- edits the tag itself, so the
                                               # change shows on every entry that carries it, not
                                               # just one. Not in the original sketch -- added for
                                               # "configure a tag's color" after creation.
# (GET /api/entries/{id}/tags from the original sketch was skipped: EntryResponse already embeds
# tags: [{id,worldId,name,color}] on every list/get/create/update/tag-mutation response, so a
# separate fetch was redundant given how small/always-needed the tag list is.)

GET    /api/worlds/{worldId}/relation-definitions
POST   /api/worlds/{worldId}/relation-definitions
GET    /api/entries/{id}/relations
POST   /api/relations
DELETE /api/relations/{id}

GET    /api/graph/world/{worldId}
GET    /api/graph/entry/{id}?depth=1
```

## Editor implementation notes

The screenshot's editor shows raw markdown tokens (`#`, `##`, `-`, ...)
styled rather than hidden — this is a **markdown source editor with syntax
highlighting**, not a WYSIWYG rich-text editor. CLAUDE.md originally left the
`contenteditable` vs. `textarea` + overlay choice open; **textarea + overlay
is what got built** (a transparent, focus-owning `<textarea>` on top of a
non-interactive, `pointer-events: none` overlay `<div>` whose `innerHTML` is
fully rebuilt on every keystroke) — see
`docs/design/autocomplete-and-entity-references.md` §2.1 for the full
rationale (the short version: the caret only ever lives in the textarea,
never in the div that gets rebuilt, so the overlay "surviving
re-tokenization" is automatic by construction, with no Range save/restore
needed the way a naive contenteditable approach would require).

**What's actually highlighted today is narrower than the full spec:** only
`[[wikilink]]` tokens are tokenized and styled (see the next section) —
there is no header/bullet/bold/code regex pass yet, no formatting toolbar,
and no word count / `Markdown · N words` footer label. The tokenizer is
structured as one regex pass over the source producing a token list consumed
by the overlay renderer, so adding header/bullet/bold passes later is meant
to be additive to `js/editor.js`, not a rewrite. Toolbar buttons that
insert/wrap markdown syntax at the cursor (bold/italic/heading dropdown/etc.)
are still unbuilt entirely — the only toolbar that exists is three
icon-only buttons (Edit/Save/Delete, see below), which don't touch markdown
syntax at all.

Word count and the `Markdown` label in the footer are still meant to be
computed client-side from the raw text once built. Persist
`Entry.contentMarkdown` as-is — no server-side rendering needed for the
editor itself (a separate render pass can be added later if a "preview" view
is wanted).

## Wikilink references & edit mode (implemented)

Two features landed this way ahead of the rest of the editor work, on direct
request rather than following the "Suggested implementation order" below.
Full design rationale, REST contract, and known accepted gaps are in
`docs/design/autocomplete-and-entity-references.md`; this section is the
condensed, current-behavior summary — re-read the design doc (and the code
in `js/editor.js`/`js/app.js`/`css/editor.css`) before changing any of this,
since several of the details below (e.g. the click/dblclick split, the
mousedown-prevention trick) exist to work around specific browser quirks and
are easy to accidentally regress.

**Entity cross-references (`[[Entry Title]]`):**
- Tokenized client-side via one regex pass (`/\[\[([^\[\]\n]+)\]\]/g`) over
  the raw textarea value; resolution (does a same-titled entry exist in this
  world?) is looked up in an in-memory `Map<lowercaseTitle, entryId>` built
  from the already-loaded entry list — **no per-keystroke network calls**.
  Known accepted gap: `Entry.title` has no `(worldId, title)` uniqueness
  constraint, so resolution picks whichever entry the map's last write wins
  on if titles collide; not fixed here (see the design doc's open question).
- **Resolved** (a matching entry exists): accent-colored, solid underline.
- **Unresolved** (no matching entry): warn-colored, dotted underline.
- **Click** a resolved reference **in view/read-only mode** → navigates to
  that entry. In edit mode, clicking a reference is a no-op for navigation —
  it just places the caret, so you can click into a link's raw text to fix a
  typo without being yanked to another entry (this was originally a known
  open ergonomics gap in the design doc; edit-mode-gating is how it got
  resolved).
- **Double-click** an unresolved reference → creates a stub `Entry` with
  that title (`POST /api/worlds/{worldId}/entries` with just the title, no
  content) and flips the span to resolved in place — no reload, no cursor
  jump. Works in either view or edit mode.
- **Hover** shows a hand cursor over any `[[...]]` token in view mode only
  (suppressed in edit mode, since clicking there no longer navigates). This
  requires its own fix beyond CSS `cursor: pointer` on the overlay span —
  the overlay has `pointer-events: none` so it never receives hover itself;
  `js/editor.js` hit-tests the mouse position against the overlay tokens'
  real `getClientRects()` on every `mousemove` and sets
  `textareaEl.style.cursor` directly.
- **`[[`-triggered autocomplete:** typing `[[partial` opens a debounced
  (~150ms, `AbortController`-cancelled on a newer keystroke) popup of
  matching entry titles from `GET /api/worlds/{worldId}/entries/search`; Tab
  or Enter accepts (splices `[[Title]]` into the raw source and dispatches a
  real `input` event so `app.js`'s dirty-tracking keeps working unmodified);
  arrow keys move the popup selection; Escape or an outside click dismisses
  it without accepting.

**View/edit mode:**
- Entries open **read-only by default** — `readonly` is baked into
  `index.html`'s markup for both the title input and content textarea (a
  true default even if JS fails to load), not just toggled by JS. A newly
  **created** entry is the one exception: it opens straight into edit mode
  (`openEntry(id, { startEditing: true })`) so creating one doesn't require
  an extra click before you can type.
- An icon-only **Edit/Done** toggle button (top-left of the content panel,
  above the title — see the toolbar note below) flips `readOnly` on both
  fields. **Escape** does the same, layered: with the `[[` autocomplete
  popup open, the first press just closes the popup; a second press (or a
  press with the popup already closed) exits edit mode. Escape is wired both
  on the content textarea (via an `onEscapeEdit` callback `editor.js` calls
  back into `app.js` with, since editor.js doesn't own edit-mode state) and
  directly on the title field.
- **Visual marker:** an accent-colored CSS `outline` (not `border`, so it
  doesn't shift layout) around the title and content box while editing,
  same accent color used elsewhere for active/selected state.
- **View mode is genuinely inert, not just visually read-only:** clicking
  anywhere in the title or content (other than a resolved reference)
  suppresses the browser's native `mousedown` action entirely
  (`event.preventDefault()`), which blocks caret placement *and* any native
  text-selection highlight (including the stray one-character selection a
  tiny mouse-drag between mousedown/mouseup can otherwise cause) — readOnly
  alone does not stop either of those. The cursor shows the plain arrow, not
  the text I-beam, except over an actual reference (hand cursor, above).
  Since the content textarea's native mousedown is suppressed in view mode,
  `textareaEl.selectionStart` never reflects a click there — click/dblclick
  routing uses coordinate hit-testing (`findTokenAtPoint`, the same
  technique as the hover cursor) instead of offset-based lookup in that
  mode; edit mode still uses `selectionStart` normally, since real caret
  placement is wanted there.
- **Exiting edit mode auto-saves** if there are unsaved changes
  (`state.dirty`) and the entry still exists (`state.openEntryId` is set —
  this is false by the time `setEditing(false)` runs from `closeEditor()` or
  a just-completed delete, so those paths correctly skip trying to save onto
  something that's gone). If the save fails validation (e.g. blank title) or
  errors, edit mode stays on instead of silently discarding, so the user can
  see/fix the problem.
- Both fields are explicitly `.blur()`red when leaving edit mode. This
  matters: a still-focused field after `.editing` is removed can otherwise
  keep showing the browser's own default focus ring, which — being a similar
  color to the accent outline above — looks exactly like edit mode never
  actually turned off. (`outline: none` in `editor.css` is a CSS-level
  safety net for the same failure mode.)

**Toolbar:** Edit/Save/Delete are minimalist icon-only buttons (30×30px,
16×16px inline `<svg>` — pencil / floppy-disk / trash-can, not separate
icon files), in that fixed order, positioned top-left of the content panel
above the title (not the bottom-of-panel / top-right-toolbar positions
either the old markup or the original screenshot spec used). Only Delete is
color-highlighted (reuses the existing danger/red styling); Save was
deliberately de-accented to match Edit's neutral look, so the row doesn't
read as two "important" buttons and one plain one. Save is disabled outside
edit mode (nothing could have changed on read-only fields).

## Tags (implemented)

Landed the same way as wikilinks/edit mode — ahead of the "Suggested
implementation order" below, on direct request. `js/tags.js` and
`css/tags.css` own this entirely; `app.js` only calls `renderTags()` (see
below) and reacts to its callbacks, same arm's-length pattern `editor.js`
follows (a feature module never reaches into `app.js`'s `state` directly).

- **Rendered under the title, above the content editor** (`#entry-tags` in
  `index.html`, between `#entry-title` and `#entry-content-wrapper`) — not
  yet "on the entry header" per the original UI breakdown, since there is no
  entry header section built (no icon/summary row exists to put it in).
- **Pills always render, in both view and edit mode** — tags are content,
  not an editing affordance, same reasoning as why they're visible in
  read-only mode at all. The add/remove/color controls below are the part
  gated to edit mode only, matching every other interactive control in the
  editor (see "View/edit mode" above).
- **Dynamic creation:** an inline "+ Add tag" control (button → reveals a
  text input, edit mode only) POSTs `{name}` to
  `/api/entries/{id}/tags`; the server finds-or-creates the tag by name
  (case-insensitive) within the entry's world — no separate "create a tag"
  step, no fixed/predefined tag list. A `<datalist>` sourced from
  `GET /api/worlds/{worldId}/tags` suggests existing names as you type, to
  encourage reuse over near-duplicate tags (e.g. `City` vs `city` vs
  `Cities`) — purely a hint; the server's case-insensitive match is what
  actually prevents duplicates, not the suggestion list.
- **New tags get an automatic color** from an 8-color server-side palette
  (`TagService.DEFAULT_PALETTE`), cycled by how many tags already exist in
  the world, so dynamically-created tags aren't all the same color without
  the user having to think about it up front.
- **Color is separately configurable per tag** (not per entry — a tag is
  shared across every entry that carries it, and re-coloring it updates all
  of them): a small swatch dot on each pill (edit mode only) opens a native
  `<input type="color">` (kept in the DOM only to be able to call
  `.click()` on it — the dot is the only visible/focusable control) and
  `PATCH`es `/api/tags/{id}` on change.
- **Removing a tag from an entry** (the "×" on each pill, edit mode only)
  detaches it via `DELETE /api/entries/{id}/tags/{tagId}` — it does not
  delete the `Tag` row itself, since other entries may still carry it.
- **Pill text color** is computed client-side (black or white) from the
  tag's background color via perceived luminance, so arbitrary
  user/server-chosen colors stay legible.
- **State-sync note for anyone touching this:** `app.js`'s `state.entries`
  array gets its entry objects wholesale-replaced by several call sites
  (`onSaveEntry`, `onEntryTagsChanged` after add/remove) — `renderTags()`
  always re-fetches the current entry via `state.entries.find(...)` rather
  than caching a reference, and `tags.js`'s color-dot handler mutates the
  tag object it was actually handed (relying on `render()` always being
  called with the same reference `state.entries` holds) rather than going
  through a callback, to avoid a full entries refetch just for a color
  change. If you add a new place that replaces a `state.entries` entry
  object, call `renderTags()` afterward or this mutation-in-place trick goes
  stale (see the comments at each of the three call sites in `app.js`:
  `setEditing`, `onSaveEntry`, `openEntry`).
- **Known accepted gap:** changing a tag's color only visually updates
  entries currently loaded in `state.entries` if `renderTags()` re-runs for
  them — an entry other than the one currently open, already fetched into
  `state.entries` before the color change, won't show the new color until
  it's reopened (a fresh `GET` picks it up correctly either way; this is
  purely an in-memory staleness window, not a data problem). Not fixed here,
  matching this codebase's general practice of calling out known scope
  boundaries rather than over-engineering around them (see the wikilink
  design doc for other examples of this).

## Navigation (implemented)

Fills in "Suggested implementation order" steps 2 and 4 below (`Folder` +
the hierarchy endpoint, and tree-sidebar rendering) — unlike Tags/wikilinks/
edit mode, this wasn't built *ahead* of its place in that order, it was
built *out of order relative to* the things that already had been (Tag,
the editor). `js/sidebar.js` + `css/sidebar.css` own the tree and
drag-and-drop entirely; the breadcrumb is simple enough that it lives
directly in `js/app.js` rather than its own module. Same arm's-length
pattern as `editor.js`/`tags.js`: `sidebar.js` only reaches into `app.js`
through the callbacks passed to `render()`.

**Data model:** `Folder` is a real self-referential `@ManyToOne` (not a bare
FK column) scoped to a `World`, and `Entry.folder` was upgraded the same way
(from an initial bare-`Long` placeholder) once `Folder` existed for it to
point at. `GET /api/worlds/{worldId}/hierarchy` returns both as **flat**
lists (`{folders: [...], entries: [...]}`), not a nested tree — `sidebar.js`
builds the tree client-side from `parentFolderId`/`folderId`, which keeps
the server-side mapping trivial and avoids inventing a nested DTO shape.

**Tree rendering:**
- Folders are collapsible (chevron toggle); collapsed-state is tracked as
  pure client-side presentation state in `sidebar.js` (a `Set` of folder
  ids), not persisted or sent to the server — same reasoning as the
  wikilink autocomplete popup's open/closed state living in `editor.js`
  rather than `app.js`'s `state`.
- Folder rows get hover-revealed action buttons (`.tree-action-btn`, same
  minimalist-icon-button spirit as the editor toolbar's `.icon-btn`):
  **"+📁" new subfolder** (prompts for a name, `POST`s with `parentFolderId`
  set to the current folder), **"+" new entry** (routed back to `app.js`'s
  `onCreateEntry(folderId)`, since creating an entry needs to also navigate
  into edit mode for it — that logic already lives there, not duplicated
  here), **"↑" move to root** (only rendered when the folder/entry isn't
  already at root — see "Move to root" below), and **"×" delete**
  (`confirm()` + `DELETE`, surfaces the server's 409 message verbatim if the
  folder isn't empty).
- Folder creation at the **top level** is a header button ("+ Folder", next
  to "+ New entry"), using a native `prompt()` rather than an inline reveal
  form like tags.js's "+ Add tag" — folder creation is comparatively rare,
  and `confirm()`/`prompt()`-style native dialogs are already this
  codebase's convention for infrequent actions (delete confirmations).
  Nested folder creation (the per-row "+📁" above) reuses the same
  `prompt()` pattern.
- Entry create/delete are routed back to `app.js` via the `onCreateEntry`/
  `onDeleteEntry` callbacks rather than handled directly in `sidebar.js`,
  since `app.js` already owns the "open the new entry in edit mode" /
  "confirm + close the editor if the deleted entry was open" logic and that
  shouldn't be duplicated. Folder create/delete/move, by contrast, are
  handled entirely inside `sidebar.js` — they don't interact with
  editor/edit-mode state at all.

**Breadcrumb** (`renderBreadcrumb()` in `app.js`): `Worlds › {World} ›
{Folder path...} › {Entry}`, walking `entry.folderId` up through
`state.folders`' `parentFolderId` chain (bounded at 50 hops as a defensive
guard against a malformed chain, not an expected case). Re-rendered from the
same single call site as the tag row (`setEditing()`, which every
open/close/toggle path funnels through) plus after `onSaveEntry()` (title
may be the last breadcrumb segment) and after `loadHierarchy()` (a
drag-and-drop move of the *currently open* entry/folder changes its path).

**Drag-and-drop** (both entries and folders, in and out of folders):
- Both entry and folder `<li>` rows are `draggable`, using two distinct
  custom `dataTransfer` types (`application/x-mythos-entry-id` /
  `-folder-id`) so a drop handler can tell which kind it received —
  `dataTransfer.getData()` only works from the `drop` handler itself, never
  from `dragover`/`dragenter` (browsers return `""` unconditionally there,
  by spec), so type-checking has to happen at drop time via
  `readDragPayload()`.
- **Drop targets are on the folder `<li>`, not its `.tree-folder-row`
  div.** This matters: the row is a *sibling* of the nested
  `.tree-children` list, not an ancestor of it, so a drop landing on a
  nested child would otherwise skip that folder's own listener entirely and
  bubble straight to whichever ancestor *is* listening (wrongly resolving
  to "move to root" for a top-level folder). The `<li>` is an ancestor of
  both the row and its children, so listening there covers the whole
  subtree; `stopPropagation()` still keeps it from also reaching the tree's
  background drop zone, and a more deeply nested folder's own `<li>`
  listener (with its own `stopPropagation()`) correctly wins when hovering
  specifically over it. The row (`row.classList`) is still what visually
  highlights (`.drag-over`) — the handlers just live one level up.
- **Cycle protection is server-side, not client-side:** dropping a folder
  onto itself is a client-side no-op (`moveFolderTo` checks
  `folderId === parentFolderId`), but dropping it into one of its own
  *subfolders* isn't pre-checked in JS — `FolderService.moveFolder` walks
  the target's parent chain looking for the folder being moved and rejects
  (400) if found, and the error surfaces via the same `onError` path as any
  other invalid move. Deliberately not duplicating that ancestry walk
  client-side just to save one round trip on an uncommon mistake.
- **"Move to root"** has three ways in, added incrementally as the
  single "drop it on empty background" approach turned out to be hard to
  hit once the tree fills up or nests deeply: (1) the tree's own background
  (`attachRootDropZone`, on the `<ul>` container — a drop that lands on a
  folder's subtree stops propagation before reaching this, so it only
  fires for drops that aren't over any folder); (2) an always-visible
  "🏠 World root" pinned row (`renderRootDropTarget`, dashed border,
  highlights on drag-over) rendered first in the tree on every render, a
  guaranteed-reachable target regardless of tree size; (3) the "↑" button
  on each folder/entry row mentioned above, for click-only interaction with
  no drag required at all. All three funnel through the same
  `moveEntryTo`/`moveFolderTo`(`..., null`) calls as a normal folder-to-
  folder drop.
- Not built: reordering siblings within a folder (no drag-to-reorder;
  `sortOrder` is set once at creation time and never touched again by any
  UI action — see the Domain model's `Folder` note on that), and dragging
  onto/reordering within the root-level entry list specifically (dropping
  on a root-level entry just bubbles to the same "move to root" background
  zone, which is already correct for an item that's usually already at
  root).

**Horizontal scroll, not truncation, for long content:** `#entry-sidebar`
now has `overflow-x: auto` (previously only `overflow-y`). Getting there
required *removing* `.tree-folder-name`'s `overflow: hidden` +
`text-overflow: ellipsis` (which had been silently truncating long names)
and adding `white-space: nowrap` to `.entry-title-btn` (which could
otherwise wrap to a second line) — a flex item with `white-space: nowrap`
and no `overflow` override won't shrink below its full text width (a
well-known flexbox behavior: the automatic minimum size equals the
min-content size, which for non-wrapping text is the full width), so it
pushes the row wider instead, and that overflow is what the sidebar's new
`overflow-x: auto` makes reachable by scrolling. Deep nesting compounds the
same effect naturally via `.tree-children`'s per-level indentation, no
extra handling needed for that specifically.

**Explicit non-goals (deliberately deferred, not forgotten):**
- The far-left icon rail (notes/library/database/graph mode switcher) —
  its other modes don't have views to switch to yet, so a rail of mostly-
  dead icons was skipped for now; see the Feature checklist's Navigation
  note and "Suggested implementation order" step 4 below.
- The world switcher as an icon+name+chevron dropdown, and a copy of it in
  the sidebar header — still a plain `<select>` in the top bar; see the
  Feature checklist's World management note.
- Renaming a folder, and moving an entry/folder via anything other than
  drag-and-drop or the "↑ to root" button (e.g. a "move to..." picker
  dialog) — `PATCH /api/folders/{id}` supports renaming server-side, there's
  just no UI trigger for it yet.

## Build & run

Gradle wrapper (`./gradlew` on bash, `gradlew.bat` / `.\gradlew` on
PowerShell):

- Run: `./gradlew bootRun`
- Build: `./gradlew build`
- All tests: `./gradlew test`
- Single test: `./gradlew test --tests "com.hisder.worldBuilding.WorldBuildingApplicationTests"`

Requires a running PostgreSQL instance matching
`src/main/resources/application.properties`
(`jdbc:postgresql://localhost:5432/worldBuilding`, user `postgres`).
`spring.jpa.hibernate.ddl-auto=update` — schema auto-migrates from entities on
startup; there are no separate SQL migration files (consider Flyway once the
schema stabilizes). OpenAPI docs at `/openapi`.

## Suggested implementation order

1. ✅ `World` entity + CRUD + world switcher endpoint. (World switcher is
   still a plain `<select>`, not the target dropdown design — see the
   Feature checklist's World management note.)
2. ✅ `Folder` entity + `GET /api/worlds/{id}/hierarchy`. Done — see
   "Navigation" above. (The hierarchy endpoint returns flat lists, not a
   nested tree; the client builds the tree — see that section's Data model
   note.)
3. ✅ `Entry` entity (CRUD) with `contentMarkdown` storage.
4. Static app shell: top bar, far-left rail, tree sidebar rendering from the
   hierarchy endpoint. **Partially done:** top bar + a real folder/entry
   tree (with drag-and-drop, collapse/expand, nested creation — see
   "Navigation" above) now exist; the far-left rail does not — deliberately
   deferred, since its other modes (library/database/graph) have no views
   to switch to yet.
5. Entry view: header, breadcrumb, metadata, content panel (read-only first).
   **Partially done, out of order:** the content panel's read-only-first
   behavior exists (see "Wikilink references & edit mode" above), the tag
   row renders too (step 6, below), and the breadcrumb now renders too (see
   "Navigation" above) — but the entry header (icon/title/summary as a
   distinct section) and created/modified-timestamp metadata display don't
   — the panel currently shows a breadcrumb + title input + tag row +
   content editor as sibling elements, no timestamps and no dedicated
   header section.
6. `Tag` + `EntryTag`; tag pills on the entry header. **Done, out of order** —
   landed ahead of this step on direct request, alongside wikilinks/edit
   mode (step 7). See "Tags" above. As noted in step 5, the pills render
   under the title rather than in a dedicated entry header section, since
   that section doesn't exist yet; no `EntryTag` entity either (`Entry.tags`
   is a plain `@ManyToMany`, see Domain model).
7. Markdown editor: toolbar + syntax highlighting + save/autosave.
   **Partially done, out of order:** `[[wikilink]]` tokenizing/highlighting,
   click-to-navigate, autocomplete, and save-on-edit-mode-exit all exist (see
   above) — landed ahead of this step on direct request. The general
   formatting toolbar (bold/italic/heading dropdown/etc.), header/bullet/bold
   syntax highlighting, word count, and per-keystroke autosave are still
   unbuilt.
8. `RelationDefinition` + `Relation` + `GraphService`; right-panel graph.
   **Not started.** Note: resolved wikilinks (step 7) are *not* wired into
   this system yet — see the design doc's non-goals.
9. Right panel: outline (parse headings client-side from `contentMarkdown`),
   backlinks (reverse relation lookup). **Not started.**
10. Search endpoint wired to the top search bar. **Not started** as a UI
    search box; a narrower entry-title typeahead exists for the wikilink
    autocomplete (step 7) — see the REST API sketch's distinction.
11. Theme toggle (CSS custom-property tokens, light/dark, `localStorage`).
    **Not started** — the current UI is dark-theme-only, hardcoded in
    `base.css`.
12. Notifications bell stays a static placeholder unless scoped separately.
    **N/A yet** — no top bar icons beyond the world picker exist.

## Cleanup items found while surveying the repo

- ✅ Done: `build.gradle` no longer has `com.mysql:mysql-connector-j`, and
  only declares `spring-boot-starter-webmvc` (not also `-web`) — both items
  from an earlier pass of this list are resolved. `.idea/dataSources.xml`
  wasn't rechecked for a stale MySQL entry; low priority since it's IDE
  metadata, not something Gradle/the app reads.
- `docs/` is no longer empty — it now has
  `docs/design/autocomplete-and-entity-references.md` (the wikilink/edit-mode
  design doc referenced throughout this file). Still worth adding
  API-contract/TODO docs for the rest of the rewrite as it produces more
  real contracts worth documenting.
- `2feef0b9-fc72-4a61-9c50-3c6d510e16f0.png` (the design reference) is
  **still** untracked at the repo root; consider moving it into
  `docs/design/` and committing it so the reference survives future cleanups.
