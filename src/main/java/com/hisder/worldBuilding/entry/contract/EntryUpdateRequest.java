package com.hisder.worldBuilding.entry.contract;

/**
 * Partial update payload for PATCH /api/entries/{id}. A null field means
 * "leave unchanged" — the client omits fields it doesn't want to touch.
 * Same limitation as FolderUpdateRequest: moving an entry back to the root
 * (folderId -> null) isn't expressible through this contract yet. Not
 * currently exercised by any UI (no move-entry-between-folders flow exists).
 */
public record EntryUpdateRequest(String title, String contentMarkdown, Long folderId) {
}
