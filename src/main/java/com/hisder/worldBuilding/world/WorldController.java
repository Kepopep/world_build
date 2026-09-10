package com.hisder.worldBuilding.world;

import com.hisder.worldBuilding.world.contract.WorldCreateRequest;
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

    public WorldController(WorldService worldService) {
        this.worldService = worldService;
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
}
