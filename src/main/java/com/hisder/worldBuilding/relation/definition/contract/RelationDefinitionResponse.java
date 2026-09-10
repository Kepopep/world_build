package com.hisder.worldBuilding.relation.definition.contract;

import com.hisder.worldBuilding.relation.definition.RelationDefinition;

public record RelationDefinitionResponse(
        Long id,
        Long worldId,
        String name,
        String reverseName
) {

    public static RelationDefinitionResponse from(RelationDefinition relationDefinition) {
        return new RelationDefinitionResponse(
                relationDefinition.getId(),
                relationDefinition.getWorld().getId(),
                relationDefinition.getName(),
                relationDefinition.getReverseName()
        );
    }
}
