package com.hisder.worldBuilding.world;

import com.hisder.worldBuilding.entry.EntryService;
import com.hisder.worldBuilding.entry.contract.EntryResponse;
import com.hisder.worldBuilding.folder.FolderService;
import com.hisder.worldBuilding.folder.contract.FolderResponse;
import com.hisder.worldBuilding.world.contract.WorldCreateRequest;
import com.hisder.worldBuilding.world.contract.WorldHierarchyResponse;
import com.hisder.worldBuilding.world.contract.WorldResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/worlds")
public class WorldController {

    private final WorldService worldService;
    private final FolderService folderService;
    private final EntryService entryService;

    public WorldController(WorldService worldService, FolderService folderService, EntryService entryService) {
        this.worldService = worldService;
        this.folderService = folderService;
        this.entryService = entryService;
    }

    @GetMapping
    public List<WorldResponse> listWorlds() {
        return worldService.listWorlds().stream()
                .map(WorldResponse::from)
                .toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public WorldResponse createWorld(@RequestBody WorldCreateRequest request) {
        World world = worldService.createWorld(request.name());
        return WorldResponse.from(world);
    }

    @GetMapping("/{id}")
    public WorldResponse getWorld(@PathVariable Long id) {
        return WorldResponse.from(worldService.getWorld(id));
    }

    // Flat folders + flat entries in one call -- the sidebar tree needs both
    // together on every world switch, so this avoids two round trips. See
    // WorldHierarchyResponse's doc comment for why the shape stays flat.
    @GetMapping("/{worldId}/hierarchy")
    public WorldHierarchyResponse getHierarchy(@PathVariable Long worldId) {
        List<FolderResponse> folders = folderService.listFolders(worldId).stream()
                .map(FolderResponse::from)
                .toList();
        List<EntryResponse> entries = entryService.listEntries(worldId).stream()
                .map(EntryResponse::from)
                .toList();
        return new WorldHierarchyResponse(folders, entries);
    }
}
