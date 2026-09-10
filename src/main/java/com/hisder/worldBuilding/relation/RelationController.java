package com.hisder.worldBuilding.relation;

import com.hisder.worldBuilding.relation.contract.RelationCreateRequest;
import com.hisder.worldBuilding.relation.contract.RelationResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public class RelationController {

    private final RelationService relationService;

    public RelationController(RelationService relationService) {
        this.relationService = relationService;
    }

    @GetMapping("/api/entries/{id}/relations")
    public List<RelationResponse> listRelations(@PathVariable Long id) {
        return relationService.listRelationsForEntry(id);
    }

    @PostMapping("/api/relations")
    @ResponseStatus(HttpStatus.CREATED)
    public RelationResponse createRelation(@RequestBody RelationCreateRequest request) {
        return relationService.createRelation(request.sourceEntryId(), request.targetEntryId(), request.relationDefinitionId());
    }

    @DeleteMapping("/api/relations/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteRelation(@PathVariable Long id) {
        relationService.deleteRelation(id);
    }
}
