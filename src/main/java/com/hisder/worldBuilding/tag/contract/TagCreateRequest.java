package com.hisder.worldBuilding.tag.contract;

/**
 * POST /api/entries/{id}/tags. {@code color} is optional — omitting it only
 * matters the first time a given {@code name} is used in the world (that's
 * when the tag actually gets created); after that, the existing tag (and its
 * existing color) is reused regardless of what's passed here. Changing an
 * existing tag's color is a separate action — see {@link TagUpdateRequest}.
 */
public record TagCreateRequest(String name, String color) {
}
