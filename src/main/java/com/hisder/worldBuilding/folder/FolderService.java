package com.hisder.worldBuilding.folder;

import com.hisder.worldBuilding.entry.EntryRepository;
import com.hisder.worldBuilding.folder.contract.FolderUpdateRequest;
import com.hisder.worldBuilding.world.World;
import com.hisder.worldBuilding.world.WorldRepository;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@Transactional
public class FolderService {

    private final FolderRepository folderRepository;
    private final WorldRepository worldRepository;
    private final EntryRepository entryRepository;

    public FolderService(FolderRepository folderRepository, WorldRepository worldRepository, EntryRepository entryRepository) {
        this.folderRepository = folderRepository;
        this.worldRepository = worldRepository;
        this.entryRepository = entryRepository;
    }

    @Transactional(readOnly = true)
    public List<Folder> listFolders(Long worldId) {
        getWorldOrThrow(worldId);
        return folderRepository.findByWorldIdOrderBySortOrderAscNameAsc(worldId);
    }

    public Folder createFolder(Long worldId, String name, Long parentFolderId) {
        World world = getWorldOrThrow(worldId);
        validateName(name);
        Folder parent = resolveParent(world, parentFolderId);
        // Appended to the end of the (world-scoped, or eventually
        // parent-scoped) list -- good enough default ordering until a
        // drag-to-reorder UI exists to set sortOrder deliberately.
        int sortOrder = folderRepository.findByWorldIdOrderBySortOrderAscNameAsc(worldId).size();
        return folderRepository.save(new Folder(world, parent, name.trim(), sortOrder));
    }

    public Folder updateFolder(Long id, FolderUpdateRequest request) {
        Folder folder = getFolderOrThrow(id);
        if (request.name() != null) {
            validateName(request.name());
            folder.setName(request.name().trim());
        }
        if (request.parentFolderId() != null) {
            folder.setParentFolder(resolveParent(folder.getWorld(), request.parentFolderId()));
        }
        if (request.sortOrder() != null) {
            folder.setSortOrder(request.sortOrder());
        }
        return folder;
    }

    /**
     * Reparents a folder -- unlike updateFolder's parentFolderId (null =
     * leave unchanged), this always applies parentFolderId as given,
     * including null (move to root). Used by the sidebar's drag-and-drop,
     * same reasoning as EntryService.moveEntry/EntryMoveRequest. Rejects a
     * move that would create a cycle (a folder becoming its own descendant's
     * child, including dropping it directly onto itself).
     */
    public Folder moveFolder(Long id, Long parentFolderId) {
        Folder folder = getFolderOrThrow(id);
        if (parentFolderId != null && wouldCreateCycle(id, parentFolderId)) {
            throw new IllegalArgumentException("Cannot move a folder into itself or one of its own subfolders");
        }
        folder.setParentFolder(resolveParent(folder.getWorld(), parentFolderId));
        return folder;
    }

    // True if making `newParentId` the parent of `folderId` would create a
    // cycle -- either newParentId IS folderId (self-parent), or newParentId
    // is somewhere in folderId's own subtree. Checked by walking UP from
    // newParentId's own parent chain looking for folderId; hitting it means
    // newParentId is a descendant of folderId (or folderId itself).
    private boolean wouldCreateCycle(Long folderId, Long newParentId) {
        Long current = newParentId;
        int guard = 0;
        while (current != null && guard++ < 200) {
            if (current.equals(folderId)) {
                return true;
            }
            Folder f = folderRepository.findById(current).orElse(null);
            current = (f != null && f.getParentFolder() != null) ? f.getParentFolder().getId() : null;
        }
        return false;
    }

    /**
     * Deletes an empty folder. Rejects (409, via IllegalStateException) a
     * folder that still has subfolders or entries in it, rather than
     * silently cascading or orphaning them -- the UI doesn't offer a "move
     * everything out first" flow yet, so a hard reject is the safe default.
     */
    public void deleteFolder(Long id) {
        Folder folder = getFolderOrThrow(id);
        if (folderRepository.existsByParentFolderId(id)) {
            throw new IllegalStateException("Folder still has subfolders inside it -- move or delete them first.");
        }
        if (entryRepository.existsByFolderId(id)) {
            throw new IllegalStateException("Folder still has entries inside it -- move or delete them first.");
        }
        folderRepository.delete(folder);
    }

    private Folder resolveParent(World world, Long parentFolderId) {
        if (parentFolderId == null) {
            return null;
        }
        Folder parent = getFolderOrThrow(parentFolderId);
        if (!parent.getWorld().getId().equals(world.getId())) {
            throw new IllegalArgumentException("Parent folder belongs to a different world");
        }
        return parent;
    }

    private World getWorldOrThrow(Long worldId) {
        return worldRepository.findById(worldId)
                .orElseThrow(() -> new EntityNotFoundException("World not found: " + worldId));
    }

    private Folder getFolderOrThrow(Long id) {
        return folderRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Folder not found: " + id));
    }

    private void validateName(String name) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Folder name must not be blank");
        }
    }
}
