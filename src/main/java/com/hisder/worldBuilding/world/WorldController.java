package com.hisder.worldBuilding.world;

import com.hisder.worldBuilding.world.contract.WorldCreateRequest;
import com.hisder.worldBuilding.world.contract.WorldResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/worlds")
public class WorldController {
    private final WorldService worldService;

    public WorldController(WorldService worldService) {
        this.worldService = worldService;
    }

    @GetMapping
    public ResponseEntity<List<WorldResponse>> getAll() {
        List<WorldResponse> worlds = worldService.getAll();
        return ResponseEntity
                .status(HttpStatus.OK)
                .body(worlds);
    }

    @GetMapping("/{id}")
    public ResponseEntity<WorldResponse> get(@PathVariable Long id) {
        WorldResponse world = worldService.get(id);
        return ResponseEntity
                .status(HttpStatus.OK)
                .body(world);
    }

    @PostMapping("/create")
    public ResponseEntity<World> create(@Valid @RequestBody WorldCreateRequest request) {
        World world = worldService.create(request);
        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(world);
    }
}
