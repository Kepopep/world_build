package com.hisder.worldBuilding.graph.contract;

import com.hisder.worldBuilding.entry.Entry;

public record GraphNode(Long id, String title, String icon) {

    public static GraphNode from(Entry entry) {
        return new GraphNode(entry.getId(), entry.getTitle(), entry.getIcon());
    }
}
