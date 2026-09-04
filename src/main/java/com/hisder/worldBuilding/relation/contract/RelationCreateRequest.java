package com.hisder.worldBuilding.relation.contract;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

public record RelationCreateRequest(
        @NotNull(message = "sourceId cannot be null")
        @Positive(message = "sourceId must be positive")
        Long sourceId,

        @NotNull(message = "targetId cannot be null")
        @Positive(message = "targetId must be positive")
        Long targetId,

        @NotNull(message = "relationDefinitionId cannot be null")
        @Positive(message = "relationDefinitionId must be positive")
        Long relationDefinitionId
) {}
