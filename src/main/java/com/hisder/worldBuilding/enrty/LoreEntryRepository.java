package com.hisder.worldBuilding.enrty;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface LoreEntryRepository extends JpaRepository<LoreEntry, Long>{
    boolean existsByName(String name);

    List<LoreEntry> findByParentId(Long parentId);

    List<LoreEntry> findByWorldIdAndParentIdIsNull(Long worldId);
}
