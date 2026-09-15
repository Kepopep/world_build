package com.hisder.worldBuilding.relation;

import com.hisder.worldBuilding.entry.Entry;
import com.hisder.worldBuilding.entry.EntryRepository;
import com.hisder.worldBuilding.relation.contract.RelationResponse;
import com.hisder.worldBuilding.relation.definition.RelationDefinition;
import com.hisder.worldBuilding.relation.definition.RelationDefinitionRepository;
import com.hisder.worldBuilding.world.World;
import com.hisder.worldBuilding.world.WorldRepository;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Owns both RelationDefinition and Relation logic -- they're always used
 * together (creating a Relation needs to resolve a RelationDefinition), so
 * this stays one service even though RelationDefinitionController and
 * RelationController are split (different resource roots).
 */
@Service
@Transactional
public class RelationService {

    private final RelationRepository relationRepository;
    private final RelationDefinitionRepository relationDefinitionRepository;
    private final EntryRepository entryRepository;
    private final WorldRepository worldRepository;

    public RelationService(RelationRepository relationRepository,
                            RelationDefinitionRepository relationDefinitionRepository,
                            EntryRepository entryRepository,
                            WorldRepository worldRepository) {
        this.relationRepository = relationRepository;
        this.relationDefinitionRepository = relationDefinitionRepository;
        this.entryRepository = entryRepository;
        this.worldRepository = worldRepository;
    }

    @Transactional(readOnly = true)
    public List<RelationDefinition> listRelationDefinitions(Long worldId) {
        getWorldOrThrow(worldId);
        return relationDefinitionRepository.findByWorldIdOrderByNameAsc(worldId);
    }

    public RelationDefinition createRelationDefinition(Long worldId, String name, String reverseName) {
        World world = getWorldOrThrow(worldId);
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Relation definition name must not be blank");
        }
        if (reverseName == null || reverseName.isBlank()) {
            throw new IllegalArgumentException("Relation definition reverseName must not be blank");
        }
        return relationDefinitionRepository.save(new RelationDefinition(world, name.trim(), reverseName.trim()));
    }

    /**
     * Every relation touching this entry, from the entry's own point of
     * view -- outgoing (entry is the source, label = definition.name) and
     * incoming (entry is the target, label = definition.reverseName)
     * combined into one list, ordered by relatedEntryTitle.
     *
     * <p>Deliberately maps straight to {@link RelationResponse} here, inside
     * the transaction, rather than returning bare {@link Relation} entities
     * for the controller to map: {@code sourceEntry}/{@code targetEntry} are
     * lazy proxies, and relying on some other operation (e.g. the sort
     * comparator) to have incidentally touched the right one first is
     * fragile -- {@code Stream.sorted()} skips calling the comparator
     * entirely for a 0/1-element stream, so a single-relation entry would
     * leave its related entry's proxy uninitialized. Touching it past the
     * transaction boundary then fails specifically for the
     * {@code contentMarkdown} column ({@code @Lob}/CLOB lazy access needs a
     * real non-autocommit transaction; open-in-view reopens one in
     * autocommit mode). Building the response here guarantees every field is
     * read while the transaction is still open.
     */
    @Transactional(readOnly = true)
    public List<RelationResponse> listRelationsForEntry(Long entryId) {
        Entry entry = getEntryOrThrow(entryId);
        return relationRepository.findBySourceEntryIdOrTargetEntryId(entry.getId(), entry.getId()).stream()
                .map(relation -> RelationResponse.from(relation, entry.getId()))
                .sorted((a, b) -> a.relatedEntryTitle().compareToIgnoreCase(b.relatedEntryTitle()))
                .toList();
    }

    /**
     * Validation order: cheap self-relation check first, then resolve all
     * three ids (404 if any missing), then cross-world guard, then
     * duplicate-in-either-direction check scoped to this relationDefinitionId
     * (two entries can have relations of different types).
     */
    public RelationResponse createRelation(Long sourceEntryId, Long targetEntryId, Long relationDefinitionId) {
        if (sourceEntryId != null && sourceEntryId.equals(targetEntryId)) {
            throw new IllegalArgumentException("Cannot relate an entry to itself");
        }
        Entry source = getEntryOrThrow(sourceEntryId);
        Entry target = getEntryOrThrow(targetEntryId);
        RelationDefinition relationDefinition = getRelationDefinitionOrThrow(relationDefinitionId);

        Long sourceWorldId = source.getWorld().getId();
        if (!target.getWorld().getId().equals(sourceWorldId) || !relationDefinition.getWorld().getId().equals(sourceWorldId)) {
            throw new IllegalArgumentException("Source entry, target entry, and relation definition must all belong to the same world");
        }

        boolean duplicate = relationRepository.existsBySourceEntryIdAndTargetEntryIdAndRelationDefinitionId(
                source.getId(), target.getId(), relationDefinition.getId())
                || relationRepository.existsBySourceEntryIdAndTargetEntryIdAndRelationDefinitionId(
                target.getId(), source.getId(), relationDefinition.getId());
        if (duplicate) {
            throw new IllegalStateException("A relation of this type already exists between these entries");
        }

        Relation saved = relationRepository.save(new Relation(source, target, relationDefinition));
        return RelationResponse.from(saved, source.getId());
    }

    public void deleteRelation(Long id) {
        Relation relation = getRelationOrThrow(id);
        relationRepository.delete(relation);
    }

    private World getWorldOrThrow(Long worldId) {
        return worldRepository.findById(worldId)
                .orElseThrow(() -> new EntityNotFoundException("World not found: " + worldId));
    }

    private Entry getEntryOrThrow(Long id) {
        return entryRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Entry not found: " + id));
    }

    private RelationDefinition getRelationDefinitionOrThrow(Long id) {
        return relationDefinitionRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Relation definition not found: " + id));
    }

    private Relation getRelationOrThrow(Long id) {
        return relationRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Relation not found: " + id));
    }
}
