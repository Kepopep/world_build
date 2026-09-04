package com.hisder.worldBuilding.enrty.contract;

import jakarta.validation.constraints.NotNull;

public record LoreEntryCreateRequest(
        @NotNull(message = "name cannot be null")
        String name,

        @NotNull(message = "title cannot be null")
        String title,

        String description
) {}
