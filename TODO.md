# TODO.md

Implementation progress and deferred work for Mythos. See
[CLAUDE.md](CLAUDE.md) for the architecture/conventions Claude needs when
working in this repo — this file is a status/history log, not a guide.

## Status: feature checklist

- ✅ **World management** — create/list/switch works via a plain `<select>`
  + "create world" form. **Not done:** the icon+name+chevron dropdown
  design, and a copy of it in the sidebar header.
- ✅ **Navigation** — collapsible folder/entry tree, breadcrumb, far-left
  rail (notes/graph only; library/database placeholder icons were removed
  outright rather than kept as chrome-only stand-ins).
- ✅ **Search** — debounced top-bar search (title/summary/content),
  separate from the narrower wikilink-autocomplete typeahead.
- ✅ **Entry viewing** — header (letter-avatar, title, summary, tag pills,
  Created/Last modified), breadcrumb. Toolbar is a simpler Edit/Save/Delete
  + entry-graph icon row rather than the screenshot's
  edit/link/duplicate/`...`-overflow.
- ✅ **Entry editing** — full markdown toolbar + syntax highlighting +
  read-mode preview.
- ✅ **Wikilinks** (`[[Entry]]`) — autocomplete, resolved/unresolved
  highlighting, click-to-navigate, double-click-to-create-stub.
- ✅ **View/edit mode toggle.**
- ✅ **Tags** — dynamic creation, per-tag color, assign/remove.
- ✅ **Relations & graph** (backend + merged graph view). **Not done:**
  relation-creation UI.
- ✅ **Right panel** — outline + wikilink-derived backlinks + per-entry
  graph panel.
- ✅ **AI-powered entry generation.**
- ✅ **Theme toggle** (light/dark, localStorage).
- **N/A — notifications bell:** never existed in the UI; out of scope
  unless asked.

## Suggested implementation order (all landed; notes below)

1. `World` CRUD + world switcher — dropdown design still pending (see
   above).
2. `Folder` + `GET /hierarchy` — flat lists, client builds the tree.
3. `Entry` CRUD with `contentMarkdown`.
4. Static app shell + tree sidebar.
5. Entry view (header/breadcrumb/metadata/read-only-first content).
6. `Tag` + tag pills — landed early, alongside step 7.
7. Markdown editor (toolbar, highlighting, wikilinks, save-on-exit) —
   wikilinks/autocomplete/edit-mode landed ahead of the general toolbar
   work; per-keystroke autosave still not built (Save button /
   edit-mode-exit only).
8. `RelationDefinition`/`Relation`/`GraphService` + right-panel graph.
9. Right panel: outline + backlinks (wikilink-derived, not yet
   Relation-based).
10. Search endpoint + top search bar.
11. Theme toggle.
12. Notifications bell — N/A, never built.
13. AI-powered entry generation — added outside the original plan.

## Deferred / known gaps (not forgotten, just not scoped yet)

**World management**
- World switcher as icon+name+chevron dropdown; sidebar-header copy of it.

**Navigation**
- Renaming a folder via UI (`PATCH /api/folders/{id}` already supports it
  server-side).
- Moving an entry/folder via anything other than drag-and-drop or "↑ to
  root" (e.g. a "move to..." picker dialog).
- Reordering siblings within a folder (`sortOrder` is set once at creation,
  never touched again).
- Reordering within the root-level entry list.

**Tags**
- An entry other than the currently-open one, already cached in
  `state.entries`, won't show a tag's new color until reopened (a fresh
  `GET` is always correct — purely an in-memory staleness window).

**Relations & graph**
- No relation-creation UI (a form to pick two entries + a relation type,
  create relation types inline like tags do) — `Relation`/
  `RelationDefinition` rows only get created by calling the REST API
  directly.
- Backlinks has no "Related via ..." section sourced from formal
  `Relation`s (only wikilink-derived) — waiting on relation-creation UI to
  make it meaningful.

**Entry**
- No `Entry.icon` write path (icon picker UX) — entry header uses a hashed
  letter-avatar as a stand-in.
- No `(worldId, title)` uniqueness constraint, so wikilink resolution on
  colliding titles is last-write-wins in an in-memory map.

**AI generation**
- No streaming, no per-user API key management (single server-wide key),
  no regenerate/retry history, no image generation.
- Generated entries are never placed into a folder (`folderId` always sent
  as `null`) — no folder-scoped "Generate with AI" entry point.

**Frontend layout**
- `css/variables.css`, `css/layout.css`, `css/components.css`,
  `assets/icons/` from the original file-layout sketch were never split
  out (tokens live in `base.css`, small components in feature CSS, icons
  inline).

## Cleanup items

- ✅ `build.gradle`: removed `com.mysql:mysql-connector-j`; only declares
  `spring-boot-starter-webmvc` (not also `-web`).
- ✅ `docs/` populated with
  `docs/design/autocomplete-and-entity-references.md`; CLAUDE.md and the
  design-reference PNG are committed.
- Outstanding, low priority: `.idea/dataSources.xml` may still have a
  stale MySQL entry — IDE metadata only, not read by Gradle/the app.
- Consider adding: an API-contract/design doc for a future
  relation-creation UI, once that gets scoped.
