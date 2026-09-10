package com.hisder.worldBuilding.relation.definition;

import com.hisder.worldBuilding.world.World;
import jakarta.persistence.Column;
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
 * A named relation type scoped to a {@link World}, e.g. name="rules",
 * reverseName="ruled by" -- {@code name} is shown traversing the edge from
 * the source entry, {@code reverseName} from the target entry, so relation
 * labels read naturally in either direction.
 */
@Entity
@Table(name = "relation_definitions")
@Getter
@Setter
@NoArgsConstructor
public class RelationDefinition {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "world_id", nullable = false)
    private World world;

    @Column(nullable = false)
    private String name;

    @Column(name = "reverse_name", nullable = false)
    private String reverseName;

    public RelationDefinition(World world, String name, String reverseName) {
        this.world = world;
        this.name = name;
        this.reverseName = reverseName;
    }
}
