package com.hisder.worldBuilding.relation.definition.contract;

import jakarta.validation.constraints.NotBlank;

public record RelationDefinitionCreateRequest(
        @NotBlank(message = "name cannot be blank")
        String name,

        @NotBlank(message = "reverseName cannot be blank")
        String reverseName
) {}
