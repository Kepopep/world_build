package com.hisder.worldBuilding.relation;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface EntryRelationRepository extends JpaRepository<EntryRelation, Long> {

    boolean existsBySourceIdAndTargetIdAndRelationDefinitionId(
            Long sourceId, Long targetId, Long relationDefinitionId);

    boolean existsBySourceIdAndTargetId(Long sourceId, Long targetId);

    List<EntryRelation> findBySourceId(Long sourceId);

    List<EntryRelation> findByTargetId(Long targetId);

    @Query("SELECT r FROM EntryRelation r WHERE r.source.id = :entryId OR r.target.id = :entryId")
    List<EntryRelation> findAllRelationsForEntry(@Param("entryId") Long entryId);

    @Query("SELECT r FROM EntryRelation r WHERE " +
           "(r.source.id = :sourceId AND r.target.id = :targetId) OR " +
           "(r.source.id = :targetId AND r.target.id = :sourceId)")
    List<EntryRelation> findRelationsBetween(@Param("sourceId") Long sourceId, 
                                             @Param("targetId") Long targetId);

    List<EntryRelation> findByRelationDefinitionId(Long relationDefinitionId);

    long countBySourceId(Long sourceId);

    long countByTargetId(Long targetId);

    @Query("SELECT COUNT(r) FROM EntryRelation r WHERE r.source.id = :entryId OR r.target.id = :entryId")
    long countAllRelationsForEntry(@Param("entryId") Long entryId);

    void deleteBySourceIdOrTargetId(Long sourceId, Long targetId);

    void deleteByRelationDefinitionId(Long relationDefinitionId);

    void deleteBySourceIdAndTargetId(Long sourceId, Long targetId);
}
