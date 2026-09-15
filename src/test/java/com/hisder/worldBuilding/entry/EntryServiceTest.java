package com.hisder.worldBuilding.entry;

import com.hisder.worldBuilding.entry.contract.EntryUpdateRequest;
import com.hisder.worldBuilding.folder.FolderRepository;
import com.hisder.worldBuilding.world.World;
import com.hisder.worldBuilding.world.WorldRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Covers EntryService's duplicate-title guard -- see
 * docs/design/entry-title-uniqueness.md. Pure Mockito unit tests (no
 * @DataJpaTest / real Postgres in this project's test setup yet), so the
 * DB-level unique index itself isn't exercised here -- only that EntryService
 * calls the right repository checks and correctly translates both the
 * pre-check result and a simulated DataIntegrityViolationException (standing
 * in for the DB constraint firing under a race) into the same
 * IllegalStateException the rest of the codebase maps to 409 Conflict
 * (GlobalExceptionHandler, same convention as RelationService's duplicate
 * check).
 */
@ExtendWith(MockitoExtension.class)
class EntryServiceTest {

    @Mock
    private EntryRepository entryRepository;
    @Mock
    private WorldRepository worldRepository;
    @Mock
    private FolderRepository folderRepository;

    @InjectMocks
    private EntryService entryService;

    private World world;

    @BeforeEach
    void setUp() {
        world = new World("Test World", null);
        world.setId(1L);
    }

    @Test
    void createEntry_rejectsCaseInsensitiveDuplicateTitle() {
        when(worldRepository.findById(1L)).thenReturn(Optional.of(world));
        when(entryRepository.existsByWorldIdAndTitleIgnoreCase(1L, "Ravinia")).thenReturn(true);

        assertThatThrownBy(() -> entryService.createEntry(1L, "Ravinia", "content", null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Ravinia");

        verify(entryRepository, never()).saveAndFlush(any());
    }

    @Test
    void createEntry_allowsUniqueTitleAndTrimsWhitespace() {
        when(worldRepository.findById(1L)).thenReturn(Optional.of(world));
        when(entryRepository.existsByWorldIdAndTitleIgnoreCase(1L, "Ravinia")).thenReturn(false);
        when(entryRepository.saveAndFlush(any(Entry.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        Entry created = entryService.createEntry(1L, "  Ravinia  ", "content", null);

        assertThat(created.getTitle()).isEqualTo("Ravinia");
    }

    @Test
    void createEntry_translatesRaceLostAtTheDbConstraintTo409StyleException() {
        // Simulates two concurrent creates both passing the pre-check before
        // either commits -- the DB-level unique index is what actually catches
        // this, surfaced to Spring as DataIntegrityViolationException.
        when(worldRepository.findById(1L)).thenReturn(Optional.of(world));
        when(entryRepository.existsByWorldIdAndTitleIgnoreCase(1L, "Ravinia")).thenReturn(false);
        when(entryRepository.saveAndFlush(any(Entry.class)))
                .thenThrow(new DataIntegrityViolationException("duplicate key value violates unique constraint"));

        assertThatThrownBy(() -> entryService.createEntry(1L, "Ravinia", "content", null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Ravinia");
    }

    @Test
    void updateEntry_rejectsRenamingToAnotherEntrysTitle() {
        Entry entry = existingEntry(5L, "Elion");
        when(entryRepository.findById(5L)).thenReturn(Optional.of(entry));
        when(entryRepository.existsByWorldIdAndTitleIgnoreCaseAndIdNot(1L, "Ravinia", 5L)).thenReturn(true);

        EntryUpdateRequest request = new EntryUpdateRequest("Ravinia", null, null, null);

        assertThatThrownBy(() -> entryService.updateEntry(5L, request))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Ravinia");
    }

    @Test
    void updateEntry_allowsRenamingToItsOwnTitleModuloCase() {
        // A no-op-ish rename (just changing case, or resubmitting the same
        // title) must not be flagged against the entry's own row.
        Entry entry = existingEntry(5L, "Ravinia");
        when(entryRepository.findById(5L)).thenReturn(Optional.of(entry));

        EntryUpdateRequest request = new EntryUpdateRequest("ravinia", null, null, null);

        Entry updated = entryService.updateEntry(5L, request);

        assertThat(updated.getTitle()).isEqualTo("ravinia");
        verify(entryRepository, never())
                .existsByWorldIdAndTitleIgnoreCaseAndIdNot(anyLong(), any(), anyLong());
        verify(entryRepository, never()).flush();
    }

    @Test
    void updateEntry_skipsDuplicateCheckWhenTitleIsNotBeingChanged() {
        Entry entry = existingEntry(5L, "Ravinia");
        when(entryRepository.findById(5L)).thenReturn(Optional.of(entry));

        EntryUpdateRequest request = new EntryUpdateRequest(null, "A new summary", null, null);

        Entry updated = entryService.updateEntry(5L, request);

        assertThat(updated.getSummary()).isEqualTo("A new summary");
        verify(entryRepository, never())
                .existsByWorldIdAndTitleIgnoreCaseAndIdNot(anyLong(), any(), eq(5L));
    }

    private Entry existingEntry(Long id, String title) {
        Entry entry = new Entry(world, title, "content");
        entry.setId(id);
        return entry;
    }
}
