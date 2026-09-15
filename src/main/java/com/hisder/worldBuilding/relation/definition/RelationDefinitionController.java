package com.hisder.worldBuilding.relation.definition;

import com.hisder.worldBuilding.relation.RelationService;
import com.hisder.worldBuilding.relation.definition.contract.RelationDefinitionCreateRequest;
import com.hisder.worldBuilding.relation.definition.contract.RelationDefinitionResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public class RelationDefinitionController {

    private final RelationService relationService;

    public RelationDefinitionController(RelationService relationService) {
        this.relationService = relationService;
    }

    @GetMapping("/api/worlds/{worldId}/relation-definitions")
    public List<RelationDefinitionResponse> listRelationDefinitions(@PathVariable Long worldId) {
        return relationService.listRelationDefinitions(worldId).stream()
                .map(RelationDefinitionResponse::from)
                .toList();
    }

    @PostMapping("/api/worlds/{worldId}/relation-definitions")
    @ResponseStatus(HttpStatus.CREATED)
    public RelationDefinitionResponse createRelationDefinition(@PathVariable Long worldId,
                                                                 @RequestBody RelationDefinitionCreateRequest request) {
        RelationDefinition relationDefinition = relationService.createRelationDefinition(worldId, request.name(), request.reverseName());
        return RelationDefinitionResponse.from(relationDefinition);
    }
}
