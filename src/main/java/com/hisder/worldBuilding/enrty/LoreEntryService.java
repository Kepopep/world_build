package com.hisder.worldBuilding.enrty;

import com.hisder.worldBuilding.enrty.contract.LoreEntryCreateRequest;
import com.hisder.worldBuilding.enrty.contract.LoreEntryUpdateRequest;
import com.hisder.worldBuilding.world.WorldRepository;
import jakarta.persistence.EntityExistsException;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class LoreEntryService {

    private final LoreEntryRepository loreEntryRepository;
    private final WorldRepository worldRepository;

    public LoreEntryService(LoreEntryRepository loreEntryRepository, WorldRepository worldRepository) {
        this.loreEntryRepository = loreEntryRepository;
        this.worldRepository = worldRepository;
    }

    public LoreEntry get(Long id) throws EntityExistsException {
        if (!loreEntryRepository.existsById(id)) {
            throw new EntityNotFoundException("Entry with id " + id + " not found");
        }

        return loreEntryRepository.getReferenceById(id);
    }

    public List<LoreEntry> getAll() {
        return loreEntryRepository.findAll();
    }

    public LoreEntry create(LoreEntryCreateRequest request) throws EntityExistsException {
        if (loreEntryRepository.existsByName(request.name())) {
            throw new EntityExistsException("Entry: " + request.name() + " already exists");
        }

        LoreEntry entry = new LoreEntry();
        entry.setName(request.name());
        entry.setTitle(request.title());
        entry.setDescription(request.description());
        entry.setType(request.type());

        if (request.parentId() != null) {
            requireParentExists(request.parentId());
            entry.setParentId(request.parentId());
        }

        if (request.worldId() != null) {
            requireWorldExists(request.worldId());
            entry.setWorldId(request.worldId());
        }

        loreEntryRepository.save(entry);
        return entry;
    }

    public void delete(Long id) throws EntityNotFoundException {
        if (!loreEntryRepository.existsById(id)) {
            throw new EntityNotFoundException("Entry: " + id + " not found");
        }

        // Deleting a parent shouldn't cascade-delete its children — promote them to roots instead.
        List<LoreEntry> children = loreEntryRepository.findByParentId(id);
        if (!children.isEmpty()) {
            children.forEach(child -> child.setParentId(null));
            loreEntryRepository.saveAll(children);
        }

        loreEntryRepository.deleteById(id);
    }

    public LoreEntry update(Long id, LoreEntryUpdateRequest request) throws EntityNotFoundException {
        if (!loreEntryRepository.existsById(id)) {
            throw new EntityNotFoundException("Entry: " + id + " not found");
        }

        LoreEntry existing = loreEntryRepository.getReferenceById(id);

        if(fieldValid(request.name()))
            existing.setName(request.name());
        if(fieldValid(request.title()))
            existing.setTitle(request.title());
        if(fieldValid(request.description()))
            existing.setDescription(request.description());
        if(request.type() != null)
            existing.setType(request.type());
        if (request.parentId() != null) {
            requireValidParent(id, request.parentId());
            existing.setParentId(request.parentId());
        }
        if (request.worldId() != null) {
            requireWorldExists(request.worldId());
            existing.setWorldId(request.worldId());
        }

        loreEntryRepository.save(existing);
        return existing;
    }

    private boolean fieldValid(String value) {
        return value != null && !value.isBlank();
    }

    private void requireParentExists(Long parentId) throws EntityNotFoundException {
        if (!loreEntryRepository.existsById(parentId)) {
            throw new EntityNotFoundException("Entry: " + parentId + " not found");
        }
    }

    private void requireWorldExists(Long worldId) throws EntityNotFoundException {
        if (!worldRepository.existsById(worldId)) {
            throw new EntityNotFoundException("World: " + worldId + " not found");
        }
    }

    /**
     * Validates a parent assignment on an existing entry: the parent must exist, and the
     * new parent can't be the entry itself or one of its own descendants (which would
     * create a cycle in the containment tree).
     */
    private void requireValidParent(Long entryId, Long parentId) throws EntityNotFoundException {
        if (entryId.equals(parentId)) {
            throw new IllegalArgumentException("Entry " + entryId + " cannot be its own parent");
        }

        requireParentExists(parentId);

        Long ancestorId = parentId;
        while (ancestorId != null) {
            if (ancestorId.equals(entryId)) {
                throw new IllegalArgumentException(
                        "Entry " + parentId + " is a descendant of " + entryId + "; setting it as parent would create a cycle");
            }
            ancestorId = loreEntryRepository.getReferenceById(ancestorId).getParentId();
        }
    }
}
