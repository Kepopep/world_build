package com.hisder.worldBuilding.world;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Entity
@Data
@NoArgsConstructor
@AllArgsConstructor
public class World {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "world_seq")
    @SequenceGenerator(name = "world_seq", sequenceName = "world_id_seq")
    private Long id;

    @Column(nullable = false, unique = true)
    private String name;
}
