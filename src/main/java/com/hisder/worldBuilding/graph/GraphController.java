package com.hisder.worldBuilding.graph;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/graph")
public class GraphController {

    private final GraphService graphService;

    public GraphController(GraphService graphService) {
        this.graphService = graphService;
    }

    @GetMapping("/all")
    public ResponseEntity<GraphService.GraphData> getFullGraph() {
        return ResponseEntity.ok(graphService.getFullGraph());
    }

    @GetMapping("/entry/{entryId}")
    public ResponseEntity<?> getEntryGraph(
            @PathVariable Long entryId,
            @RequestParam(defaultValue = "2") int depth) {

        return graphService.getEntryGraph(entryId, depth)
                .<ResponseEntity<?>>map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity
                        .status(HttpStatus.NOT_FOUND)
                        .body(new GraphService.ErrorResponse(
                                "Entry not found: " + entryId
                        )));
    }

    @GetMapping("/type/{type}")
    public ResponseEntity<GraphService.GraphData> getGraphByType(
            @PathVariable String type) {

        return ResponseEntity.ok(graphService.getGraphByType(type));
    }

    @GetMapping("/stats")
    public ResponseEntity<GraphService.GraphStats> getGraphStats() {
        return ResponseEntity.ok(graphService.getGraphStats());
    }
}