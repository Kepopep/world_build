package com.hisder.worldBuilding.graph;

import com.hisder.worldBuilding.enrty.LoreEntry;
import com.hisder.worldBuilding.enrty.LoreEntryRepository;
import com.hisder.worldBuilding.relation.EntryRelation;
import com.hisder.worldBuilding.relation.EntryRelationRepository;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class GraphService {

    private final LoreEntryRepository loreEntryRepository;
    private final EntryRelationRepository entryRelationRepository;

    public GraphService(
            LoreEntryRepository loreEntryRepository,
            EntryRelationRepository entryRelationRepository) {

        this.loreEntryRepository = loreEntryRepository;
        this.entryRelationRepository = entryRelationRepository;
    }

    public GraphData getFullGraph() {
        List<LoreEntry> entries = loreEntryRepository.findAll();
        List<EntryRelation> relations = entryRelationRepository.findAll();

        return convertToGraphData(entries, relations);
    }

    public Optional<GraphData> getEntryGraph(Long entryId, int depth) {

        Optional<LoreEntry> entry = loreEntryRepository.findById(entryId);

        if (entry.isEmpty()) {
            return Optional.empty();
        }

        Set<Long> connectedIds = new HashSet<>();
        connectedIds.add(entryId);

        for (int i = 0; i < depth; i++) {

            Set<Long> newIds = new HashSet<>();

            for (Long id : connectedIds) {

                List<EntryRelation> relations =
                        entryRelationRepository.findAllRelationsForEntry(id);

                for (EntryRelation rel : relations) {
                    newIds.add(rel.getSource().getId());
                    newIds.add(rel.getTarget().getId());
                }
            }

            connectedIds.addAll(newIds);
        }

        List<LoreEntry> entries =
                loreEntryRepository.findAllById(connectedIds);

        List<EntryRelation> relations =
                entryRelationRepository.findAll()
                        .stream()
                        .filter(r ->
                                connectedIds.contains(r.getSource().getId()) &&
                                        connectedIds.contains(r.getTarget().getId())
                        )
                        .collect(Collectors.toList());

        return Optional.of(convertToGraphData(entries, relations));
    }

    public GraphData getGraphByType(String type) {

        List<LoreEntry> entries = loreEntryRepository.findAll();
        List<EntryRelation> relations = entryRelationRepository.findAll();

        return convertToGraphData(entries, relations);
    }

    public GraphStats getGraphStats() {

        List<LoreEntry> entries = loreEntryRepository.findAll();
        List<EntryRelation> relations = entryRelationRepository.findAll();

        return new GraphStats(
                entries.size(),
                relations.size(),
                calculateAverageDegree(entries, relations),
                calculateMostConnected(entries, relations)
        );
    }

    private GraphData convertToGraphData(
            List<LoreEntry> entries,
            List<EntryRelation> relations) {

        List<GraphNode> nodes = entries.stream()
                .map(entry -> new GraphNode(
                        entry.getId(),
                        entry.getTitle() != null
                                ? entry.getTitle()
                                : "Untitled",
                        entry.getDescription() != null
                                ? entry.getDescription()
                                : "",
                        entry.getType() != null
                                ? entry.getType().name()
                                : getEntryType(entry),
                        entry.getWorldId(),
                        entry.getParentId()
                ))
                .collect(Collectors.toList());

        List<GraphEdge> edges = relations.stream()
                .map(relation -> new GraphEdge(
                        relation.getSource().getId(),
                        relation.getTarget().getId(),
                        relation.getRelationDefinition().getName(),
                        relation.getRelationDefinition().getReverseName(),
                        relation.getId()
                ))
                .collect(Collectors.toList());

        return new GraphData(nodes, edges);
    }

    private String getEntryType(LoreEntry entry) {
        return "entry";
    }

    private double calculateAverageDegree(
            List<LoreEntry> entries,
            List<EntryRelation> relations) {

        if (entries.isEmpty()) {
            return 0;
        }

        return (2.0 * relations.size()) / entries.size();
    }

    private MostConnectedEntry calculateMostConnected(
            List<LoreEntry> entries,
            List<EntryRelation> relations) {

        Map<Long, Long> connectionCounts = new HashMap<>();

        for (EntryRelation rel : relations) {
            connectionCounts.merge(
                    rel.getSource().getId(),
                    1L,
                    Long::sum
            );

            connectionCounts.merge(
                    rel.getTarget().getId(),
                    1L,
                    Long::sum
            );
        }

        return connectionCounts.entrySet()
                .stream()
                .max(Map.Entry.comparingByValue())
                .map(entry -> {

                    LoreEntry lore = entries.stream()
                            .filter(e ->
                                    e.getId().equals(entry.getKey())
                            )
                            .findFirst()
                            .orElse(null);

                    return new MostConnectedEntry(
                            entry.getKey(),
                            lore != null
                                    ? lore.getTitle()
                                    : "Unknown",
                            entry.getValue()
                    );
                })
                .orElse(
                        new MostConnectedEntry(
                                null,
                                "None",
                                0L
                        )
                );
    }

    public record ErrorResponse(String message) {
    }

    public record GraphData(
            List<GraphNode> nodes,
            List<GraphEdge> edges
    ) {
    }

    public record GraphNode(
            Long id,
            String title,
            String description,
            String type,
            Long worldId,
            Long parentId
    ) {
    }

    public record GraphEdge(
            Long source,
            Long target,
            String relationName,
            String reverseRelationName,
            Long relationId
    ) {
    }

    public record GraphStats(
            int totalEntries,
            int totalRelations,
            double averageDegree,
            MostConnectedEntry mostConnected
    ) {
    }

    public record MostConnectedEntry(
            Long id,
            String title,
            Long connectionCount
    ) {
    }
}