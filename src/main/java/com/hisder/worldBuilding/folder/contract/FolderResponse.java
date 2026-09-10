package com.hisder.worldBuilding.folder.contract;

import com.hisder.worldBuilding.folder.Folder;

public record FolderResponse(
        Long id,
        Long worldId,
        Long parentFolderId,
        String name,
        Integer sortOrder
) {

    public static FolderResponse from(Folder folder) {
        return new FolderResponse(
                folder.getId(),
                folder.getWorld().getId(),
                folder.getParentFolder() != null ? folder.getParentFolder().getId() : null,
                folder.getName(),
                folder.getSortOrder()
        );
    }
}
