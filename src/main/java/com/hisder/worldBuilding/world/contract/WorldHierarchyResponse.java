package com.hisder.worldBuilding.world.contract;

import com.hisder.worldBuilding.entry.contract.EntryResponse;
import com.hisder.worldBuilding.folder.contract.FolderResponse;

import java.util.List;

/**
 * GET /api/worlds/{worldId}/hierarchy -- both flat, not nested. The client
 * (js/sidebar.js) builds the folder tree from parentFolderId/folderId
 * itself; keeping the wire format flat avoids server-side recursive DTO
 * assembly for what's ultimately small, always-fetched-together data.
 */
public record WorldHierarchyResponse(
        List<FolderResponse> folders,
        List<EntryResponse> entries
) {
}
