package com.hisder.worldBuilding.entry;

import com.hisder.worldBuilding.entry.contract.EntryUpdateRequest;
import com.hisder.worldBuilding.world.World;
import com.hisder.worldBuilding.world.WorldRepository;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@Transactional
public class EntryService {

    private final EntryRepository entryRepository;
    private final WorldRepository worldRepository;

    public EntryService(EntryRepository entryRepository, WorldRepository worldRepository) {
        this.entryRepository = entryRepository;
        this.worldRepository = worldRepository;
    }

    @Transactional(readOnly = true)
    public List<Entry> listEntries(Long worldId) {
        World world = getWorldOrThrow(worldId);
        return entryRepository.findByWorldId(world.getId());
    }

    public Entry createEntry(Long worldId, String title, String contentMarkdown) {
        World world = getWorldOrThrow(worldId);
        validateTitle(title);
        return entryRepository.save(new Entry(world, title.trim(), contentMarkdown));
    }

    @Transactional(readOnly = true)
    public Entry getEntry(Long id) {
        return getEntryOrThrow(id);
    }

    public Entry updateEntry(Long id, EntryUpdateRequest request) {
        Entry entry = getEntryOrThrow(id);
        if (request.title() != null) {
            validateTitle(request.title());
            entry.setTitle(request.title().trim());
        }
        if (request.contentMarkdown() != null) {
            entry.setContentMarkdown(request.contentMarkdown());
        }
        return entry;
    }

    @Transactional(readOnly = true)
    public List<Entry> searchEntriesByTitle(Long worldId, String query, int limit) {
        if (query == null || query.isBlank()) {
            return List.of();
        }
        World world = getWorldOrThrow(worldId);
        return entryRepository.searchByTitle(world.getId(), query.trim(), PageRequest.of(0, limit));
    }

    public void deleteEntry(Long id) {
        Entry entry = getEntryOrThrow(id);
        entryRepository.delete(entry);
    }

    private World getWorldOrThrow(Long worldId) {
        return worldRepository.findById(worldId)
                .orElseThrow(() -> new EntityNotFoundException("World not found: " + worldId));
    }

    private Entry getEntryOrThrow(Long id) {
        return entryRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Entry not found: " + id));
    }

    private void validateTitle(String title) {
        if (title == null || title.isBlank()) {
            throw new IllegalArgumentException("Entry title must not be blank");
        }
    }
}
