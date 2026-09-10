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

    @Query("select e from Entry e where e.world.id = :worldId "
            + "and lower(e.title) like lower(concat('%', :query, '%')) "
            + "order by e.title asc")
    List<Entry> searchByTitle(@Param("worldId") Long worldId,
                               @Param("query") String query,
                               Pageable pageable);
}
