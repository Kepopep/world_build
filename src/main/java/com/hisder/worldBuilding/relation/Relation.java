package com.hisder.worldBuilding.relation;

import com.hisder.worldBuilding.entry.Entry;
import com.hisder.worldBuilding.relation.definition.RelationDefinition;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A directed, typed link between two entries. No {@code worldId} column of
 * its own -- source, target, and relationDefinition are all validated to
 * share one World at creation time (see RelationService.createRelation).
 */
@Entity
@Table(name = "relations")
@Getter
@Setter
@NoArgsConstructor
public class Relation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "source_entry_id", nullable = false)
    private Entry sourceEntry;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "target_entry_id", nullable = false)
    private Entry targetEntry;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "relation_definition_id", nullable = false)
    private RelationDefinition relationDefinition;

    public Relation(Entry sourceEntry, Entry targetEntry, RelationDefinition relationDefinition) {
        this.sourceEntry = sourceEntry;
        this.targetEntry = targetEntry;
        this.relationDefinition = relationDefinition;
    }
}
