# Entry View — missing / not-yet-wired functionality

As of 2026-09-09, `entry-view.{html,css,js}` is wired to the real backend for
the scope requested: **create, edit and delete `LoreEntry` entities, and
display them in the left-sidebar hierarchy.** World switching, entry
navigation, and the relations tab are wired too, since they were needed to
make the above usable. Everything below is either genuinely missing on the
backend, or deliberately left out of scope for this pass.

See also `docs/entry-view-api.md` (original design doc, now partially
outdated) and `docs/left-sidebar-todo.md` (hierarchy implementation plan).

## What's now wired up

- **Worlds**: list/switch/create (`GET /api/worlds`, `POST /api/worlds/create`).
  A world switcher dropdown replaces the static navbar label.
- **Entities**: create, edit, delete (`POST /api/entry/create`,
  `POST /api/entry/update/{id}`, `DELETE /api/entry/{id}`) via a modal form
  (name, title, type, parent, description). Reachable from the "+" button in
  the sidebar footer, the per-row "+" that appears on hover, the toolbar ✎/🗑
  buttons, and the right-sidebar quick actions.
- **Hierarchy tree**: built client-side from `GET /api/entry/`, grouped by
  `parentId` and then by `type` (using the same icon/label as the backend
  `EntryType` enum) into synthetic category nodes, matching the `kind: 'entry'
  | 'category'` shape the page always expected. See the note in
  `docs/left-sidebar-todo.md` item 7 — this should move to a real
  `GET /api/worlds/{worldId}/hierarchy` endpoint once one exists, since
  fetching *every* entry to build the tree doesn't scale.
- **Relations tab / related entities**: reads `GET /api/relations/entry/{id}`,
  which now returns `targetName`/`targetType` directly (see below), so no more
  per-target `GET /api/entry/{id}` fetches. Relations can also be **created**
  from this page — "➕ Добавить связь" in the Связи tab and "🔗 Связать с
  сущностью" in the right-sidebar quick actions open a modal to pick a target
  entity and a relation type (or define a new relation type inline), then
  `POST /api/relations`. Each relation row also has a "✕" to
  `DELETE /api/relations/{id}`. The entity graph (`graph-visualization.html`)
  reflects the same backend data automatically since it queries
  `/api/graph/*` live — no separate wiring needed there.
- **Prev/next navigation**: computed client-side from siblings sharing the
  same `parentId`, sorted by name.
- **Deep links**: the URL now carries `?world=<id>&entry=<id>` so "copy link"
  and browser back/forward actually work.

## Still missing (backend work needed)

1. **Notes** — no `Note` entity/endpoints exist. The Notes tab still keeps
   notes in memory on the client only (lost on reload), same as before this
   change, just no longer backed by the old mock object.
2. **Search** — no `GET /api/.../search` endpoint. The search box is still a
   stub.
3. ~~**`RelationResponse` has no target name/type**~~ — fixed: it now returns
   `{ id, targetId, targetName, targetType, relationName, isOutgoing }`.
4. **No free-form entry attributes** (population, status, location, cover
   image, tags). The right-sidebar "Краткая информация" panel now shows only
   what's real — type, world, parent, id — instead of the mockup's fabricated
   fields (population, capital status, etc.). Adding a generic
   `Map<String,String>` attributes column (as `docs/entry-view-api.md` §5.1
   proposes) would let this panel show richer, per-type data again.
5. **Dedicated hierarchy endpoint** — see above; currently worked around
   client-side.
6. **Auth / user model** — "Мои сущности", notifications, and note authorship
   remain stubs; there's no user identity to filter or attribute by.

## Backend quirks found while wiring this up (not fixed, just documented)

- **`LoreEntryUpdateRequest` can't clear `parentId` back to `null`.**
  `LoreEntryService.update` only applies `parentId` when the request value is
  non-null, so there's no way to turn an entry back into a root via the
  update endpoint. The edit modal detects this case (picking "— Нет (корень) —"
  on an entry that currently has a parent) and blocks the submit with an
  inline explanation rather than silently no-op'ing.
- **`LoreEntryUpdateRequest` can't blank out `description`** the same way —
  `fieldValid` treats an empty string as "don't change this field", so
  clearing a description via the edit form leaves the old value in place.
  Not blocked client-side (low-impact), just noted here.
- ~~**Relation creation exists but isn't exposed here.**~~ Now wired up (see
  above). Note it's still a distinct concept from the containment `parentId`
  this page's "add child entity" actions use — creating a relation never
  changes an entry's `parentId`/hierarchy position.
