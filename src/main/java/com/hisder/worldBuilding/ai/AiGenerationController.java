package com.hisder.worldBuilding.ai;

import com.hisder.worldBuilding.ai.contract.AiModelResponse;
import com.hisder.worldBuilding.ai.contract.EntryGenerationRequest;
import com.hisder.worldBuilding.entry.Entry;
import com.hisder.worldBuilding.entry.contract.EntryResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public class AiGenerationController {

    private final AiGenerationService aiGenerationService;

    public AiGenerationController(AiGenerationService aiGenerationService) {
        this.aiGenerationService = aiGenerationService;
    }

    @GetMapping("/api/ai/models")
    public List<AiModelResponse> listModels() {
        return aiGenerationService.listModels();
    }

    @PostMapping("/api/worlds/{worldId}/entries/generate")
    @ResponseStatus(HttpStatus.CREATED)
    public EntryResponse generateEntry(@PathVariable Long worldId, @RequestBody EntryGenerationRequest request) {
        Entry entry = aiGenerationService.generateEntry(worldId, request.prompt(), request.model(), request.folderId());
        return EntryResponse.from(entry);
    }
}
