package com.hisder.worldBuilding.relation;

import com.hisder.worldBuilding.relation.contract.RelationCreateRequest;
import com.hisder.worldBuilding.relation.contract.RelationResponse;
import com.hisder.worldBuilding.relation.definition.RelationDefinition;
import com.hisder.worldBuilding.relation.definition.contract.RelationDefinitionCreateRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;


@RestController
@RequestMapping("/api/relations")
public class RelationController {
    private final RelationService relationService;

    public RelationController(RelationService relationService) {
        this.relationService = relationService;
    }

    @GetMapping("/definitions")
    public ResponseEntity<List<RelationDefinition>> getAllDefinitions() {
        List<RelationDefinition> definitions = relationService.getAll();
        return ResponseEntity
                .status(HttpStatus.OK)
                .body(definitions);
    }

    @PostMapping("/definitions")
    public ResponseEntity<?> createDefinition(@Valid @RequestBody RelationDefinitionCreateRequest request) {
        RelationDefinition definition = relationService.createNewDefinition(
                request.name(),
                request.reverseName()
        );
        return ResponseEntity.status(HttpStatus.CREATED).body(definition);
    }

    @PostMapping
    public ResponseEntity<?> createRelation(@Valid @RequestBody RelationCreateRequest request) {
        EntryRelation relation = relationService.createRelation(
                request.sourceId(),
                request.targetId(),
                request.relationDefinitionId()
        );
        return ResponseEntity.status(HttpStatus.CREATED).body(relation);
    }

    @GetMapping("/entry/{entryId}")
    public ResponseEntity<?> getRelationsByEntry(@PathVariable Long entryId) {
        List<RelationResponse> relations = relationService.getRelations(entryId);
        return ResponseEntity.status(HttpStatus.OK).body(relations);
    }

    @DeleteMapping("/{relationId}")
    public ResponseEntity<?> deleteRelation(@PathVariable Long relationId) {
        relationService.deleteRelation(relationId);
        return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
    }

    @GetMapping("/entry/{entryId}/count")
    public ResponseEntity<?> getRelationCount(@PathVariable Long entryId) {
        long count = relationService.getRelationCount(entryId);
        return ResponseEntity.status(HttpStatus.OK)
                .body(count);
    }
}
