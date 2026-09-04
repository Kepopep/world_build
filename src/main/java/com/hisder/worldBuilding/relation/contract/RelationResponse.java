package com.hisder.worldBuilding.relation.contract;


public record RelationResponse(

        Long targetId,

        String relationName,

        boolean isOutgoing
) {}
