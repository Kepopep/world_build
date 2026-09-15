package com.hisder.worldBuilding.tag.contract;

/**
 * Partial update payload for PATCH /api/tags/{id}. A null field means "leave
 * unchanged". Updates the tag itself, so the change is visible on every
 * entry that carries it, not just one.
 */
public record TagUpdateRequest(String name, String color) {
}
