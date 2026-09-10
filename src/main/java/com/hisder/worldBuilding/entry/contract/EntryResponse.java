package com.hisder.worldBuilding.entry.contract;

import com.hisder.worldBuilding.entry.Entry;
import com.hisder.worldBuilding.tag.contract.TagResponse;

import java.time.LocalDateTime;
import java.util.List;

public record EntryResponse(
        Long id,
        Long worldId,
        Long folderId,
        String icon,
        String title,
        String summary,
        String contentMarkdown,
        List<TagResponse> tags,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {

    public static EntryResponse from(Entry entry) {
        return new EntryResponse(
                entry.getId(),
                entry.getWorld().getId(),
                entry.getFolder() != null ? entry.getFolder().getId() : null,
                entry.getIcon(),
                entry.getTitle(),
                entry.getSummary(),
                entry.getContentMarkdown(),
                entry.getTags().stream()
                        .map(TagResponse::from)
                        .sorted((a, b) -> a.name().compareToIgnoreCase(b.name()))
                        .toList(),
                entry.getCreatedAt(),
                entry.getUpdatedAt()
        );
    }
}
