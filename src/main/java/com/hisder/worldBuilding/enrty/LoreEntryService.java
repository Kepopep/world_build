package com.hisder.worldBuilding.enrty;

import com.hisder.worldBuilding.enrty.contract.LoreEntryCreateRequest;
import com.hisder.worldBuilding.enrty.contract.LoreEntryUpdateRequest;
import jakarta.persistence.EntityExistsException;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class LoreEntryService {

    private final LoreEntryRepository loreEntryRepository;

    public LoreEntryService(LoreEntryRepository loreEntryRepository) {
        this.loreEntryRepository = loreEntryRepository;
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

        loreEntryRepository.save(entry);
        return entry;
    }

    public void delete(Long id) throws EntityNotFoundException {
        if (!loreEntryRepository.existsById(id)) {
            throw new EntityNotFoundException("Entry: " + id + " not found");
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

        loreEntryRepository.save(existing);
        return existing;
    }

    private boolean fieldValid(String value) {
        return value != null && !value.isBlank();
    }
}
