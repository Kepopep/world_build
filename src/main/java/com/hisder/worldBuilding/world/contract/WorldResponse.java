package com.hisder.worldBuilding.world.contract;

import com.hisder.worldBuilding.world.World;

import java.time.LocalDateTime;

public record WorldResponse(
        Long id,
        String name,
        String icon,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {

    public static WorldResponse from(World world) {
        return new WorldResponse(
                world.getId(),
                world.getName(),
                world.getIcon(),
                world.getCreatedAt(),
                world.getUpdatedAt()
        );
    }
}
