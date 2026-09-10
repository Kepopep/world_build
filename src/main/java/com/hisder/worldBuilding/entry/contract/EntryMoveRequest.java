package com.hisder.worldBuilding.entry.contract;

/**
 * PATCH /api/entries/{id}/move. Unlike EntryUpdateRequest's folderId (where
 * null means "leave unchanged"), folderId here is always applied as given --
 * including null, which moves the entry to the world's root. A dedicated
 * endpoint/contract rather than overloading EntryUpdateRequest, specifically
 * so "move to root" is expressible (drag-and-drop needs it; the general
 * partial-update contract's null-means-unchanged convention can't say it).
 */
public record EntryMoveRequest(Long folderId) {
}
