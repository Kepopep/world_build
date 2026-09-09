package com.hisder.worldBuilding.enrty.contract;

import com.hisder.worldBuilding.enrty.EntryType;

public record LoreEntryUpdateRequest (
        String name,
        String title,
        String description,
        EntryType type,
        Long parentId,
        Long worldId
) {}
