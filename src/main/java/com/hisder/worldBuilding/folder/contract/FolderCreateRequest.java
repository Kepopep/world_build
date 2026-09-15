package com.hisder.worldBuilding.folder.contract;

/**
 * POST /api/worlds/{worldId}/folders. {@code parentFolderId} is optional --
 * omitting it creates a top-level folder. The current sidebar UI only
 * creates top-level folders (see CLAUDE.md's Navigation section); nesting is
 * supported by the schema/API for future use.
 */
public record FolderCreateRequest(String name, Long parentFolderId) {
}
