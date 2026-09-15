package com.hisder.worldBuilding.relation.definition;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RelationDefinitionRepository extends JpaRepository<RelationDefinition, Long> {

    List<RelationDefinition> findByWorldIdOrderByNameAsc(Long worldId);
}
