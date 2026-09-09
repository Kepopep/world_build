package com.hisder.worldBuilding.enrty;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Entity
@Inheritance(strategy = InheritanceType.JOINED)

@Data
@NoArgsConstructor
@AllArgsConstructor
public class LoreEntry {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "entry_seq")
    @SequenceGenerator(name = "entry_seq", sequenceName = "entry_id_seq")
    private Long id;

    private String name;

    private String title;

    @Column(columnDefinition = "TEXT")
    private String description;

    private EntryType type;

    /**
     * Id of the containing {@link LoreEntry} (e.g. a city's parent is its state).
     * {@code null} means this entry is a root (e.g. a world).
     */
    private Long parentId;

    /**
     * Id of the {@link com.hisder.worldBuilding.world.World} this entry belongs to.
     */
    private Long worldId;
}
