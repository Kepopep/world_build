package com.hisder.worldBuilding.ai.contract;

/**
 * folderId is nullable -- null means "create at the world's root", same
 * convention EntryCreateRequest already uses.
 */
public record EntryGenerationRequest(String prompt, String model, Long folderId) {
}
