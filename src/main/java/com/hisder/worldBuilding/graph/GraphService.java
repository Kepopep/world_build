package com.hisder.worldBuilding.graph;

import com.hisder.worldBuilding.entry.Entry;
import com.hisder.worldBuilding.entry.EntryRepository;
import com.hisder.worldBuilding.graph.contract.GraphEdge;
import com.hisder.worldBuilding.graph.contract.GraphNode;
import com.hisder.worldBuilding.graph.contract.GraphResponse;
import com.hisder.worldBuilding.relation.Relation;
import com.hisder.worldBuilding.relation.RelationRepository;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Read-only aggregation over Entry + Relation into graph nodes/edges -- no
 * storage of its own. Backs both the right-panel per-entry graph and the
 * far-left full-world graph view.
 */
@Service
@Transactional(readOnly = true)
public class GraphService {

    private static final int MAX_DEPTH = 5;

    private final EntryRepository entryRepository;
    private final RelationRepository relationRepository;

    public GraphService(EntryRepository entryRepository, RelationRepository relationRepository) {
        this.entryRepository = entryRepository;
        this.relationRepository = relationRepository;
    }

    /**
     * Every Entry in the world as nodes, every Relation whose source and
     * target both belong to the world as edges (label = definition.name --
     * edges are directional, the frontend can show the reverse label on
     * hover from the other end).
     */
    public GraphResponse worldGraph(Long worldId) {
        List<GraphNode> nodes = entryRepository.findByWorldId(worldId).stream()
                .map(GraphNode::from)
                .toList();
        List<GraphEdge> edges = relationRepository.findBySourceEntryWorldIdAndTargetEntryWorldId(worldId, worldId).stream()
                .map(GraphEdge::from)
                .toList();
        return new GraphResponse(nodes, edges);
    }

    /**
     * BFS-expanded from entryId out to depth hops, traversing relations in
     * both directions (an entry's neighbors = both outgoing and incoming
     * relations). Each edge in the response keeps its real source/target/
     * label regardless of which direction it was discovered from. depth=0
     * returns just the center node with no edges.
     */
    public GraphResponse entryGraph(Long entryId, int depth) {
        if (depth < 0 || depth > MAX_DEPTH) {
            throw new IllegalArgumentException("depth must be between 0 and " + MAX_DEPTH);
        }
        Entry center = entryRepository.findById(entryId)
                .orElseThrow(() -> new EntityNotFoundException("Entry not found: " + entryId));

        Map<Long, Entry> visitedEntries = new LinkedHashMap<>();
        visitedEntries.put(center.getId(), center);
        Set<Long> visitedRelationIds = new LinkedHashSet<>();
        List<Relation> collectedEdges = new ArrayList<>();

        Set<Long> frontier = new LinkedHashSet<>();
        frontier.add(center.getId());

        for (int hop = 0; hop < depth && !frontier.isEmpty(); hop++) {
            Set<Long> nextFrontier = new LinkedHashSet<>();
            for (Long currentId : frontier) {
                for (Relation relation : relationRepository.findBySourceEntryIdOrTargetEntryId(currentId, currentId)) {
                    if (visitedRelationIds.add(relation.getId())) {
                        collectedEdges.add(relation);
                    }
                    Entry other = relation.getSourceEntry().getId().equals(currentId)
                            ? relation.getTargetEntry()
                            : relation.getSourceEntry();
                    if (!visitedEntries.containsKey(other.getId())) {
                        visitedEntries.put(other.getId(), other);
                        nextFrontier.add(other.getId());
                    }
                }
            }
            frontier = nextFrontier;
        }

        List<GraphNode> nodes = visitedEntries.values().stream().map(GraphNode::from).toList();
        List<GraphEdge> edges = collectedEdges.stream().map(GraphEdge::from).toList();
        return new GraphResponse(nodes, edges);
    }
}
