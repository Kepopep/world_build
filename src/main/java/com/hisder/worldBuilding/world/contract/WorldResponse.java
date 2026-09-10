package com.hisder.worldBuilding.world.contract;

/**
 * {@code rootEntryId} is the id of the {@code LoreEntry} that has this world's id as its
 * {@code worldId} and no {@code parentId} of its own ({@code null} if the world has no root yet).
 */
public record WorldResponse(
        Long id,
        String name,
        Long rootEntryId
) {}
