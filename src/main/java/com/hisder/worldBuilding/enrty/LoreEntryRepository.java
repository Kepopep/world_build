package com.hisder.worldBuilding.enrty;

import org.springframework.data.jpa.repository.JpaRepository;

public interface LoreEntryRepository extends JpaRepository<LoreEntry, Long>{
    boolean existsByName(String name);
}
