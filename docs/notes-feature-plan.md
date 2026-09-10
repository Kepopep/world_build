# TODO — Notes feature (`note/` package)

Implementation plan for `docs/entry-view-api.md` § 4.3 (Заметки) and **item 4**
of that document's "Summary of backend changes needed" list:

> **New `Note` entity** + CRUD endpoints under `/api/entry/{id}/notes`.

Follows the existing feature-package convention (`enrty/`, `relation/`,
`world/`): a new top-level `note/` package with `Note` → `NoteRepository` →
`NoteService` → `NoteController`, plus `note/contract/` for request/response
DTOs. Modeled closely on `relation/` (`EntryRelation` also hangs off a
`LoreEntry` via a `@ManyToOne` + `OnDelete(CASCADE)`, which is the right shape
here too — notes should disappear when their entry is deleted, unlike child
entries, which `LoreEntryService.delete` promotes to roots instead).

- [ ] **1. `Note` entity** (`note/Note.java`)
  - [ ] `id` — `Long`, `@GeneratedValue(SEQUENCE)` with its own sequence
        (`note_seq` / `note_id_seq`), matching `LoreEntry`/`EntryRelation`.
  - [ ] `entry` — `@ManyToOne(fetch = LAZY)` to `LoreEntry`,
        `@JoinColumn(name = "entry_id", nullable = false)`,
        `@OnDelete(action = OnDeleteAction.CASCADE)` (same pattern as
        `EntryRelation.source`/`target`) so deleting a `LoreEntry` cleans up
        its notes at the DB level without touching `LoreEntryService`.
  - [ ] `author` — `String`. No auth model yet (per `CLAUDE.md`), so this is
        just a plain string column, not a user reference.
  - [ ] `createdAt` — `Instant`, set once at creation (`@PrePersist` or set
        explicitly in `NoteService.addNote`); never updated.
  - [ ] `text` — `String`; use `@Column(columnDefinition = "TEXT")` since
        notes can be longer than a default `varchar(255)`.
  - [ ] `@Data @NoArgsConstructor @AllArgsConstructor @Entity`, same Lombok
        shape as the other entities in this codebase.

- [ ] **2. `NoteRepository`** (`note/NoteRepository.java`)
  - [ ] `extends JpaRepository<Note, Long>`
  - [ ] `List<Note> findByEntryIdOrderByCreatedAtDesc(Long entryId)` — Spring
        Data resolves the nested `entry.id` path the same way
        `EntryRelationRepository.findBySourceId` does; newest-first matches
        the mock (`entry.notes.unshift(...)` in `entry-view.js`).
  - [ ] `boolean existsByIdAndEntryId(Long noteId, Long entryId)` — used by
        the service to make sure a delete is scoped to the right entry (a
        note id that exists but belongs to a different entry should 404, not
        silently delete).

- [ ] **3. Contracts** (`note/contract/`)
  - [ ] `NoteResponse` record: `{ Long id, String author, Instant createdAt,
        String text }` — matches the shape already specified in
        `docs/entry-view-api.md` § 4.3.
  - [ ] `NoteCreateRequest` record: `{ @NotBlank String text }` (Bean
        Validation, same as `RelationCreateRequest`'s `@NotNull @Positive`).

- [ ] **4. `NoteService`** (`note/NoteService.java`)
  - [ ] Constructor-inject `NoteRepository` + `LoreEntryRepository` (to
        validate the entry exists — same pattern as `RelationService`).
  - [ ] `List<NoteResponse> getNotes(Long entryId)`
    - [ ] `EntityNotFoundException` if the entry doesn't exist (mirrors
          `RelationService.getRelations`'s `loreEntryRepository.existsById`
          check).
    - [ ] Map `Note` → `NoteResponse` (fixed field order: newest first).
  - [ ] `NoteResponse addNote(Long entryId, NoteCreateRequest request)`
    - [ ] Reject blank text with `IllegalArgumentException` (belt-and-braces
          alongside `@NotBlank` — matches `RelationService.createNewDefinition`'s
          manual blank checks).
    - [ ] Load the `LoreEntry` via `loreEntryRepository.findById(entryId)
          .orElseThrow(() -> new EntityNotFoundException(...))`.
    - [ ] Build `Note` with `author` defaulted to a fixed placeholder
          constant (e.g. `private static final String DEFAULT_AUTHOR =
          "Вы";`) — per § 4.3, real authorship is out of scope until auth
          exists.
    - [ ] `createdAt = Instant.now()`, save, return mapped `NoteResponse`.
  - [ ] `void deleteNote(Long entryId, Long noteId)`
    - [ ] `EntityNotFoundException` if `!noteRepository.existsByIdAndEntryId(noteId, entryId)`.
    - [ ] `noteRepository.deleteById(noteId)`.

- [ ] **5. `NoteController`** (`note/NoteController.java`)
  - [ ] `@RequestMapping("/api/entry/{entryId}/notes")` — nested under the
        existing entry path, matching the doc's proposed routes exactly.
  - [ ] `GET  ""` → `ResponseEntity.ok(noteService.getNotes(entryId))`
  - [ ] `POST ""` → `@Valid @RequestBody NoteCreateRequest` →
        `ResponseEntity.status(CREATED).body(noteService.addNote(entryId, request))`
  - [ ] `DELETE "/{noteId}"` → `noteService.deleteNote(entryId, noteId)` →
        `ResponseEntity.noContent().build()`
  - [ ] No new exception handling needed — `EntityNotFoundException` /
        `IllegalArgumentException` are already mapped by
        `GlobalExceptionHandler`.

- [ ] **6. Wire up the frontend** (`entry-view.js`)
  - [ ] Replace the mock `entry.notes` array reads in `renderNotes(entry)`
        with `fetch('/api/entry/' + currentEntryId + '/notes')` (adapt
        `note.date` display to format the ISO `createdAt` from the response —
        the mock currently stores a pre-formatted `date` string).
  - [ ] Replace the local-only `noteForm` submit handler (around line 659,
        currently pushes into `entry.notes` and shows
        "заглушка"/"только локально" toasts) with a `POST` to the same
        endpoint, then re-render from the response instead of mutating the
        mock object.
  - [ ] Drop the now-unneeded local `notes` arrays from the mock `ENTRIES`
        object once the fetch path is confirmed working (or leave as
        fallback data — matches how other sections in this doc suggest
        incremental wiring).

- [ ] **7. Manual verification**
  - [ ] `./gradlew build` compiles (new sequence — confirm
        `spring.jpa.hibernate.ddl-auto=update` creates the `note` table +
        `note_id_seq` on next `bootRun` against the local Postgres instance).
  - [ ] `POST /api/entry/{id}/notes` with a valid/invalid `entryId` and
        blank/non-blank `text`.
  - [ ] `GET /api/entry/{id}/notes` returns newest-first.
  - [ ] `DELETE /api/entry/{id}/notes/{noteId}` for a note belonging to a
        different entry returns 404, not 204.
  - [ ] Deleting the parent `LoreEntry` (`DELETE /api/entry/{id}`) also
        removes its notes (verifies the `OnDelete(CASCADE)` FK).
  - [ ] Confirm `/openapi` picks up the three new routes.

## Out of scope (per `docs/entry-view-api.md`)

- Real authorship (`author` field) — waits on the "no auth/user model yet"
  gap noted in `CLAUDE.md`; `DEFAULT_AUTHOR` is a placeholder, not a design
  decision to revisit here.
- Editing an existing note — the mockup and API doc only specify
  create/list/delete.
