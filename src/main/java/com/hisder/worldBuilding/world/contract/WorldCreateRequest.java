package com.hisder.worldBuilding.world.contract;

import jakarta.validation.constraints.NotBlank;

public record WorldCreateRequest(
        @NotBlank(message = "name cannot be blank")
        String name
) {}
