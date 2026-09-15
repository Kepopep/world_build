package com.hisder.worldBuilding.relation.definition.contract;

/**
 * POST /api/worlds/{worldId}/relation-definitions. Both {@code name} and
 * {@code reverseName} are required non-blank -- see RelationDefinition's doc
 * comment for what each side means.
 */
public record RelationDefinitionCreateRequest(String name, String reverseName) {
}
