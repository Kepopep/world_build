# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

This is a Gradle/Spring Boot project (Java 21). Use the wrapper (`./gradlew` on bash, `gradlew.bat` or `.\gradlew` on PowerShell).

- Run the app: `./gradlew bootRun`
- Build: `./gradlew build`
- Run all tests: `./gradlew test`
- Run a single test class: `./gradlew test --tests "com.hisder.worldBuilding.WorldBuildingApplicationTests"`
- Run a single test method: `./gradlew test --tests "com.hisder.worldBuilding.WorldBuildingApplicationTests.contextLoads"`

The app requires a running PostgreSQL instance matching `src/main/resources/application.properties` (`jdbc:postgresql://localhost:5432/worldBuilding`, user `postgres`). `spring.jpa.hibernate.ddl-auto=update` — schema is auto-migrated from entities on startup, there are no separate SQL migration files.

Once running, the app serves `/` → `graph-visualization.html`, and exposes OpenAPI docs at `/openapi` (springdoc).

## Architecture

Spring Boot MVC app for building/browsing interconnected worldbuilding lore (worlds, entries, relations between them), with a static HTML/JS/D3 frontend served directly from `src/main/resources/static` (no frontend build step, no SPA framework).

### Package structure (`com.hisder.worldBuilding`)

Feature-packaged, each with its own `Controller` → `Service` → `Repository` (+ `contract/` for request/response DTOs):

- **`enrty/`** (note the typo — kept for consistency, don't "fix" it in isolation): `LoreEntry` is the core entity — every piece of lore (world, continent, state, city, god, event, ...). Fields: `id`, `name`, `title`, `description`, `type` (`EntryType` enum, not yet mapped as a JPA `@Enumerated` column — see below), `parentId` (self-referential containment tree, nullable = root). `LoreEntryService` enforces: unique `name`, parent must exist, no cycles in the containment tree (`requireValidParent` walks ancestors), and deleting an entry promotes its children to roots rather than cascading the delete.
- **`relation/`**: `EntryRelation` is a directed edge between two `LoreEntry` rows (`source` → `target`) typed by a `RelationDefinition` (`name` / `reverseName`, e.g. "rules" / "ruled by" — the reverse name is what's shown when traversing the edge from the target's side). `RelationService` prevents self-relations and duplicate relations in either direction. `relation/definition/` holds the `RelationDefinition` entity + repository + create-request contract.
- **`graph/`**: Read-only aggregation layer over entries + relations for the graph visualization UI — full graph, a BFS-style neighborhood around one entry (`depth` param), and simple stats (average degree, most-connected node). Has no persistence of its own; `GraphService` just queries the other two repositories and reshapes the result into `GraphData`/`GraphNode`/`GraphEdge` records.
- **`common/GlobalExceptionHandler`**: `@RestControllerAdvice` mapping `EntityNotFoundException`→404, `EntityExistsException`/`DuplicateKeyException`/`IllegalStateException`→409, `IllegalArgumentException`→400, as plain-string bodies. Services signal these conditions by throwing rather than returning `Optional`/error objects — follow that convention in new service code instead of adding per-controller error handling.
- **`HomeController`**: forwards `/` to the static graph visualization page.

### Frontend (`src/main/resources/static/`)

Plain HTML/CSS/JS, no bundler — each page is a standalone `.html` + `.css` + `.js` triplet:
- `graph-visualization.{html,css,js}`: D3-based force-directed graph of all entries/relations, calls `GET /api/graph/*`.
- `entry-view.{html,css,js}`: entry detail page (hierarchy sidebar, description/relations/notes tabs, quick-info panel). Currently renders entirely from hard-coded mock objects (`ENTRIES`, `TREE`) in `entry-view.js`, **not yet wired to the backend**. `docs/entry-view-api.md` is the API contract this page expects once wired up; `docs/left-sidebar-todo.md` tracks implementation progress against it (checked items are done — currently only `entryType` and `parentId` on `LoreEntry` are in place; `World` entity, hierarchy endpoint, notes, search, and richer entry/relation responses are still pending).

### Known in-progress gaps (see `docs/` before assuming an endpoint exists)

- No `World` entity yet — a root `LoreEntry` (`parentId == null`) currently stands in for "a world".
- `EntryType` exists as an enum with per-type emoji icons but isn't yet persisted as a proper JPA-mapped column on `LoreEntry`.
- No auth/user model — anywhere a user identity would be needed (note authorship, etc.) is unimplemented.
