package com.hisder.worldBuilding.search.contract;

import com.hisder.worldBuilding.entry.Entry;

public record SearchResultResponse(
        Long id,
        String title,
        String summary,
        String icon,
        Long folderId
) {

    public static SearchResultResponse from(Entry entry) {
        return new SearchResultResponse(
                entry.getId(),
                entry.getTitle(),
                entry.getSummary(),
                entry.getIcon(),
                entry.getFolder() != null ? entry.getFolder().getId() : null
        );
    }
}
