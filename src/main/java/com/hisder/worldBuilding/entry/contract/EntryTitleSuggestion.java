package com.hisder.worldBuilding.entry.contract;

import com.hisder.worldBuilding.entry.Entry;

public record EntryTitleSuggestion(
        Long id,
        String title,
        String icon
) {

    public static EntryTitleSuggestion from(Entry entry) {
        return new EntryTitleSuggestion(
                entry.getId(),
                entry.getTitle(),
                entry.getIcon()
        );
    }
}
