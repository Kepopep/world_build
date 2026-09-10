package com.hisder.worldBuilding.tag;

import com.hisder.worldBuilding.entry.contract.EntryResponse;
import com.hisder.worldBuilding.tag.contract.TagCreateRequest;
import com.hisder.worldBuilding.tag.contract.TagResponse;
import com.hisder.worldBuilding.tag.contract.TagUpdateRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public class TagController {

    private final TagService tagService;

    public TagController(TagService tagService) {
        this.tagService = tagService;
    }

    @GetMapping("/api/worlds/{worldId}/tags")
    public List<TagResponse> listTags(@PathVariable Long worldId) {
        return tagService.listTags(worldId).stream()
                .map(TagResponse::from)
                .toList();
    }

    @PatchMapping("/api/tags/{id}")
    public TagResponse updateTag(@PathVariable Long id, @RequestBody TagUpdateRequest request) {
        return TagResponse.from(tagService.updateTag(id, request.name(), request.color()));
    }

    @PostMapping("/api/entries/{entryId}/tags")
    @ResponseStatus(HttpStatus.CREATED)
    public EntryResponse addTag(@PathVariable Long entryId, @RequestBody TagCreateRequest request) {
        return EntryResponse.from(tagService.addTagToEntry(entryId, request.name(), request.color()));
    }

    @DeleteMapping("/api/entries/{entryId}/tags/{tagId}")
    public EntryResponse removeTag(@PathVariable Long entryId, @PathVariable Long tagId) {
        return EntryResponse.from(tagService.removeTagFromEntry(entryId, tagId));
    }
}
