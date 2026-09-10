package com.hisder.worldBuilding.folder;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface FolderRepository extends JpaRepository<Folder, Long> {

    List<Folder> findByWorldIdOrderBySortOrderAscNameAsc(Long worldId);

    // Used by FolderService.deleteFolder to reject deleting a non-empty
    // folder (one with subfolders) rather than silently cascading.
    boolean existsByParentFolderId(Long parentFolderId);
}
