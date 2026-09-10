package com.hisder.worldBuilding.entry;

import com.hisder.worldBuilding.world.World;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Lob;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * Core content unit ("page") of a World. Folder/Tag/Relation features are not
 * built yet (see CLAUDE.md); {@code folderId} is a placeholder column for the
 * future Folder feature and is otherwise unused.
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

    @Column(name = "folder_id")
    private Long folderId;

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
