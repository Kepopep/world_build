package com.hisder.worldBuilding.folder.contract;

/**
 * PATCH /api/folders/{id}/move. Unlike FolderUpdateRequest's
 * parentFolderId (where null means "leave unchanged"), parentFolderId here
 * is always applied as given -- including null, which moves the folder to
 * the world's root. Same reasoning as EntryMoveRequest.
 */
public record FolderMoveRequest(Long parentFolderId) {
}
