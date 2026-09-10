package com.hisder.worldBuilding.entry;

import com.hisder.worldBuilding.entry.contract.EntryCreateRequest;
import com.hisder.worldBuilding.entry.contract.EntryResponse;
import com.hisder.worldBuilding.entry.contract.EntryTitleSuggestion;
import com.hisder.worldBuilding.entry.contract.EntryUpdateRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public class EntryController {

    private final EntryService entryService;

    public EntryController(EntryService entryService) {
        this.entryService = entryService;
    }

    @GetMapping("/api/worlds/{worldId}/entries")
    public List<EntryResponse> listEntries(@PathVariable Long worldId) {
        return entryService.listEntries(worldId).stream()
                .map(EntryResponse::from)
                .toList();
    }

    @PostMapping("/api/worlds/{worldId}/entries")
    @ResponseStatus(HttpStatus.CREATED)
    public EntryResponse createEntry(@PathVariable Long worldId, @RequestBody EntryCreateRequest request) {
        Entry entry = entryService.createEntry(worldId, request.title(), request.contentMarkdown());
        return EntryResponse.from(entry);
    }

    @GetMapping("/api/worlds/{worldId}/entries/search")
    public List<EntryTitleSuggestion> searchEntries(@PathVariable Long worldId,
                                                      @RequestParam(required = false) String q,
                                                      @RequestParam(required = false, defaultValue = "8") int limit) {
        return entryService.searchEntriesByTitle(worldId, q, limit).stream()
                .map(EntryTitleSuggestion::from)
                .toList();
    }

    @GetMapping("/api/entries/{id}")
    public EntryResponse getEntry(@PathVariable Long id) {
        return EntryResponse.from(entryService.getEntry(id));
    }

    @PatchMapping("/api/entries/{id}")
    public EntryResponse updateEntry(@PathVariable Long id, @RequestBody EntryUpdateRequest request) {
        Entry entry = entryService.updateEntry(id, request);
        return EntryResponse.from(entry);
    }

    @DeleteMapping("/api/entries/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteEntry(@PathVariable Long id) {
        entryService.deleteEntry(id);
    }
}
