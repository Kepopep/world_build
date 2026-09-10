package com.hisder.worldBuilding.entry.contract;

import com.hisder.worldBuilding.entry.Entry;

import java.time.LocalDateTime;

public record EntryResponse(
        Long id,
        Long worldId,
        Long folderId,
        String icon,
        String title,
        String summary,
        String contentMarkdown,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {

    public static EntryResponse from(Entry entry) {
        return new EntryResponse(
                entry.getId(),
                entry.getWorld().getId(),
                entry.getFolderId(),
                entry.getIcon(),
                entry.getTitle(),
                entry.getSummary(),
                entry.getContentMarkdown(),
                entry.getCreatedAt(),
                entry.getUpdatedAt()
        );
    }
}
