package com.hisder.worldBuilding.enrty.contract;

import com.hisder.worldBuilding.enrty.EntryType;
import jakarta.validation.constraints.NotNull;

public record LoreEntryCreateRequest(
        @NotNull(message = "name cannot be null")
        String name,

        @NotNull(message = "title cannot be null")
        String title,

        String description,

        EntryType type,

        Long parentId,

        Long worldId
) {
        public LoreEntryCreateRequest {
                if (type == null) {
                        type = EntryType.EMPTY;
                }
        }
}
