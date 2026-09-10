# TODO — Left sidebar (entity hierarchy tree)

Implementation plan for `docs/entry-view-api.md` § 2. Checked items are already
done in the codebase.

> **Status (2026-09-09):** `entry-view.html`/`.js` is now wired to the real
> backend (worlds, entries, relations) including create/edit/delete of
> entities and a working hierarchy tree — see item 7 below and
> `docs/entry-view-missing-features.md` for what's still open.

- [x] **1. Add `entryType` to `LoreEntry`**
  - [x] `EntryType` enum (`WORLD`, `CONTINENT`, `STATE`, `CITY`, `REGION`, `PEOPLE`, `FACTION`, `GOD`, `CREATURE`, `RELIC`, `EVENT`)
  - [x] Static server-side `entryType → emoji` map (`EntryType.getIcon()`)
  - [x] `entryType` field on `LoreEntry` itself (enum not yet wired onto the entity)

- [x] **2. Model containment (parent/child)**
  - [x] Decide `parentId` column (recommended) vs. reserved `RelationDefinition` ("содержит"/"часть")
  - [x] Add `parentId` FK to `LoreEntry`
  - [x] Migration for existing rows (nullable / root = null)

- [x] **3. Add the `World` concept**
  - [x] `World` entity (`id`, `name`)
  - [x] `worldId` on `LoreEntry` (or root-entry convention)
  - [x] `GET /api/worlds`, `GET /api/worlds/{id}`

- [x] **4. Define category grouping nodes**
  - [x] Static lookup: `entryType → category label` (e.g. `STATE → "Государства"`, `CITY → "Города"`)

- [ ] **5. Build the hierarchy service**
  - [ ] `HierarchyService`: load root entry for a world
  - [ ] Recursively walk children via `parentId`
  - [ ] Group children by `entryType` into synthetic `category` nodes
  - [ ] Return tree shaped as `{ id, name, entryType, icon, children }` (entry) or `{ category, children }` (grouping)

- [ ] **6. Add the endpoint**
  - [ ] `GET /api/worlds/{worldId}/hierarchy` (new `WorldController` or extend existing)
  - [ ] Fetch strategy: single query + in-memory tree build (preferred) vs. N+1 traversal

- [x] **7. Wire up the frontend**
  - [x] Replace mock `TREE` in `entry-view.js` — done differently than planned: since
        §5/§6 (a dedicated `/hierarchy` endpoint) aren't built yet, the tree is built
        client-side from `GET /api/entry/` (grouping children by `parentId`, then by
        `type` into synthetic category nodes using the same icon/label as `EntryType`).
        Works today; should be swapped for the real endpoint once §5/§6 land, since
        fetching *all* entries doesn't scale.
  - [x] Render logic confirmed compatible with the `kind: 'entry' | 'category'` shape

- [ ] **8. (Optional/follow-up) Search tie-in**
  - [ ] Keep `entryType`/icon convention consistent between hierarchy and search (§1) endpoints