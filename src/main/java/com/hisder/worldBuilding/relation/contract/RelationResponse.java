package com.hisder.worldBuilding.relation.contract;


public record RelationResponse(

        Long id,

        Long targetId,

        String targetName,

        String targetType,

        String relationName,

        boolean isOutgoing
) {}
