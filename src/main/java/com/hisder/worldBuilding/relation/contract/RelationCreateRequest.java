package com.hisder.worldBuilding.relation.contract;

/**
 * POST /api/relations. sourceEntryId/targetEntryId/relationDefinitionId must
 * all resolve to real rows in the same World -- see
 * RelationService.createRelation's validation order.
 */
public record RelationCreateRequest(Long sourceEntryId, Long targetEntryId, Long relationDefinitionId) {
}
