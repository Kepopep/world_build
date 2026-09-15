package com.hisder.worldBuilding.tag;

import com.hisder.worldBuilding.entry.Entry;
import com.hisder.worldBuilding.entry.EntryRepository;
import com.hisder.worldBuilding.world.World;
import com.hisder.worldBuilding.world.WorldRepository;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@Transactional
public class TagService {

    // Small fixed palette new tags cycle through when no color is supplied,
    // so dynamically-created tags aren't all the same color by default; the
    // user can always override via updateTag afterwards.
    private static final String[] DEFAULT_PALETTE = {
            "#6c7cf0", "#e0677e", "#4fb286", "#d9a441",
            "#7e57c2", "#3fa7d6", "#e08a3c", "#4dbfae",
    };

    private final TagRepository tagRepository;
    private final WorldRepository worldRepository;
    private final EntryRepository entryRepository;

    public TagService(TagRepository tagRepository, WorldRepository worldRepository, EntryRepository entryRepository) {
        this.tagRepository = tagRepository;
        this.worldRepository = worldRepository;
        this.entryRepository = entryRepository;
    }

    @Transactional(readOnly = true)
    public List<Tag> listTags(Long worldId) {
        getWorldOrThrow(worldId);
        return tagRepository.findByWorldIdOrderByNameAsc(worldId);
    }

    public Tag updateTag(Long id, String name, String color) {
        Tag tag = getTagOrThrow(id);
        if (name != null) {
            if (name.isBlank()) {
                throw new IllegalArgumentException("Tag name must not be blank");
            }
            tag.setName(name.trim());
        }
        if (color != null) {
            if (color.isBlank()) {
                throw new IllegalArgumentException("Tag color must not be blank");
            }
            tag.setColor(color.trim());
        }
        return tag;
    }

    /**
     * Attaches a tag to an entry, creating it in the entry's world first if
     * no tag with that name (case-insensitive) exists there yet -- this is
     * the "dynamic" tag creation the add-tag UI relies on. A name match
     * reuses the existing tag as-is; {@code color} is only used the moment a
     * new tag is actually created (see {@link #resolveColor}).
     */
    public Entry addTagToEntry(Long entryId, String name, String color) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Tag name must not be blank");
        }
        Entry entry = getEntryOrThrow(entryId);
        String trimmedName = name.trim();
        Long worldId = entry.getWorld().getId();
        Tag tag = tagRepository.findByWorldIdAndNameIgnoreCase(worldId, trimmedName)
                .orElseGet(() -> tagRepository.save(new Tag(entry.getWorld(), trimmedName, resolveColor(color, worldId))));
        entry.getTags().add(tag);
        return entry;
    }

    public Entry removeTagFromEntry(Long entryId, Long tagId) {
        Entry entry = getEntryOrThrow(entryId);
        entry.getTags().removeIf(t -> t.getId().equals(tagId));
        return entry;
    }

    private String resolveColor(String requested, Long worldId) {
        if (requested != null && !requested.isBlank()) {
            return requested.trim();
        }
        int existingCount = tagRepository.findByWorldIdOrderByNameAsc(worldId).size();
        return DEFAULT_PALETTE[existingCount % DEFAULT_PALETTE.length];
    }

    private World getWorldOrThrow(Long worldId) {
        return worldRepository.findById(worldId)
                .orElseThrow(() -> new EntityNotFoundException("World not found: " + worldId));
    }

    private Entry getEntryOrThrow(Long id) {
        return entryRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Entry not found: " + id));
    }

    private Tag getTagOrThrow(Long id) {
        return tagRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Tag not found: " + id));
    }
}
