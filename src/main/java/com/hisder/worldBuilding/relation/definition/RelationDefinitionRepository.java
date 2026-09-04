package com.hisder.worldBuilding.relation.definition;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;


@Repository
public interface RelationDefinitionRepository extends JpaRepository<RelationDefinition, Long> {

    Optional<RelationDefinition> findByName(String name);

    boolean existsByName(String name);
}
