package com.hisder.worldBuilding.entry;

import com.hisder.worldBuilding.folder.Folder;
import com.hisder.worldBuilding.tag.Tag;
import com.hisder.worldBuilding.world.World;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.Lob;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Set;

/**
 * Core content unit ("page") of a World. Relation features are not built yet
 * (see CLAUDE.md).
 */
@Entity
@Table(name = "entries")
@Getter
@Setter
@NoArgsConstructor
public class Entry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "world_id", nullable = false)
    private World world;

    // Nullable -- null means "root level" (no folder). LAZY like World's
    // relation; unlike World, Entry.folder is genuinely optional.
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "folder_id")
    private Folder folder;

    @Column
    private String icon;

    @Column(nullable = false)
    private String title;

    @Column
    private String summary;

    @Lob
    @Column(name = "content_markdown")
    private String contentMarkdown;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    // EAGER: EntryResponse always needs the tag list to render the pill row
    // under the title, and the mapping happens in the controller after
    // TagService/EntryService's own @Transactional method has already
    // returned -- eager fetch sidesteps relying on open-in-view for a
    // collection that's always small anyway.
    @ManyToMany(fetch = FetchType.EAGER)
    @JoinTable(
            name = "entry_tags",
            joinColumns = @JoinColumn(name = "entry_id"),
            inverseJoinColumns = @JoinColumn(name = "tag_id")
    )
    private Set<Tag> tags = new HashSet<>();

    public Entry(World world, String title, String contentMarkdown) {
        this.world = world;
        this.title = title;
        this.contentMarkdown = contentMarkdown;
    }

    @PrePersist
    void onCreate() {
        LocalDateTime now = LocalDateTime.now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
