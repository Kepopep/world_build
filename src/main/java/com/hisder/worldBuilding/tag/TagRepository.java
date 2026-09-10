package com.hisder.worldBuilding.tag;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface TagRepository extends JpaRepository<Tag, Long> {

    List<Tag> findByWorldIdOrderByNameAsc(Long worldId);

    Optional<Tag> findByWorldIdAndNameIgnoreCase(Long worldId, String name);
}
