package com.hisder.worldBuilding.relation;

import com.hisder.worldBuilding.enrty.LoreEntry;
import com.hisder.worldBuilding.relation.definition.RelationDefinition;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.OnDelete;
import org.hibernate.annotations.OnDeleteAction;

@Data
@Entity
@NoArgsConstructor
@AllArgsConstructor
@Table(name = "entry_relation")
public class EntryRelation {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "relation_seq")
    @SequenceGenerator(name = "relation_seq", sequenceName = "relation_id_seq")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "source_id", nullable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private LoreEntry source;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "target_id", nullable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private LoreEntry target;

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "relation_id", nullable = false)
    private RelationDefinition relationDefinition;
}
