package com.hisder.worldBuilding.enrty;

import com.hisder.worldBuilding.enrty.contract.LoreEntryCreateRequest;
import com.hisder.worldBuilding.enrty.contract.LoreEntryUpdateRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/entry")
public class LoreEntryController {
    private final LoreEntryService loreEntryService;

    public LoreEntryController(LoreEntryService loreEntryService) {
        this.loreEntryService = loreEntryService;
    }

    @GetMapping("/")
    public ResponseEntity<List<LoreEntry>> getAll() {
        List<LoreEntry> entries = loreEntryService.getAll();
        return ResponseEntity
                .status(HttpStatus.OK)
                .body(entries);
    }

    @GetMapping("/{id}")
    public ResponseEntity<LoreEntry> get(@PathVariable Long id) {
        LoreEntry entry = loreEntryService.get(id);
        return ResponseEntity
                .status(HttpStatus.OK)
                .body(entry);
    }

    @PostMapping("/create")
    public ResponseEntity<LoreEntry> create(@RequestBody LoreEntryCreateRequest request) {
        LoreEntry newEntry = loreEntryService.create(request);

        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(newEntry);
    }

    @PostMapping("/update/{id}")
    public ResponseEntity<LoreEntry> update(@PathVariable Long id, @RequestBody LoreEntryUpdateRequest request) {
        LoreEntry newEntry = loreEntryService.update(id, request);

        return ResponseEntity
                .status(HttpStatus.OK)
                .body(newEntry);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        loreEntryService.delete(id);

        return ResponseEntity
                .noContent()
                .build();
    }
}
