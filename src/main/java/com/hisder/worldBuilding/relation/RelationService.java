package com.hisder.worldBuilding.relation;

import com.hisder.worldBuilding.enrty.LoreEntry;
import com.hisder.worldBuilding.enrty.LoreEntryRepository;
import com.hisder.worldBuilding.relation.contract.RelationResponse;
import com.hisder.worldBuilding.relation.definition.RelationDefinition;
import com.hisder.worldBuilding.relation.definition.RelationDefinitionRepository;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Stream;


@Service
public class RelationService {
    private final EntryRelationRepository entryRelationRepository;
    private final RelationDefinitionRepository relationDefinitionRepository;
    private final LoreEntryRepository loreEntryRepository;

    public RelationService(EntryRelationRepository entryRelationRepository,
                          RelationDefinitionRepository relationDefinitionRepository,
                          LoreEntryRepository loreEntryRepository) {
        this.entryRelationRepository = entryRelationRepository;
        this.relationDefinitionRepository = relationDefinitionRepository;
        this.loreEntryRepository = loreEntryRepository;
    }

    @Transactional
    public RelationDefinition createNewDefinition(String name, String reverseName) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Relation name cannot be blank");
        }
        if (reverseName == null || reverseName.isBlank()) {
            throw new IllegalArgumentException("Reverse name cannot be blank");
        }

        RelationDefinition definition = new RelationDefinition();
        definition.setName(name);
        definition.setReverseName(reverseName);
        return relationDefinitionRepository.save(definition);
    }

    public List<RelationDefinition> getAll() {
        return relationDefinitionRepository.findAll();
    }

    @Transactional
    public EntryRelation createRelation(Long sourceId, Long targetId, Long relationDefinitionId) {
        if (sourceId.equals(targetId)) {
            throw new IllegalArgumentException(
                    "Cannot create self-relation: source and target must be different");
        }

        if (entryRelationRepository.existsBySourceIdAndTargetIdAndRelationDefinitionId(
                sourceId, targetId, relationDefinitionId)) {
            throw new IllegalStateException("This relation already exists");
        }

        if (entryRelationRepository.existsBySourceIdAndTargetIdAndRelationDefinitionId(
                targetId, sourceId, relationDefinitionId)) {
            throw new IllegalStateException(
                    "Reverse relation already exists: " + targetId +
                            " already has this relation type to " + sourceId);
        }

        LoreEntry source = loreEntryRepository.findById(sourceId)
                .orElseThrow(() -> 
                        new EntityNotFoundException("Source LoreEntry not found: " + sourceId));

        LoreEntry target = loreEntryRepository.findById(targetId)
                .orElseThrow(() -> 
                        new EntityNotFoundException("Target LoreEntry not found: " + targetId));

        RelationDefinition definition = relationDefinitionRepository.findById(relationDefinitionId)
                .orElseThrow(() -> 
                        new EntityNotFoundException("RelationDefinition not found: " + relationDefinitionId));

        // Create and save relation
        EntryRelation relation = new EntryRelation();
        relation.setSource(source);
        relation.setTarget(target);
        relation.setRelationDefinition(definition);

        return entryRelationRepository.save(relation);
    }

    @Transactional
    public void deleteRelation(Long relationId) {
        if (!entryRelationRepository.existsById(relationId)) {
            throw new EntityNotFoundException("Relation not found: " + relationId);
        }
        entryRelationRepository.deleteById(relationId);
    }

    public List<RelationResponse> getRelations(Long entryId) {
        if (!loreEntryRepository.existsById(entryId)) {
            throw new EntityNotFoundException("LoreEntry not found: " + entryId);
        }

        List<RelationResponse> outgoing = entryRelationRepository
                .findBySourceId(entryId)
                .stream()
                .map(relation -> new RelationResponse(
                        relation.getTarget().getId(),
                        relation.getRelationDefinition().getName(),
                        true  // isOutgoing = true
                ))
                .toList();

        List<RelationResponse> incoming = entryRelationRepository
                .findByTargetId(entryId)
                .stream()
                .map(relation -> new RelationResponse(
                        relation.getSource().getId(),
                        relation.getRelationDefinition().getReverseName(),
                        false  // isOutgoing = false
                ))
                .toList();

        return Stream.concat(outgoing.stream(), incoming.stream()).toList();
    }

    @Transactional
    public void deleteAllRelationsForEntry(Long entryId) {
        entryRelationRepository.deleteBySourceIdOrTargetId(entryId, entryId);
    }

    public boolean relationExists(Long sourceId, Long targetId) {
        return entryRelationRepository.existsBySourceIdAndTargetId(sourceId, targetId);
    }

    public long getRelationCount(Long entryId) {
        long outgoing = entryRelationRepository.countBySourceId(entryId);
        long incoming = entryRelationRepository.countByTargetId(entryId);
        return outgoing + incoming;
    }

    public List<EntryRelation> getRelationsByType(Long entryId, Long relationDefinitionId) {
        List<EntryRelation> relations = entryRelationRepository.findAllRelationsForEntry(entryId);
        return relations.stream()
                .filter(r -> r.getRelationDefinition().getId().equals(relationDefinitionId))
                .toList();
    }
}
