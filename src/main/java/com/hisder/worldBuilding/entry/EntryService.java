package com.hisder.worldBuilding.entry;

import com.hisder.worldBuilding.entry.contract.EntryUpdateRequest;
import com.hisder.worldBuilding.folder.Folder;
import com.hisder.worldBuilding.folder.FolderRepository;
import com.hisder.worldBuilding.world.World;
import com.hisder.worldBuilding.world.WorldRepository;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@Transactional
public class EntryService {

    private final EntryRepository entryRepository;
    private final WorldRepository worldRepository;
    private final FolderRepository folderRepository;

    public EntryService(EntryRepository entryRepository, WorldRepository worldRepository, FolderRepository folderRepository) {
        this.entryRepository = entryRepository;
        this.worldRepository = worldRepository;
        this.folderRepository = folderRepository;
    }

    @Transactional(readOnly = true)
    public List<Entry> listEntries(Long worldId) {
        World world = getWorldOrThrow(worldId);
        return entryRepository.findByWorldId(world.getId());
    }

    public Entry createEntry(Long worldId, String title, String contentMarkdown, Long folderId) {
        World world = getWorldOrThrow(worldId);
        validateTitle(title);
        String trimmedTitle = title.trim();
        requireUniqueTitle(world.getId(), trimmedTitle, null);
        Entry entry = new Entry(world, trimmedTitle, contentMarkdown);
        entry.setFolder(resolveFolder(world, folderId));
        // saveAndFlush (not save) so a race that slips past the pre-check above
        // -- two concurrent creates for the same title, both passing
        // requireUniqueTitle before either commits -- still surfaces here as a
        // DataIntegrityViolationException off the DB-level unique index
        // (docs/design/entry-title-uniqueness.md), not a raw 500 from Hibernate
        // flushing after this method has already returned 201.
        try {
            return entryRepository.saveAndFlush(entry);
        } catch (DataIntegrityViolationException e) {
            throw duplicateTitleException(trimmedTitle);
        }
    }

    @Transactional(readOnly = true)
    public Entry getEntry(Long id) {
        return getEntryOrThrow(id);
    }

    public Entry updateEntry(Long id, EntryUpdateRequest request) {
        Entry entry = getEntryOrThrow(id);
        boolean titleChanged = false;
        String trimmedTitle = null;
        if (request.title() != null) {
            validateTitle(request.title());
            trimmedTitle = request.title().trim();
            // Skip the check entirely for a no-op rename (same title, maybe a
            // different case) -- requireUniqueTitle would otherwise flag the
            // entry against its own current row.
            titleChanged = !trimmedTitle.equalsIgnoreCase(entry.getTitle());
            if (titleChanged) {
                requireUniqueTitle(entry.getWorld().getId(), trimmedTitle, entry.getId());
            }
            entry.setTitle(trimmedTitle);
        }
        if (request.summary() != null) {
            entry.setSummary(request.summary());
        }
        if (request.contentMarkdown() != null) {
            entry.setContentMarkdown(request.contentMarkdown());
        }
        if (request.folderId() != null) {
            entry.setFolder(resolveFolder(entry.getWorld(), request.folderId()));
        }
        if (titleChanged) {
            // entry is a managed entity here (no explicit save() call to hang a
            // try/catch off), so force the flush now to get the same race-safety
            // net createEntry gets from saveAndFlush -- otherwise a unique
            // violation would surface as an unhandled exception at end-of-
            // transaction commit, after this method has already returned.
            try {
                entryRepository.flush();
            } catch (DataIntegrityViolationException e) {
                throw duplicateTitleException(trimmedTitle);
            }
        }
        return entry;
    }

    // Unlike updateEntry's folderId handling (null = leave unchanged), this
    // always applies folderId as given, including null (move to root) -- see
    // EntryMoveRequest's doc comment. Used by the sidebar's drag-and-drop.
    public Entry moveEntry(Long id, Long folderId) {
        Entry entry = getEntryOrThrow(id);
        entry.setFolder(resolveFolder(entry.getWorld(), folderId));
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

    // Backs the general title/summary/content search endpoint -- distinct
    // from searchEntriesByTitle above, which only backs the narrower
    // wikilink typeahead. Same blank-query convention: return empty rather
    // than 400.
    @Transactional(readOnly = true)
    public List<Entry> searchEntries(Long worldId, String query, int limit) {
        if (query == null || query.isBlank()) {
            return List.of();
        }
        World world = getWorldOrThrow(worldId);
        return entryRepository.search(world.getId(), query.trim(), PageRequest.of(0, limit));
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

    // null folderId -> root level (no folder). A non-null id must resolve to
    // a real folder in the same world -- same cross-world guard pattern as
    // FolderService.resolveParent.
    private Folder resolveFolder(World world, Long folderId) {
        if (folderId == null) {
            return null;
        }
        Folder folder = folderRepository.findById(folderId)
                .orElseThrow(() -> new EntityNotFoundException("Folder not found: " + folderId));
        if (!folder.getWorld().getId().equals(world.getId())) {
            throw new IllegalArgumentException("Folder belongs to a different world");
        }
        return folder;
    }

    private void validateTitle(String title) {
        if (title == null || title.isBlank()) {
            throw new IllegalArgumentException("Entry title must not be blank");
        }
    }

    // Fast, friendly pre-check -- the DB-level unique index (see
    // docs/design/entry-title-uniqueness.md) is what actually guarantees no
    // duplicate slips through under a race; this just avoids paying for a
    // round trip to the DB's constraint machinery on the common path.
    // excludeId is null on create, or the entry's own id on update.
    private void requireUniqueTitle(Long worldId, String title, Long excludeId) {
        boolean duplicate = excludeId == null
                ? entryRepository.existsByWorldIdAndTitleIgnoreCase(worldId, title)
                : entryRepository.existsByWorldIdAndTitleIgnoreCaseAndIdNot(worldId, title, excludeId);
        if (duplicate) {
            throw duplicateTitleException(title);
        }
    }

    // IllegalStateException -> 409 Conflict via GlobalExceptionHandler,
    // same convention RelationService.createRelation already uses for its own
    // duplicate-relation check.
    private IllegalStateException duplicateTitleException(String title) {
        return new IllegalStateException("An entry titled \"" + title + "\" already exists in this world");
    }
}
