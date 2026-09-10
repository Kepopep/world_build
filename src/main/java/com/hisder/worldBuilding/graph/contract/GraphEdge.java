package com.hisder.worldBuilding.graph.contract;

import com.hisder.worldBuilding.relation.Relation;

/**
 * Directional -- always the relation's real source/target/label (name, not
 * reverseName). The frontend can show the reverse label on hover from the
 * other end; not the backend's concern.
 */
public record GraphEdge(Long sourceId, Long targetId, String label, Long relationDefinitionId) {

    public static GraphEdge from(Relation relation) {
        return new GraphEdge(
                relation.getSourceEntry().getId(),
                relation.getTargetEntry().getId(),
                relation.getRelationDefinition().getName(),
                relation.getRelationDefinition().getId()
        );
    }
}
