package com.hisder.worldBuilding.tag.contract;

import com.hisder.worldBuilding.tag.Tag;

public record TagResponse(
        Long id,
        Long worldId,
        String name,
        String color
) {

    public static TagResponse from(Tag tag) {
        return new TagResponse(
                tag.getId(),
                tag.getWorld().getId(),
                tag.getName(),
                tag.getColor()
        );
    }
}
