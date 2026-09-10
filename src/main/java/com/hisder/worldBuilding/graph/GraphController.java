package com.hisder.worldBuilding.graph;

import com.hisder.worldBuilding.graph.contract.GraphResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/graph")
public class GraphController {

    private final GraphService graphService;

    public GraphController(GraphService graphService) {
        this.graphService = graphService;
    }

    @GetMapping("/world/{worldId}")
    public GraphResponse worldGraph(@PathVariable Long worldId) {
        return graphService.worldGraph(worldId);
    }

    @GetMapping("/entry/{id}")
    public GraphResponse entryGraph(@PathVariable Long id, @RequestParam(required = false, defaultValue = "1") int depth) {
        return graphService.entryGraph(id, depth);
    }
}
