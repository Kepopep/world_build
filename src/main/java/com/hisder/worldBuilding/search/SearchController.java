package com.hisder.worldBuilding.search;

import com.hisder.worldBuilding.entry.EntryService;
import com.hisder.worldBuilding.search.contract.SearchResultResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Thin -- delegates all matching logic to EntryService.searchEntries.
 * General title/summary/content search scoped to a world, distinct from the
 * narrower entry-title-only typeahead that backs the wikilink autocomplete
 * (GET /api/worlds/{worldId}/entries/search).
 */
@RestController
public class SearchController {

    private final EntryService entryService;

    public SearchController(EntryService entryService) {
        this.entryService = entryService;
    }

    @GetMapping("/api/worlds/{worldId}/search")
    public List<SearchResultResponse> search(@PathVariable Long worldId,
                                              @RequestParam(required = false) String q,
                                              @RequestParam(required = false, defaultValue = "20") int limit) {
        return entryService.searchEntries(worldId, q, limit).stream()
                .map(SearchResultResponse::from)
                .toList();
    }
}
