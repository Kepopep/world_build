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
the rebuild has caught up to essentially the full screenshot UI — every
top-level checklist item now has at least a working implementation, though a
few pieces (relation-creation UI, `Entry.icon` write path, sibling reorder)
remain deliberately deferred. See "Feature checklist" for the precise
per-item status.

- **Backend:** `World`, `Folder`, `Entry`, `Tag`, `RelationDefinition`, and
  `Relation` entities + CRUD are all implemented (`world/`, `folder/`,
  `entry/`, `tag/`, `relation/`, `relation/definition/` packages), plus a
  read-only `GraphService`/`GraphController` (`graph/`) aggregating
  Entry+Relation into nodes/edges for both the per-entry and full-world graph
  views, a general search endpoint (`search/`, title/summary/content) and the
  narrower entry-title typeahead (`GET /api/worlds/{worldId}/entries/search`)
  that backs the wikilink autocomplete, and the sidebar's
  `GET /api/worlds/{worldId}/hierarchy` aggregation endpoint.
- **Frontend:** a shell (`index.html` + `js/app.js` + `js/api.js`) with a
  real folder/entry tree sidebar (`js/sidebar.js` + `css/sidebar.css`), a
  markdown editor with a full formatting toolbar and syntax highlighting, a
  tag pill row, an entry header (letter-avatar, summary, timestamps), a
  far-left icon rail and a right icon rail (outline/backlinks/entry-graph
  panels), a theme toggle, and a top-bar search box. Obsidian-style
  `[[entity]]` cross-references with autocomplete, an explicit view/edit
  mode toggle, dynamically-created colored tags, and drag-and-drop
  folder/entry organization were built ahead of the "Suggested
  implementation order" below on direct request; the general toolbar/
  highlighting, entry header, right panel, and relation graph have since
  caught up to close most of the remaining gap. See "Wikilink references &
  edit mode", "Tags", "Navigation", "Relations & graph", and "Right panel"
  below for what's actually implemented, and
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
- ✅ **`RelationDefinition`** — `id`, `world` (`@ManyToOne`), `name`,
  `reverseName` (e.g. `"rules"` / `"ruled by"` — the reverse name is what's
  shown traversing the edge from the target side). `RelationDefinitionService`
  logic lives folded into `RelationService` (they're always used together —
  creating a `Relation` needs to resolve a `RelationDefinition`), but
  `RelationDefinitionController` stays a separate controller class since it
  owns a different resource root (`/api/worlds/{worldId}/relation-definitions`
  vs `/api/relations`). See "Relations & graph" below.
- ✅ **`Relation`** — `id`, `sourceEntry`/`targetEntry`/`relationDefinition`
  (all real `@ManyToOne`, no bare FK `Long`s, no redundant `worldId` column —
  world membership is derived from `sourceEntry.getWorld()` and cross-checked
  against the other two). `RelationService.createRelation` rejects
  self-relations, resolves all three ids (404 if any missing), enforces all
  three share one `World`, and rejects a duplicate relation of the *same
  type* in either direction (two entries can still have relations of
  *different* types between them) — carried forward from the prior
  implementation as suggested. See "Relations & graph" below for the full
  REST contract.

✅ `GraphService` (read-only aggregation over `Entry` + `Relation`, no
storage of its own) reshapes rows into graph nodes/edges for both the
right-panel per-entry graph (BFS-expanded to a given depth, capped at 5) and
the full-world graph behind the far-left graph icon. See "Relations & graph"
below.

## Feature checklist

- **World management:** create/list/switch worlds; world switcher dropdown in
  the top bar and left sidebar header. Partially built: a plain `<select>` +
  "create world" form in the top bar does create/list/switch, but it's not
  yet the icon+name+chevron dropdown the screenshot shows, and there's no
  left-sidebar header copy of it (there's no left sidebar tree at all yet).
- ✅ **Navigation (mostly implemented):** collapsible folder/entry tree
  scoped to the active world; breadcrumb reflecting the open entry's folder
  path; far-left rail for switching between notes/library/database/graph
  modes. The tree, breadcrumb, and far-left rail are all built — see
  "Navigation" below for the tree's full behavior (nested folders,
  drag-and-drop, horizontal scroll). The rail's notes and graph modes are
  live; library/database render as visibly-disabled placeholders since they
  have no views behind them yet (deliberately deferred, not an oversight).
- ✅ **Search (implemented):** a debounced top-bar search box scoped to the
  active world, matching entry title/summary/content
  (`GET /api/worlds/{worldId}/search?q=`), dropdown of results with a
  summary snippet, click-to-navigate. Distinct from the narrower
  entry-title-only typeahead (`GET /api/worlds/{worldId}/entries/search`)
  that backs the wikilink `[[`-autocomplete popup — see the REST API
  sketch's distinction between the two endpoints. `js/search.js`.
- ✅ **Entry viewing (implemented):** a real header block — circular
  letter-avatar (hashed from the title; no icon-picker UX exists yet, so
  this is a deliberate stand-in for the screenshot's "circular type icon"),
  title, one-line summary (now backed by `EntryUpdateRequest.summary`),
  colored tag pills (see "Tags" below), right-aligned Created/Last modified
  timestamps, and the breadcrumb (see "Navigation" below). Content toolbar
  is the simpler Edit/Save/Delete + entry-graph icon-button row actually
  built rather than the screenshot's edit/link/duplicate/`...`-overflow —
  see "Wikilink references & edit mode" below.
- ✅ **Entry editing (implemented):** markdown source editor with a full
  formatting toolbar (undo/redo, headings dropdown, bold/italic/underline/
  strikethrough, link, image, bullet/numbered list, blockquote, inline code,
  fenced code block) inserting/wrapping raw markdown at the cursor; extended
  header/bullet/bold/italic/inline-code/codeblock syntax highlighting in the
  overlay; live word count + `Markdown · N words` footer label; and a
  rendered read-mode preview (DOM, not just styled source) when not editing.
  `js/editor.js`/`css/editor.css`.
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
- ✅ **Relations & graph (implemented):** `RelationDefinition`/`Relation`
  backend + REST (see Domain model above), and a graph view merging two edge
  kinds into one picture — solid labeled edges for formal `Relation`s, dashed
  edges for resolved `[[wikilink]]` references (no relation-creation UI yet;
  only display/consumption of existing relations is wired — see "Relations &
  graph" below). Full-world graph stays the existing force-directed modal
  (`js/graph.js`, opened from the top bar or the far-left rail's graph
  icon); the per-entry graph is a new small embedded radial panel in the
  right rail.
- ✅ **Right panel (implemented):** outline (headings parsed client-side
  from `contentMarkdown`, click-to-jump) and backlinks (currently
  wikilink-derived only — "Linked from" entries whose content resolves a
  `[[This Entry]]` reference; a formal-Relation-based section is deferred
  until relation-creation UI exists, see "Relations & graph" below) both
  implemented, plus the entry-graph panel described above.
- ✅ **Misc — theme toggle (implemented):** light/dark via a
  `[data-theme="light"]` CSS custom-property override block, toggled by
  `js/theme.js`, persisted to `localStorage`, defaults dark to match prior
  behavior. Notifications bell is still a stub only, no feed exists yet —
  stays out of scope unless asked.

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
relation/         ✅ built: Relation, RelationRepository, RelationService, RelationController, contract/
                  (RelationService also owns RelationDefinition CRUD -- see relation/definition/
                  below and "Relations & graph")
relation/definition/  ✅ built: RelationDefinition, RelationDefinitionRepository,
                  RelationDefinitionController, contract/ (CRUD logic itself lives in
                  relation/RelationService, this controller just owns the separate
                  /api/worlds/{worldId}/relation-definitions resource root)
graph/            ✅ built: GraphService (worldGraph/entryGraph, BFS depth-capped at 5),
                  GraphController, contract/GraphNode, GraphEdge, GraphResponse
search/           ✅ built: SearchController for the general title/summary/content search
                  checklist item, delegating to EntryService.searchEntries (a new
                  EntryRepository @Query, case-insensitive substring match, title/summary
                  matches ranked before content-only matches). EntryService's older
                  title-only search method (the wikilink typeahead) is untouched.
common/           ✅ built: GlobalExceptionHandler (@RestControllerAdvice: EntityNotFoundException→404,
                  IllegalArgumentException→400, {EntityExistsException,IllegalStateException}→409 —
                  services throw, controllers don't catch)
```

### Frontend (`src/main/resources/static/`)

Sidebar and top bar persist across entries, so prefer a single app shell with
client-side view-swapping over full page reloads (`history.pushState` +
dynamic content injection), rather than one HTML file per entry. Nearly the
full target below now exists — far-left rail, right rail, and graph are all
built; the world switcher is still a plain `<select>`, not the
icon+chevron dropdown (see the World management checklist note):

```
index.html            ✅ built: top bar (world picker, search, theme toggle) + far-left icon
                       rail + folder/entry tree sidebar + content panel (breadcrumb, icon
                       toolbar, entry header, tag row, editor) + right icon rail with
                       outline/backlinks/entry-graph panels.
css/
  variables.css        not built — theme tokens still live as :root vars directly in base.css
  layout.css           not built — shell layout rules still live in base.css
  base.css             ✅ built: baseline layout/typography, entry header/avatar/timestamp
                       styling, plus a [data-theme="light"] override block redefining the same
                       custom-property names for the theme toggle (see rail.css note below for
                       why the rail itself isn't in this file)
  editor.css           ✅ built, wider scope than sketched: wikilink resolved/unresolved
                       highlighting, autocomplete popup styling, view/edit-mode outline marker +
                       cursor rules, extended header/bullet/bold/italic/code token styling, the
                       full formatting toolbar's button styling, and rendered read-mode preview
                       styling.
  tags.css              ✅ built (not in the original sketch, which put tag-pill styling in
                       components.css): tag pill colors/layout, color-swatch dot, add-tag form.
  sidebar.css            ✅ built (not in the original sketch): folder/entry tree rows,
                       drag-and-drop feedback (drag-over highlight, dragging opacity), the
                       "World root" drop-zone row, breadcrumb. See "Navigation" below.
  graph.css              ✅ built (not in the original sketch): world-graph modal chrome, node/
                       edge drawing (solid+labeled for Relations, dashed for wikilinks), and the
                       new embedded right-rail entry-graph panel. See "Relations & graph" below.
  rail.css               ✅ built (not in the original sketch): far-left and right icon rail
                       strip layout/active-state styling, shared between both rails.
  outline.css            ✅ built (not in the original sketch): outline panel TOC styling.
  backlinks.css          ✅ built (not in the original sketch): the "Links" panel's collapsible
                       "Linked to"/"Linked from" sections, Active/Inactive subgroup styling. See
                       "Right panel" below.
  search.css             ✅ built (not in the original sketch): top-bar search dropdown styling.
  link-preview.css       ✅ built (not in the original sketch): the shared hover-preview popup
                       card (js/link-preview.js) shown over a resolved [[wikilink]] or an Active
                       backlinks item. See "Wikilink references & edit mode" below.
  components.css        not built — no world-switcher dropdown exists yet to style; tag pills,
                       breadcrumb, and the other small components built so far live in their
                       own feature-specific CSS files instead
js/
  api.js               ✅ built: fetch wrapper, including searchEntryTitles() (wikilink
                       typeahead), searchWorld() (general search), listWorldTags/addEntryTag/
                       removeEntryTag/updateTag (tags), getHierarchy/createFolder/deleteFolder/
                       moveFolder/moveEntry (navigation), listEntryRelations/getEntryGraph/
                       getWorldGraph (relations & graph)
  app.js               ✅ built: world/entry CRUD wiring, view/edit mode state
                       (setEditing/onToggleEditing), auto-save-on-exit-edit, tag-row re-render
                       wiring (renderTags/onEntryTagsChanged), sidebar re-render wiring
                       (renderSidebar/loadHierarchy), breadcrumb rendering (renderBreadcrumb),
                       entry header rendering (renderTimestamps/renderEntryAvatar/hashToColor --
                       simple enough to live here rather than their own module, same reasoning
                       as the breadcrumb). Still not a full "shell bootstrap + view routing" —
                       there's only one main view, the far-left rail's other modes are stubs.
  editor.js             ✅ built, wider scope than sketched: [[wikilink]] tokenizer + overlay
                       renderer, click/dblclick routing (view-mode navigate vs. edit-mode
                       caret-only), hover hand-cursor, [[-triggered autocomplete popup,
                       Escape-to-exit-edit-mode callback, extended header/bullet/bold/italic/
                       inline-code/codeblock syntax highlighting, full toolbar button wiring
                       (insert/wrap markdown at the cursor), live word count, and a rendered
                       DOM preview for view mode. Textarea+overlay rendering (not
                       contenteditable) — see the design doc. No standalone autosave-while-typing
                       (saving still only happens via the Save button or on edit-mode exit).
  sidebar.js            ✅ built, different scope than sketched: client-side folder/entry tree
                       building from the flat hierarchy response, collapse/expand, folder
                       create/delete/nested-create, entry create/delete (routed back to app.js --
                       see "Navigation" below for why), and drag-and-drop for both entries and
                       folders. See "Navigation" below.
  outline.js             ✅ built (not in the original sketch, which called this out as separate
                       from entry-view.js): parses #{1,6} headings client-side from
                       contentMarkdown, click-to-jump in both edit and view mode.
  backlinks.js           ✅ built (not in the original sketch): the wikilink-derived, collapsible
                       "Linked to"/"Linked from" "Links" panel (Active/Inactive split, click-to-
                       create-stub on Inactive items). See "Relations & graph" below for why it's
                       wikilink-derived rather than Relation-based for now, and "Right panel" below
                       for the panel's own behavior.
  tags.js                ✅ built: pill rendering, add-tag form (with a <datalist> of the
                       world's existing tag names), remove button, color-swatch dot that opens a
                       native <input type="color">. See "Tags" below.
  graph.js                ✅ built, wider scope than sketched: originally just the wikilink-
                       derived graph modal, now also fetches/merges GET /api/graph/world|entry
                       (solid labeled Relation edges + dashed wikilink edges in one view) and
                       renders both the existing world-graph modal and a new small embedded
                       right-rail entry-graph panel (radial layout) off a shared
                       compute/layout/draw pipeline. See "Relations & graph" below.
  search.js               ✅ built: debounced (~150-200ms, AbortController-cancelled) top-bar
                       search dropdown against GET /api/worlds/{worldId}/search, click-to-navigate.
  theme.js                 ✅ built (not in the original sketch): toggles
                       document.documentElement.dataset.theme between "light"/"dark",
                       persists to localStorage, defaults dark.
  link-preview.js         ✅ built (not in the original sketch): the shared hover-preview popup
                       (title + one-line summary) wired onto every resolved link to an existing
                       entry -- editor.js's rendered [[wikilink]] spans and backlinks.js's Active
                       items both call into this rather than duplicating popup logic. See
                       "Wikilink references & edit mode" below.
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
GET    /api/worlds/{worldId}/search?q=&limit=  ✅ general title/summary/content search, backing the
                                               # top-bar search box (js/search.js). SearchResultResponse:
                                               # {id,title,summary,icon,folderId}; blank/missing q -> [],
                                               # not 400; limit defaults to 20. Case-insensitive substring
                                               # match, title matches ranked before summary before
                                               # content-only matches, then alphabetical. Distinct from
                                               # the narrower typeahead below.

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
PATCH  /api/entries/{id}                      ✅ now also takes folderId? and summary?, same
                                               # null-means-unchanged convention as title/contentMarkdown
                                               # -- summary backs the entry header's subtitle field (see
                                               # the Entry viewing checklist item); see the move endpoint
                                               # below for why folderId being null-means-unchanged isn't
                                               # enough for drag-and-drop
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

GET    /api/worlds/{worldId}/relation-definitions   ✅ List<RelationDefinitionResponse
                                               # {id,worldId,name,reverseName}>
POST   /api/worlds/{worldId}/relation-definitions   ✅ {name, reverseName} both required non-blank -> 201;
                                               # 400 if blank
GET    /api/entries/{id}/relations            ✅ both directions combined (outgoing: label=definition
                                               # .name; incoming: label=definition.reverseName), sorted
                                               # by relatedEntryTitle. RelationResponse:
                                               # {id,relationDefinitionId,relatedEntryId,
                                               # relatedEntryTitle,relatedEntryIcon,label,outgoing}.
                                               # Built entirely inside RelationService's @Transactional
                                               # method, not mapped in the controller -- see the
                                               # "Relations & graph" section below for why that matters
                                               # (a real bug found during manual verification).
POST   /api/relations                         ✅ {sourceEntryId,targetEntryId,relationDefinitionId} ->
                                               # 201 RelationResponse (outgoing=true, label=name); 400
                                               # self-relation/cross-world mismatch; 404 id not found;
                                               # 409 duplicate relation of the same type in either
                                               # direction (different types between the same two
                                               # entries are still allowed)
DELETE /api/relations/{id}                    ✅ 204; 404 if not found

GET    /api/graph/world/{worldId}             ✅ GraphResponse {nodes:[{id,title,icon}],
                                               # edges:[{sourceId,targetId,label,relationDefinitionId}]}
                                               # -- every Entry in the world as nodes, every Relation
                                               # whose source+target both belong to the world as edges
GET    /api/graph/entry/{id}?depth=1          ✅ same shape, BFS-expanded from {id} out to `depth` hops
                                               # (both directions), depth defaults to 1, 0 -> center node
                                               # only, clamped 0-5 (400 outside that range), 404 if the
                                               # entry doesn't exist
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

**Highlighting and the toolbar are now built to the full spec.** The
tokenizer is one ordered regex pass (codeblock → block-line header/
blockquote/list → inline wikilink/code/bold/italic) over the source
producing a token list consumed by the overlay renderer — additive to the
original wikilink-only pass, not a rewrite, as originally planned. The
formatting toolbar (undo/redo, headings dropdown, bold/italic/underline/
strikethrough, link, image, bullet/numbered list, blockquote, inline code,
fenced code block) inserts/wraps markdown syntax at the cursor rather than
manipulating a rich-text DOM, sitting alongside the original three
icon-only buttons (Edit/Save/Delete). Word count and the `Markdown · N
words` footer label are computed client-side from the raw text on every
keystroke. View mode additionally renders a real DOM markdown preview
(`renderPreviewDOM` in `js/editor.js`) rather than just styled source —
beyond what this section originally called for, landed alongside the rest
of the toolbar/highlighting work.

Persist `Entry.contentMarkdown` as-is — no server-side rendering for the
editor itself; the preview above is a client-side render pass over the same
raw markdown, not a stored second copy.

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
- **Hover preview popup:** hovering a *resolved* `[[...]]` span in the
  rendered view-mode preview (real DOM, unlike the pointer-events:none
  overlay above, so this one's a plain `mouseenter`/`mouseleave` pair, no
  hit-testing needed) shows a small card with the target entry's title and
  one-line `summary` after a short delay, via the shared
  `js/link-preview.js`/`css/link-preview.css` module — shared because the
  right panel's Backlinks "Links" panel (see "Right panel" below) uses the
  exact same popup for its Active items. Deliberately gated to *resolved*
  links only at the call site (an unresolved span, and an Inactive backlinks
  item, are simply never passed to `linkPreview.attach()` in the first
  place) rather than the popup module re-deriving resolution itself.
  `editor.js` keeps a small `Map<entryId, Entry>` (`entryById`, built
  alongside `titleIndex`) purely to back this, since a resolved span's DOM
  only carries the target's id.
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
- The world switcher as an icon+name+chevron dropdown, and a copy of it in
  the sidebar header — still a plain `<select>` in the top bar; see the
  Feature checklist's World management note.
- Renaming a folder, and moving an entry/folder via anything other than
  drag-and-drop or the "↑ to root" button (e.g. a "move to..." picker
  dialog) — `PATCH /api/folders/{id}` supports renaming server-side, there's
  just no UI trigger for it yet.

## Relations & graph (implemented)

Backend (`relation/`, `relation/definition/`, `graph/`) and the graph-view
frontend work landed together; relation-*creation* UI (a form to pick two
entries + a relation type) did not — only display/consumption of relations
already created via the REST API directly. See the REST API sketch above
for exact contracts.

**Backend:**
- `RelationService` folds `RelationDefinition` CRUD together with `Relation`
  logic (they're always used together), while `RelationDefinitionController`
  stays a separate controller class since it owns a different resource root.
- `RelationService.createRelation` validation order: self-relation check
  (cheap, before any DB hit) → resolve source/target/definition (404 if
  missing) → cross-world guard (all three must share one `World`) →
  duplicate-in-either-direction check scoped to the relation *type* (two
  entries can still have relations of different types between them).
- `RelationResponse` is perspective-aware: `GET /api/entries/{id}/relations`
  returns both directions combined, flipping `label`/`outgoing` depending on
  whether `{id}` is the relation's source (label = `definition.name`) or
  target (label = `definition.reverseName`).
- **A real bug found and fixed during manual end-to-end verification (not
  caught by `compileJava`/tests):** the original implementation mapped
  `Relation` → `RelationResponse` in the *controller*, outside
  `RelationService`'s `@Transactional` boundary, relying on
  `Stream.sorted()` having incidentally initialized the related entry's lazy
  proxy as a side effect of comparing elements. `Stream.sorted()` skips
  calling the comparator entirely for a 0/1-element stream, so a
  single-relation entry left its related `Entry` proxy uninitialized; lazily
  touching it later (under `spring.jpa.open-in-view`, which reopens a
  connection in autocommit mode outside a real transaction) then failed
  specifically for the `contentMarkdown` `@Lob`/CLOB column (Postgres
  large-object streaming requires a non-autocommit transaction). Fixed by
  building `RelationResponse` inside the transactional service method
  instead of leaving it to an incidental side effect. Worth remembering if
  anyone adds another endpoint that maps lazy-loaded cross-entity fields —
  do the mapping *inside* the `@Transactional` method, not after it returns.
- `GraphService` is genuinely read-only/stateless (no entity, no repository
  of its own) — `worldGraph` returns every `Entry` in a world as nodes and
  every `Relation` between them as edges; `entryGraph` BFS-expands from one
  entry out to a given depth (both relation directions counted as
  neighbors), depth clamped to `0..5` server-side.

**Frontend (`js/graph.js`, `css/graph.css`):**
- The pre-existing wikilink-derived graph (a client-side computation over
  `[[wikilink]]` references already in `state.entries`, predating this
  system entirely) and the new `Relation`-backed graph are **merged into one
  view**, not kept as separate toggleable modes — nodes are deduped by entry
  id, edges are tagged `kind: 'relation' | 'wikilink'` so `drawEdgeInitial`
  renders solid+labeled lines for formal relations and dashed lines for
  wikilink references.
- The **full-world graph stays the pre-existing modal** (opened from the top
  bar's "Graph view" button or the far-left rail's graph icon) — a
  force-directed layout of an entire world's entries needs real screen
  space a narrow rail panel can't give it.
- The **per-entry graph is a new small embedded panel in the right rail**
  (`renderEntryPanel`), reusing the same compute/simulation/draw pipeline as
  the modal via a `createRenderer()` factory so the two views have
  independent render/simulation state.
- **The graph is a live, draggable force simulation, not a static one-shot
  layout** (on direct request, after the initial version above landed):
  nodes repel each other (`simulationTick`'s O(n²) repulsion pass), edges
  act as springs pulling their two endpoints toward a resting distance (so
  dragging one node drags its whole connected chain along), every node
  drifts toward the viewport center, and the whole thing runs on a
  `requestAnimationFrame` loop whose forces are scaled by a cooling `alpha`
  that decays every tick (`createSimulationController`) — so it settles and
  the RAF loop stops on its own once nothing is left to react to, and stays
  stopped until something reheats it. Hand-rolled rather than pulling in
  d3-force (no new dependency, consistent with the "no framework/bundler"
  rule). Dragging (`attachDragHandlers`, pointer events + `getScreenCTM` for
  accurate coordinates regardless of canvas scaling) pins the dragged node
  (`fixed: true`, exempted from integration but still exerting forces on
  everyone else) and reheats alpha on every move and once more on release,
  so connected nodes visibly follow along and the graph gets a few ticks to
  resettle before cooling back down to a stop; a `moved`-threshold guard
  keeps a plain click (no drag) from ever pinning/reheating anything, and
  the `click` handler ignores the synthetic click a browser fires after a
  real drag's pointerup, so dragging a node never also navigates to it.
  Nodes/edges are created once and repositioned in place every tick
  (`positionNode`/`positionEdge`), not torn down and redrawn, both for
  performance and so the drag/click listeners attached to each circle
  survive across ticks.

**Known gaps, deliberately deferred:**
- No relation-creation UI — `RelationDefinition`/`Relation` rows currently
  only get created by calling the REST API directly. A form to pick two
  entries + a relation type (and create new relation types inline, the way
  tags do) is the natural next step but wasn't scoped into this pass.
- Backlinks (see "Right panel" below) don't yet have a "Related via ..."
  section sourced from formal `Relation`s — only the wikilink-derived
  section exists so far, since relation-creation UI doesn't exist yet to
  populate it meaningfully.

## Right panel (implemented)

Mirrors the left rail (`css/rail.css`), toggling three panels — only one
open at a time. All three are read-only/display-only for *navigation*
purposes (no rename/delete/reorder UI here); the one exception is the
Backlinks panel's "Linked to → Inactive" subgroup below, which can create a
stub `Entry`, same as the editor's own double-click-to-create-stub — headings
still come from the editor, "Linked from" only ever reflects entries that
already exist, and relations aren't creatable from the UI at all yet (see
above).

- **Outline** (`js/outline.js`, `css/outline.css`): `#{1,6}` headings parsed
  client-side from the open entry's `contentMarkdown`, rendered as an
  indented, clickable TOC. Clicking jumps the textarea caret to that
  heading's line in edit mode, or scrolls the matching rendered-preview
  heading into view in view mode.
- **Backlinks** (`js/backlinks.js`, `css/backlinks.css`, panel titled
  "Links"): two **collapsible** (chevron-toggle header, same rotate-on-
  toggle convention as sidebar.css's `.tree-toggle`, expanded by default,
  collapse state kept in a module-scope `collapsedSections` map so it
  survives switching entries) wikilink-derived sections, **"Linked to"
  shown above "Linked from"**:
  - **"Linked to"** — every distinct title the *open* entry's own
    `[[wikilink]]`s reference (outgoing), split into an **Active**
    subgroup (an entry with that title exists — same accent color as
    `editor.css`'s `.wikilink-resolved`, clickable, navigates) and an
    **Inactive** subgroup (no entry with that title exists yet — same
    warn-colored dotted underline as `.wikilink-unresolved`, and
    *clickable*: clicking creates a stub `Entry` with that exact title
    (`POST /api/worlds/{worldId}/entries`, empty content) via the same
    underlying call editor.js's double-click-to-create-stub makes, then
    hands the new entry to `config.onEntriesChanged` — app.js wires this to
    `onLinkedToStubCreated`, which **navigates straight into the new entry
    in edit mode** (`openEntry(id, { startEditing: true })`, the same
    "ready to type immediately" treatment `onCreateEntry` gives every other
    freshly-created entry). This is deliberately *different* from
    editor.js's own `onStubEntryCreated`, which flips the double-clicked
    span to resolved in place and stays put — that one is guarding an
    in-progress edit on the *current* entry, which doesn't apply here since
    the backlinks panel itself is otherwise display-only. A trailing
    "+ create" hint fades in on hover so the affordance is discoverable, and
    the item disables itself (`.creating`) for the duration of the request
    to guard against a double-click firing two creates).
  - **"Linked from"** — every *other* entry whose `contentMarkdown`
    resolves a `[[This Entry's Title]]` reference back (incoming); not
    split into Active/Inactive since a Linked-from entry has to exist to
    have content in the first place, and rendered with the same Active
    accent-colored styling as "Linked to"'s Active subgroup.

  Every Active item (in either section) also carries the same
  `js/link-preview.js` hover-preview popup the main content's resolved
  `[[wikilink]]`s use — see "Wikilink references & edit mode" above — since
  it's the same "link to an entry that already exists" case either way.

  Both via `js/wikilink-parser.js` + `state.entries`, same resolution
  convention the editor's own wikilink highlighting uses —
  **wikilink-derived, not `Relation`-based**, a deliberate choice made
  because wikilinks are what users actually create today and formal
  relations have no creation UI yet (would otherwise show empty for a long
  time). Each top-level section header shows a pill-shaped count badge, and
  a small accent/warn-colored dot ahead of each "Active"/"Inactive" subgroup
  label echoes the same color-coding as the items themselves, for
  quick-scan legibility. Every individual list (Linked from, and each of
  Linked to's two subgroups) is independently height-capped
  (`max-height: 22vh`) with its own `overflow-y: auto`, so a long list can't
  push the rest of the panel out of view — on top of `#right-panel`'s
  pre-existing panel-wide scroll fallback (`css/rail.css`). Verified against
  two cross-linked entries
  during manual testing. A third "Related via ..." section sourced from
  formal `Relation`s is the natural next step once relation-creation UI
  exists — intentionally left as a separate future section rather than
  merged into these, since it has different semantics.
- **Entry relation graph**: see "Relations & graph" above.

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
4. ✅ Static app shell: top bar, far-left rail, tree sidebar rendering from
   the hierarchy endpoint. Top bar + far-left rail (notes/graph wired,
   library/database visibly-disabled placeholders) + a real folder/entry
   tree (with drag-and-drop, collapse/expand, nested creation — see
   "Navigation" above) all built.
5. ✅ Entry view: header, breadcrumb, metadata, content panel (read-only
   first). Content panel read-only-first behavior, tag row, breadcrumb, and
   now a real entry header block (letter-avatar, summary field, Created/
   Last modified timestamps) all built — see the Entry viewing checklist
   item above.
6. ✅ `Tag` + `EntryTag`; tag pills on the entry header. Landed ahead of this
   step on direct request, alongside wikilinks/edit mode (step 7). See
   "Tags" above. No standalone `EntryTag` entity (`Entry.tags` is a plain
   `@ManyToMany`, see Domain model).
7. ✅ Markdown editor: toolbar + syntax highlighting + save/autosave.
   `[[wikilink]]` tokenizing/highlighting, click-to-navigate, autocomplete,
   and save-on-edit-mode-exit landed ahead of this step on direct request;
   the general formatting toolbar, header/bullet/bold/italic/code syntax
   highlighting, and word count have since caught up (see "Editor
   implementation notes" above). Per-keystroke autosave is still not
   built — saving happens via the Save button or on edit-mode exit only.
8. ✅ `RelationDefinition` + `Relation` + `GraphService`; right-panel graph.
   Backend and graph view both built (merging wikilink-derived and formal
   `Relation` edges into one picture) — see "Relations & graph" above. Note:
   resolved wikilinks are shown in the *graph* now (as dashed edges), but
   still aren't *stored* as `Relation` rows — a wikilink and a formal
   relation remain two independent things, per the design doc's original
   non-goal; no relation-creation UI exists yet either.
9. ✅ Right panel: outline (parse headings client-side from
   `contentMarkdown`), backlinks. Both built — see "Right panel" above.
   Backlinks is wikilink-derived rather than the originally-sketched
   "reverse relation lookup", since relation-creation UI doesn't exist yet
   to populate a Relation-based version meaningfully.
10. ✅ Search endpoint wired to the top search bar. `GET
    /api/worlds/{worldId}/search` + `js/search.js`, distinct from the
    narrower entry-title typeahead used by the wikilink autocomplete (step
    7) — see the REST API sketch's distinction.
11. ✅ Theme toggle (CSS custom-property tokens, light/dark, `localStorage`).
    `js/theme.js` + a `[data-theme="light"]` override block in `base.css`
    reusing the same custom-property names as the dark `:root` default.
12. Notifications bell stays a static placeholder unless scoped separately.
    **Still N/A** — no notification feed/backend exists, and none of the
    other top-bar icon work above touched it; out of scope unless asked.

## Cleanup items found while surveying the repo

- ✅ Done: `build.gradle` no longer has `com.mysql:mysql-connector-j`, and
  only declares `spring-boot-starter-webmvc` (not also `-web`) — both items
  from an earlier pass of this list are resolved. `.idea/dataSources.xml`
  wasn't rechecked for a stale MySQL entry; low priority since it's IDE
  metadata, not something Gradle/the app reads.
- ✅ Done: `docs/` is no longer empty — it now has
  `docs/design/autocomplete-and-entity-references.md` (the wikilink/edit-mode
  design doc referenced throughout this file), and this file plus the design
  reference PNG are both committed (previously untracked). Still worth
  adding API-contract/TODO docs for the Relations/graph/search work as it
  matures further (e.g. a relation-creation UI design doc, once that gets
  built).
- No outstanding cleanup items beyond the `.idea/dataSources.xml` low-priority
  note above.
