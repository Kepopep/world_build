package com.hisder.worldBuilding.entry;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface EntryRepository extends JpaRepository<Entry, Long> {

    List<Entry> findByWorldId(Long worldId);

    // Used by FolderService.deleteFolder to reject deleting a folder that
    // still has entries in it, rather than silently orphaning them.
    boolean existsByFolderId(Long folderId);

    // Backs EntryService's duplicate-title guard (see
    // docs/design/entry-title-uniqueness.md). IgnoreCase matches the same
    // case-insensitive resolution the wikilink autocomplete already assumes
    // (CLAUDE.md's "Map<lowercaseTitle, entryId>" note) -- two entries whose
    // titles differ only by case would otherwise collide in that map.
    boolean existsByWorldIdAndTitleIgnoreCase(Long worldId, String title);

    // Same check, excluding the entry being updated -- so renaming an entry
    // to a case-variant of its own current title isn't flagged against
    // itself.
    boolean existsByWorldIdAndTitleIgnoreCaseAndIdNot(Long worldId, String title, Long id);

    @Query("select e from Entry e where e.world.id = :worldId "
            + "and lower(e.title) like lower(concat('%', :query, '%')) "
            + "order by e.title asc")
    List<Entry> searchByTitle(@Param("worldId") Long worldId,
                               @Param("query") String query,
                               Pageable pageable);

    // Case-insensitive substring match across title/summary/content, backing
    // the general search checklist item (distinct from searchByTitle above,
    // which only backs the narrower wikilink typeahead). Title matches sort
    // first, then summary matches, then content-only matches, then
    // alphabetical by title -- simplest reasonable v1, not full-text search.
    // contentMarkdown is @Lob (maps to CLOB), and Hibernate 7's lower()
    // function validator rejects a CLOB argument directly -- cast it to
    // string first so lower()/like still work against the same column.
    @Query("select e from Entry e where e.world.id = :worldId and ("
            + "lower(e.title) like lower(concat('%', :query, '%')) "
            + "or lower(e.summary) like lower(concat('%', :query, '%')) "
            + "or lower(cast(e.contentMarkdown as string)) like lower(concat('%', :query, '%'))) "
            + "order by "
            + "case when lower(e.title) like lower(concat('%', :query, '%')) then 0 "
            + "     when lower(e.summary) like lower(concat('%', :query, '%')) then 1 "
            + "     else 2 end, "
            + "e.title asc")
    List<Entry> search(@Param("worldId") Long worldId,
                        @Param("query") String query,
                        Pageable pageable);
}
