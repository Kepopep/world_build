package com.hisder.worldBuilding.folder;

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
 * A purely organizational tree node scoped to a World -- not renderable
 * content itself (see Entry for that). Self-referential via parentFolder
 * for nesting; a null parentFolder means "top-level folder".
 */
@Entity
@Table(name = "folders")
@Getter
@Setter
@NoArgsConstructor
public class Folder {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "world_id", nullable = false)
    private World world;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_folder_id")
    private Folder parentFolder;

    @Column(nullable = false)
    private String name;

    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder;

    public Folder(World world, Folder parentFolder, String name, Integer sortOrder) {
        this.world = world;
        this.parentFolder = parentFolder;
        this.name = name;
        this.sortOrder = sortOrder;
    }
}
