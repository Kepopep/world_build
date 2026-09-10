package com.hisder.worldBuilding.entry;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface EntryRepository extends JpaRepository<Entry, Long> {

    List<Entry> findByWorldId(Long worldId);

    @Query("select e from Entry e where e.world.id = :worldId "
            + "and lower(e.title) like lower(concat('%', :query, '%')) "
            + "order by e.title asc")
    List<Entry> searchByTitle(@Param("worldId") Long worldId,
                               @Param("query") String query,
                               Pageable pageable);
}
