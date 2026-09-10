package com.hisder.worldBuilding.world;

import com.hisder.worldBuilding.enrty.LoreEntry;
import com.hisder.worldBuilding.enrty.LoreEntryRepository;
import com.hisder.worldBuilding.world.contract.WorldCreateRequest;
import com.hisder.worldBuilding.world.contract.WorldResponse;
import jakarta.persistence.EntityExistsException;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class WorldService {

    private final WorldRepository worldRepository;
    private final LoreEntryRepository loreEntryRepository;

    public WorldService(WorldRepository worldRepository, LoreEntryRepository loreEntryRepository) {
        this.worldRepository = worldRepository;
        this.loreEntryRepository = loreEntryRepository;
    }

    public List<WorldResponse> getAll() {
        return worldRepository.findAll().stream()
                .map(this::toResponse)
                .toList();
    }

    public WorldResponse get(Long id) throws EntityNotFoundException {
        return toResponse(requireWorld(id));
    }

    public World create(WorldCreateRequest request) throws EntityExistsException {
        if (worldRepository.existsByName(request.name())) {
            throw new EntityExistsException("World: " + request.name() + " already exists");
        }

        World world = new World();
        world.setName(request.name());
        return worldRepository.save(world);
    }

    private World requireWorld(Long id) throws EntityNotFoundException {
        return worldRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("World: " + id + " not found"));
    }

    private WorldResponse toResponse(World world) {
        Long rootEntryId = loreEntryRepository.findByWorldIdAndParentIdIsNull(world.getId())
                .stream()
                .findFirst()
                .map(LoreEntry::getId)
                .orElse(null);

        return new WorldResponse(world.getId(), world.getName(), rootEntryId);
    }
}
