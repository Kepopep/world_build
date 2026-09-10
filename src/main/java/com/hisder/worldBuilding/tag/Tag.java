package com.hisder.worldBuilding.tag;

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
 * A colored label scoped to a {@link World}, shared across every {@code Entry}
 * that carries it — editing a tag's color/name here is reflected everywhere
 * it's attached, not just on one entry. Created dynamically (see
 * {@code TagService#addTagToEntry}) rather than through a standalone
 * "manage tags" flow: the first entry to use a given name creates the tag,
 * later entries reuse it.
 */
@Entity
@Table(name = "tags")
@Getter
@Setter
@NoArgsConstructor
public class Tag {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "world_id", nullable = false)
    private World world;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String color;

    public Tag(World world, String name, String color) {
        this.world = world;
        this.name = name;
        this.color = color;
    }
}
