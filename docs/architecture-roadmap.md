# Architecture Roadmap

Grounded in actual repo state (verified via grep, not just CLAUDE.md), not the
originally assumed feature set — no "relation strength"/circular-relation
logic exists (only self-relation + duplicate-type rejection), no real test
suite (`contextLoads()` only), no Docker/CI, search is a plain JPQL `LIKE`.

Format: **Feature** — Priority / Effort — why — microservice impact

## Top 5 next (best impact/effort)
1. `(worldId, title)` unique constraint on `Entry` — real correctness bug fix, ~1hr.
2. Dockerfile/docker-compose (`./gradlew bootBuildImage` + `postgres:16`) — near-free, unblocks CI.
3. Real test suite for `RelationService`/`FolderService` — highest-leverage safety net.
4. Flyway migrations, replacing `ddl-auto=update` — before schema grows further.
5. Relation-creation UI — backend's done, just needs a form.

## Core features
- **Full-text search (tsvector+GIN)** — high/small — replaces slow `LIKE` search — future Search/Graph service reuses same index.
- **Entry versioning/history** — high/medium — no undo today — good first event-log candidate.
- **`(worldId,title)` unique constraint** — high/small — fixes wikilink-collision bug — no service impact.
- **Relation-creation UI** — high/medium — backend exists, no UI — enables Relation-based backlinks section.
- **Soft delete/trash** — medium/small — deletes are permanent — no service impact.

## Data management
- **World export/import (JSON)** — high/medium — no backup path — defines canonical serialization format for future inter-service transfer.
- **Flyway migrations** — high/medium — `ddl-auto=update` is fragile — each future service needs its own migration history.
- **Scheduled `pg_dump` backup** — medium/small — no migrations yet either — ops-only.

## Search & discovery
- **Faceted filter (tag/folder) on search** — medium/small — cheap given existing tag/folder model.
- **Orphan entries / unresolved wikilinks report** — low/small — `GraphService` BFS already does most of the work.
- **JSONB custom fields per entry type** — low/medium — structured queryable fields (population, ruler, etc.) without schema explosion.

## AI integration
- **AI-assisted entry generation** — medium/medium — zero AI surface exists today — build as a genuinely separate service (different failure mode: external latency/cost) — first real microservice candidate.
- **Consistency-check across linked entries** — low/large — sequence after graph+AI service both exist.

## Collaboration
- **Auth (Spring Security)** — critical/medium — everything below is blocked on this — classic API Gateway responsibility; good first gateway example.
- **World sharing w/ roles** — medium/medium (post-auth) — turns this into a multi-user tool — authorization belongs at gateway or a small Permissions service.
- **Comments** — low/medium — nice-to-have, depends on auth.

## UX/Frontend
- **Per-keystroke autosave** — medium/small — flagged gap in CLAUDE.md — crash currently loses unsaved work.
- **Mobile-responsive layout** — medium/medium — three-rail layout is desktop-only.
- **World-switcher dropdown polish** — low/small — already scoped, just not built.

## Microservices readiness
- **Shared contracts module (DTOs only)** — high/small — decide wire format now before duplicating DTOs across services.
- **Id-only refs at service boundaries** (`Relation.sourceEntry` → `sourceEntryId` + client lookup) — high/medium — biggest actual blocker to a clean split; JPA joins across `Entry`/`Relation` won't survive a split.
- **Outbox pattern / domain events table** — medium/medium — prerequisite for real Kafka/RabbitMQ event-driven comms without dual-write bugs.
- **API Gateway skeleton (routes 100% to monolith today)** — low/medium — practice the pattern before there's anything to actually route.

## Database/ORM gaps
- **N+1 audit on GraphService/relation queries** — high/small — CLAUDE.md already documents one real lazy-load bug (CLOB/autocommit); use `JOIN FETCH`/`@EntityGraph`.
- **Indexes on FK columns** (`world_id`, `folder_id`, `source_entry_id`, ...) — high/small — confirm explicitly, don't assume Hibernate added them.
- **Optimistic locking (`@Version`) on Entry** — medium/small — needed once multi-user editing exists; pairs with versioning feature.

## Testing & DevOps
- **Real unit/integration test suite** — critical/medium — only `contextLoads()` exists today; becomes contract-test foundation once services split.
- **Dockerfile + docker-compose** — high/small — zero containerization currently; direct prerequisite for any service split.
- **CI pipeline** — high/small — no `.github/workflows` exists; template once, reuse per service.
