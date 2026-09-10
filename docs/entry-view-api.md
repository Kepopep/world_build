# Entry View page — API requirements

> **Status (2026-09-09):** the page has since been wired to the real backend
> (worlds, entries, relations, including create/edit/delete of entities and a
> client-side hierarchy tree). Several fields this document originally
> proposed as new (`entryType`, `parentId`, a `World` entity) now exist. This
> file is kept as the original design rationale; **`docs/entry-view-missing-features.md`
> is the up-to-date list of what's actually still missing** and the backend
> quirks discovered while wiring the page up.

This document describes the backend API needed to replace the hard-coded test
data in `src/main/resources/static/entry-view.{html,css,js}` with real data.

The page was built from the provided mockup using only what already exists in
the project (plain HTML/CSS/JS static resources served by Spring Boot, the
same pattern as `graph-visualization.html`). No frontend framework or new
library was introduced. Every block currently renders from a JS mock object
(`ENTRIES`, `TREE` in `entry-view.js`) shaped like the API responses described
below, so wiring it up later should mean replacing mock lookups with `fetch`
calls, not rewriting the rendering code.

Current backend building blocks it can build on:
- `LoreEntry` (`src/main/java/com/hisder/worldBuilding/enrty/LoreEntry.java`) — `id`, `name`, `title`, `description`.
- `EntryRelation` / `RelationDefinition` / `RelationResponse` (`src/main/java/com/hisder/worldBuilding/relation/`).
- `GET /api/entry/{id}`, `POST /api/entry/create`, `POST /api/entry/update/{id}`, `DELETE /api/entry/{id}` (`LoreEntryController`).
- `GET /api/relations/entry/{entryId}`, `POST /api/relations`, `GET/POST /api/relations/definitions` (`RelationController`).
- `GET /api/graph/all`, `GET /api/graph/entry/{id}`, `GET /api/graph/type/{type}` (`GraphController`).
- OpenAPI docs already exposed at `/openapi` (springdoc).

---

## 1. Top navbar

| Element | Data needed | Status |
|---|---|---|
| World name / switcher | List of worlds, current world | **New.** There is no `World` concept yet — a `LoreEntry` is the closest thing to a root node. Either add a `World` entity (`id`, `name`) that owns a set of root `LoreEntry` records, or treat the top-level `LoreEntry` (no parent) as "the world". |
| Search box | Full-text search across entries in the current world | **New.** `GET /api/worlds/{worldId}/search?q={text}` → `List<EntrySummary>` (id, name, title, entryType, icon). |
| Notifications | Unread count + list | **New**, out of scope for lore data — would need an activity/notification feed. Not required for MVP; page currently shows a static badge. |
| User avatar | Current user profile | **New.** Project has no authentication yet. Out of scope until auth exists. |

### Proposed: world switcher
```
GET /api/worlds
200 -> [ { "id": 1, "name": "Эхо Погибших Богов" } ]

GET /api/worlds/{id}
200 -> { "id": 1, "name": "Эхо Погибших Богов", "rootEntryId": 10 }
```

---

## 2. Left sidebar — entity hierarchy tree

The mockup's tree mixes two kinds of nodes:
- **Category folders** (Государства, Города, Регионы, …) — a grouping label, not a `LoreEntry`.
- **Entries** — actual `LoreEntry` records, clickable, opens in the main panel.

Today `LoreEntry` has no `entryType` and no parent/containment relationship, so
the tree cannot be derived from the current schema. Two schema additions are
needed:

1. `entryType` (or `category`) on `LoreEntry` — e.g. `WORLD`, `CONTINENT`,
   `STATE`, `CITY`, `REGION`, `PEOPLE`, `FACTION`, `GOD`, `CREATURE`, `RELIC`,
   `EVENT`. Drives both the tree icon/grouping and the "Тип" row in the quick
   info panel.
2. A containment/parent link — either a `parentId` column on `LoreEntry`, or a
   reserved `RelationDefinition` (e.g. `name: "содержит"`,
   `reverseName: "часть"`) that the tree endpoint walks instead of a plain
   foreign key. The relation approach reuses `EntryRelation` and needs no new
   table.

### Proposed endpoint
```
GET /api/worlds/{worldId}/hierarchy

200 ->
{
  "id": 10,
  "name": "Эхо Погибших Богов",
  "entryType": "WORLD",
  "icon": "🌐",
  "children": [
    {
      "id": 11,
      "name": "Мир",
      "entryType": "WORLD",
      "icon": "🔵",
      "children": [
        {
          "category": "Континенты",
          "children": [
            {
              "id": 12,
              "name": "Авелор",
              "entryType": "CONTINENT",
              "icon": "🏔",
              "children": [
                { "category": "Государства", "children": [ { "id": 13, "name": "Королевство Равиния", "entryType": "STATE", "icon": "👑", "children": [] } ] },
                { "category": "Города", "children": [ { "id": 14, "name": "Равиния", "entryType": "CITY", "icon": "🏛", "children": [] } ] }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```
A node either has `id` (a real entry, clickable) or `category` (a grouping
label, expand/collapse only) — matching the `kind: 'entry' | 'category'` used
in `entry-view.js`'s `TREE`.

---

## 3. Main content — header (cover, title, tags, toolbar)

| Element | Field | Status |
|---|---|---|
| Cover image | `coverImageUrl` | **New** field on `LoreEntry`. |
| Icon | `icon` (emoji or icon key) | **New**, or derived from `entryType`. |
| Title | `name` | Exists. |
| Subtitle | `subtitle` | **New** field, e.g. "Столица королевства Равиния". |
| Tag pills | `tags: string[]` (+ which one is "primary") | **New.** Could be free-form tags, or derived (entryType, status, parent state name). |
| Edit / link / more buttons | n/a | Reuse `POST /api/entry/update/{id}` for edit; "copy link" is client-only. |

### Proposed: extend the entry response
```
GET /api/entry/{id}

200 ->
{
  "id": 14,
  "name": "Равиния",
  "title": "Столица королевства Равиния",
  "description": "...",
  "entryType": "CITY",
  "icon": "👑",
  "coverImageUrl": "/uploads/entries/14/cover.jpg",
  "tags": ["Город", "Столица", "Королевство Равиния"]
}
```
`title` already exists on `LoreEntry` and is a natural fit for `subtitle` in
the mockup (the page currently mocks it as a separate field for clarity, but
reusing `title` avoids a schema change).

---

## 4. Tabs

### 4.1 Описание (Description)
Reuses the existing `description` field on `LoreEntry`. The mockup renders it
as headings/paragraphs/bullet lists. To keep this page framework-free (no
markdown-parser dependency was added), it currently expects `description` to
arrive as **structured blocks** rather than a raw markdown string:
```
"description": [
  { "type": "h1", "text": "Равиния" },
  { "type": "p",  "text": "Равиния — столица королевства..." },
  { "type": "h2", "text": "Общая информация" },
  { "type": "ul", "items": ["Тип: Город", "Статус: Столица"] }
]
```
Two options going forward:
- Store `description` as plain markdown text (simplest to author) and add a
  small markdown-to-block parser on the backend (or a vetted, already-approved
  frontend markdown library) so the contract above stays the same.
- Keep authoring description as structured JSON directly (e.g. a rich-text
  editor that saves this block shape).

### 4.2 Связи (Relations)
Endpoint already exists: `GET /api/relations/entry/{entryId}` →
`List<RelationResponse>` where `RelationResponse` is `{ targetId, relationName,
isOutgoing }` (`src/main/java/com/hisder/worldBuilding/relation/contract/RelationResponse.java`).

The UI needs the target's name, type and icon to render each row, so
`RelationResponse` needs two more fields (filled in by joining
`EntryRelation.target` in `RelationService.getRelations`):
```
{
  "targetId": 13,
  "targetName": "Королевство Равиния",
  "targetType": "STATE",
  "relationName": "столица королевства",
  "isOutgoing": true
}
```
`targetType` requires the `entryType` field from section 3. `targetIcon` can
be derived client-side from `targetType` instead of sent over the wire.

### 4.3 Заметки (Notes)
Entirely new feature — no `Note` concept exists today.

```
GET    /api/entry/{entryId}/notes           -> List<NoteResponse>
POST   /api/entry/{entryId}/notes           -> NoteResponse
DELETE /api/entry/{entryId}/notes/{noteId}  -> 204
```
```
NoteResponse:
{ "id": 1, "author": "ГМ", "createdAt": "2026-09-02T10:00:00Z", "text": "..." }

NoteCreateRequest:
{ "text": "Не забыть: ..." }
```
`author` should come from the authenticated user once auth exists; until then
it can default to a fixed placeholder (as the mock page does with `"Вы"`).

---

## 5. Right sidebar

### 5.1 Краткая информация (Quick info)
A label/value list. Fields shown in the mockup (`Тип`, `Статус`,
`Государство`, `Население`, `Расположение`) are not uniform across entry
types (a region has no `Население`, a state has no `Государство`). Proposed
shape — a generic ordered list the entry response already carries, so the
frontend doesn't need per-type logic:
```
"quickInfo": [
  { "label": "Тип", "value": "Город" },
  { "label": "Статус", "value": "Столица" },
  { "label": "Государство", "value": "Королевство Равиния", "linkEntryId": 13 },
  { "label": "Население", "value": "~ 250 000" },
  { "label": "Расположение", "value": "Западный Авелор, побережье моря Амонит" }
]
```
This needs new free-form attribute storage on `LoreEntry` (e.g. a
`Map<String,String>` / JSON column of custom fields), since population,
status, location, etc. aren't modeled today. `linkEntryId` is populated only
when the value refers to another entry (e.g. via the containment relation
from section 2).

### 5.2 Связанные сущности (Related entities)
Same data as the Связи tab (section 4.2) — the panel can call
`GET /api/relations/entry/{entryId}` and show the first N results, so no
separate endpoint is needed.

### 5.3 Быстрые действия (Quick actions)
All map to endpoints that already exist or are proposed above — no new
endpoint needed, just UI wiring:
- Редактировать → `POST /api/entry/update/{id}`
- Создать связанный элемент → `POST /api/entry/create` then `POST /api/relations`
- Добавить заметку → `POST /api/entry/{entryId}/notes` (section 4.3)

### 5.4 Навигация (Prev / next entity)
Needs a defined ordering among an entry's siblings (e.g. by name, or by
manual sort order within the parent category). Cheapest to add as two extra
fields on the entry response rather than a dedicated endpoint:
```
"prevEntry": { "id": 13, "name": "Королевство Равиния" },
"nextEntry": { "id": 15, "name": "Александрия" }
```
Computed server-side from the entry's siblings under the same parent/category
in the hierarchy from section 2.

---

## Summary of backend changes needed

1. **`LoreEntry`**: add `entryType`, `icon`, `subtitle` (or reuse `title`),
   `coverImageUrl`, `tags`, and a generic key/value `attributes` map (for
   population, status, location, etc.).
2. **Hierarchy**: add either a `parentId` column or a reserved containment
   `RelationDefinition`, plus `GET /api/worlds/{worldId}/hierarchy`.
3. **`RelationResponse`**: add `targetName` and `targetType`.
4. **New `Note` entity** + CRUD endpoints under `/api/entry/{id}/notes`.
5. **New `World` entity** (or convention for "root entry") +
   `GET /api/worlds`, `GET /api/worlds/{id}`.
6. **Search**: `GET /api/worlds/{worldId}/search?q=`.
7. **Prev/next**: computed sibling links returned alongside `GET /api/entry/{id}`.

Everything else on the page (theme toggle, notification badge placeholder,
"copy link" button) is presentation-only and needs no API.
