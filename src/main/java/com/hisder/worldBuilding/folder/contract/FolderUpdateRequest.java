package com.hisder.worldBuilding.folder.contract;

/**
 * Partial update payload for PATCH /api/folders/{id}. A null field means
 * "leave unchanged" (same convention as EntryUpdateRequest) -- note this
 * means moving a folder back to the root (parentFolderId -> null) isn't
 * expressible through this contract yet. Not currently exercised by any UI
 * (the sidebar only creates/deletes folders for now); revisit if a
 * rename/move UI gets built.
 */
public record FolderUpdateRequest(String name, Long parentFolderId, Integer sortOrder) {
}
