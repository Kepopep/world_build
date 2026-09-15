# Entry title uniqueness (per world)

Closes the known accepted gap called out in CLAUDE.md's wikilink section:
`Entry.title` had no `(worldId, title)` uniqueness constraint, so two entries
with the same (or case-variant) title in one world would silently collide in
the wikilink resolver's `Map<lowercaseTitle, entryId>` — whichever entry the
map's last write happened to land on "wins" the reference, non-
deterministically.

## Decision: case-insensitive, not case-sensitive

The obvious generic answer is a case-sensitive `(world_id, title)` unique
constraint. That's *not* what this fixes: the wikilink resolver already
treats titles as case-insensitive (it lowercases before indexing — see
`js/editor.js`'s `titleIndex`), so "Ravinia" and "ravinia" would still
collide in that map even with a case-sensitive DB constraint in place. The
constraint has to match the resolution semantics it's protecting, so this is
`lower(title)`, scoped per world.

## No soft deletes

`Entry` has no soft-delete column — `EntryService.deleteEntry` does a hard
`entryRepository.delete(entry)`. A deleted entry's title is immediately free
to reuse; there's nothing to special-case here. (If soft deletes are added
later, the functional index below would need a `WHERE deleted_at IS NULL`
predicate to keep matching that behavior.)

## Two layers of enforcement

1. **Service-layer pre-check** (`EntryService.requireUniqueTitle`, via
   `EntryRepository.existsByWorldIdAndTitleIgnoreCase[AndIdNot]`) — fast,
   gives a clean `IllegalStateException` → `409 Conflict` (same convention
   `RelationService.createRelation` already uses for its own duplicate
   check) before ever touching the write path.
2. **DB-level unique index** (below) — the actual race-proof guarantee.
   Two concurrent requests can both pass the pre-check before either
   commits; `EntryService.createEntry`/`updateEntry` call
   `saveAndFlush`/`flush()` specifically so that race surfaces inside the
   method as a `DataIntegrityViolationException`, caught and translated to
   the same `IllegalStateException` → 409, rather than as an unhandled
   exception after the request already looked like it succeeded.

Title whitespace is already trimmed before either check runs
(`EntryService` has always done `title.trim()` on create/update) — no
separate handling needed for that.

## Applying the DB constraint

`spring.jpa.hibernate.ddl-auto=update` only manages plain column/table DDL
generated from entity annotations — it does not know how to express a
*functional* unique index (`lower(title)`), so this can't be added as a
`@Table(uniqueConstraints = ...)` on `Entry` the way a case-sensitive
constraint could be. Per CLAUDE.md's Build & run note, there's no migration
tool wired up yet (Flyway is a "consider it once the schema stabilizes"
TODO), so this is applied by hand against each Postgres instance (local dev,
and again whenever a shared/prod DB exists) rather than auto-running on
`bootRun`. If Flyway gets adopted, this becomes `V1__entry_title_unique.sql`
verbatim.

**1. Find existing duplicates first** (read-only, safe to run anytime):

```sql
SELECT world_id, lower(title) AS title_lower,
       array_agg(id ORDER BY created_at) AS entry_ids,
       count(*) AS n
FROM entries
GROUP BY world_id, lower(title)
HAVING count(*) > 1;
```

**2. Resolve duplicates before adding the constraint.** Creating the index
against existing violations fails loudly (good — silently picking a winner
could destroy real content someone wrote). Two options, and which one's
right depends on whether the duplicates are actually *the same* entry
someone accidentally created twice, or two different things that happen to
share a title:

- **a) They're genuinely different entries — disambiguate instead of
  losing either one.** Oldest keeps its title, every later duplicate in the
  group gets a suffix:

  ```sql
  WITH ranked AS (
    SELECT id, title,
           row_number() OVER (PARTITION BY world_id, lower(title)
                               ORDER BY created_at) AS rn
    FROM entries
  )
  UPDATE entries e
  SET title = e.title || ' (' || ranked.rn || ')'
  FROM ranked
  WHERE e.id = ranked.id AND ranked.rn > 1;
  ```

  Run the query from step 1 again afterward to confirm zero rows.

- **b) They're actual duplicates of the same thing** — needs a human to
  pick the entry to keep, re-point any `Relation`s referencing the loser
  (`relations.source_entry_id`/`target_entry_id`) at the survivor, and
  `DELETE` the loser. No safe automatic merge exists (which one has the
  "real" content is a judgment call), so this isn't scripted here.

**3. Add the constraint:**

```sql
CREATE UNIQUE INDEX entries_world_id_title_lower_key
    ON entries (world_id, lower(title));
```

(Use `CREATE UNIQUE INDEX CONCURRENTLY` instead if this is ever run against
a table with live traffic on it — it can't run inside a transaction block
in that form, so run it as its own statement.)

After this, a unique violation on insert/update raises Postgres error
`23505`, which Spring Data wraps as `DataIntegrityViolationException` —
already caught by `EntryService` per the "Two layers of enforcement" section
above.
