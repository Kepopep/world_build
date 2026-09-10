package com.hisder.worldBuilding.relation;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RelationRepository extends JpaRepository<Relation, Long> {

    boolean existsBySourceEntryIdAndTargetEntryIdAndRelationDefinitionId(
            Long sourceEntryId, Long targetEntryId, Long relationDefinitionId);

    List<Relation> findBySourceEntryIdOrTargetEntryId(Long sourceEntryId, Long targetEntryId);

    // Used by GraphService.worldGraph -- every relation whose source and
    // target both belong to worldId (a relation has no worldId column of its
    // own, see Relation's doc comment).
    List<Relation> findBySourceEntryWorldIdAndTargetEntryWorldId(Long sourceWorldId, Long targetWorldId);
}
