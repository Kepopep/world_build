package com.hisder.worldBuilding.graph.contract;

import java.util.List;

public record GraphResponse(List<GraphNode> nodes, List<GraphEdge> edges) {
}
