package com.hisder.worldBuilding.entry.contract;

/**
 * {@code folderId} is optional -- omitting it (or passing null) creates the
 * entry at the world's root level.
 */
public record EntryCreateRequest(String title, String contentMarkdown, Long folderId) {
}
