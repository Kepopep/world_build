package com.hisder.worldBuilding.entry.contract;

/**
 * Partial update payload for PATCH /api/entries/{id}. A null field means
 * "leave unchanged" — the client omits fields it doesn't want to touch.
 */
public record EntryUpdateRequest(String title, String contentMarkdown) {
}
