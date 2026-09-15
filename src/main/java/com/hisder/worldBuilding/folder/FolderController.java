package com.hisder.worldBuilding.folder;

import com.hisder.worldBuilding.folder.contract.FolderCreateRequest;
import com.hisder.worldBuilding.folder.contract.FolderMoveRequest;
import com.hisder.worldBuilding.folder.contract.FolderResponse;
import com.hisder.worldBuilding.folder.contract.FolderUpdateRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public class FolderController {

    private final FolderService folderService;

    public FolderController(FolderService folderService) {
        this.folderService = folderService;
    }

    @GetMapping("/api/worlds/{worldId}/folders")
    public List<FolderResponse> listFolders(@PathVariable Long worldId) {
        return folderService.listFolders(worldId).stream()
                .map(FolderResponse::from)
                .toList();
    }

    @PostMapping("/api/worlds/{worldId}/folders")
    @ResponseStatus(HttpStatus.CREATED)
    public FolderResponse createFolder(@PathVariable Long worldId, @RequestBody FolderCreateRequest request) {
        Folder folder = folderService.createFolder(worldId, request.name(), request.parentFolderId());
        return FolderResponse.from(folder);
    }

    @PatchMapping("/api/folders/{id}")
    public FolderResponse updateFolder(@PathVariable Long id, @RequestBody FolderUpdateRequest request) {
        return FolderResponse.from(folderService.updateFolder(id, request));
    }

    // Drag-and-drop reparenting goes through here rather than
    // PATCH /api/folders/{id} -- see FolderMoveRequest's doc comment.
    @PatchMapping("/api/folders/{id}/move")
    public FolderResponse moveFolder(@PathVariable Long id, @RequestBody FolderMoveRequest request) {
        return FolderResponse.from(folderService.moveFolder(id, request.parentFolderId()));
    }

    @DeleteMapping("/api/folders/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteFolder(@PathVariable Long id) {
        folderService.deleteFolder(id);
    }
}
