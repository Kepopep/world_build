package com.hisder.worldBuilding.relation.contract;

import com.hisder.worldBuilding.entry.Entry;
import com.hisder.worldBuilding.relation.Relation;

/**
 * A relation as seen from one entry's point of view -- {@code relatedEntry*}
 * is always "the other entry", and {@code label}/{@code outgoing} flip
 * depending on whether {@code perspectiveEntryId} is the relation's source
 * or target (see {@link #from(Relation, Long)}). Used both for
 * GET /api/entries/{id}/relations (perspective = the requested entry, either
 * direction) and POST /api/relations (perspective = the new relation's
 * source entry, always outgoing=true).
 */
public record RelationResponse(
        Long id,
        Long relationDefinitionId,
        Long relatedEntryId,
        String relatedEntryTitle,
        String relatedEntryIcon,
        String label,
        boolean outgoing
) {

    public static RelationResponse from(Relation relation, Long perspectiveEntryId) {
        boolean outgoing = relation.getSourceEntry().getId().equals(perspectiveEntryId);
        Entry related = outgoing ? relation.getTargetEntry() : relation.getSourceEntry();
        String label = outgoing
                ? relation.getRelationDefinition().getName()
                : relation.getRelationDefinition().getReverseName();
        return new RelationResponse(
                relation.getId(),
                relation.getRelationDefinition().getId(),
                related.getId(),
                related.getTitle(),
                related.getIcon(),
                label,
                outgoing
        );
    }
}
