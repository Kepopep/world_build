package com.hisder.worldBuilding.world;

import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@Transactional
public class WorldService {

    private final WorldRepository worldRepository;

    public WorldService(WorldRepository worldRepository) {
        this.worldRepository = worldRepository;
    }

    @Transactional(readOnly = true)
    public List<World> listWorlds() {
        return worldRepository.findAll();
    }

    public World createWorld(String name) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("World name must not be blank");
        }
        return worldRepository.save(new World(name.trim(), null));
    }

    @Transactional(readOnly = true)
    public World getWorld(Long id) {
        return worldRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("World not found: " + id));
    }
}
