/**
 * Entry View page.
 *
 * Wired to the real backend: worlds (/api/worlds), lore entries
 * (/api/entry/...) and relations (/api/relations/...). The hierarchy tree is
 * built client-side from the flat entry list (parentId + type), since the
 * backend has no dedicated hierarchy endpoint yet — see
 * docs/entry-view-missing-features.md for what's still missing (notes,
 * search, tags/quick-info attributes, richer relation targets, etc.) and for
 * a couple of backend quirks this page has to work around.
 */

// ---------------------------------------------------------------------------
// EntryType metadata (mirrors com.hisder.worldBuilding.enrty.EntryType)
// ---------------------------------------------------------------------------

const ENTRY_TYPES = [
    { value: 'EMPTY', icon: '⚠', label: 'Прочее' },
    { value: 'WORLD', icon: '🌐', label: 'Миры' },
    { value: 'CONTINENT', icon: '🏔', label: 'Континенты' },
    { value: 'STATE', icon: '👑', label: 'Государства' },
    { value: 'CITY', icon: '🏛', label: 'Города' },
    { value: 'REGION', icon: '🌍', label: 'Регионы' },
    { value: 'PEOPLE', icon: '👥', label: 'Народы' },
    { value: 'FACTION', icon: '🚩', label: 'Фракции' },
    { value: 'GOD', icon: '⭐', label: 'Боги' },
    { value: 'CREATURE', icon: '🐉', label: 'Существа' },
    { value: 'RELIC', icon: '☥', label: 'Реликвии' },
    { value: 'EVENT', icon: '⚔', label: 'События' }
];

const ENTRY_TYPE_BY_VALUE = new Map(ENTRY_TYPES.map(t => [t.value, t]));

function typeMeta(type) {
    return ENTRY_TYPE_BY_VALUE.get(type) || ENTRY_TYPE_BY_VALUE.get('EMPTY');
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let worlds = [];
let currentWorldId = null;
let entriesById = new Map();   // entries belonging to the current world
let entryCache = new Map();    // any entry fetched individually (e.g. relation targets)
let treeRoots = [];
let collapsedIds = new Set();
let currentEntryId = null;

let entryModalMode = 'create'; // 'create' | 'edit'
let entryModalEditingId = null;

/** Session-local notes, keyed by entry id. Backend has no Notes API yet. */
const notesStore = new Map();

let relationDefinitions = [];

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

async function api(path, options = {}) {
    const opts = { ...options };
    if (opts.body && typeof opts.body !== 'string') {
        opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
        opts.body = JSON.stringify(opts.body);
    }

    const response = await fetch(path, opts);
    if (response.status === 204) return null;

    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const data = isJson ? await response.json().catch(() => null) : await response.text();

    if (!response.ok) {
        const message = isJson && data && data.message
            ? data.message
            : (typeof data === 'string' && data ? data : `HTTP ${response.status}`);
        throw new Error(message);
    }

    return data;
}

function byNameThenId(a, b) {
    return a.name.localeCompare(b.name, 'ru') || a.id - b.id;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    bindStaticControls();
    bindEntryModal();
    bindWorldModal();
    bindRelationModal();
    init();
});

async function init() {
    try {
        worlds = await api('/api/worlds');
    } catch (err) {
        showToast('Не удалось загрузить список миров: ' + err.message);
        return;
    }

    if (worlds.length === 0) {
        renderNoWorldsState();
        return;
    }

    const params = new URLSearchParams(location.search);
    const worldParam = Number(params.get('world'));
    const entryParam = Number(params.get('entry'));
    const savedWorldId = Number(localStorage.getItem('wb.currentWorldId'));

    const initialWorld = worlds.find(w => w.id === worldParam)
        || worlds.find(w => w.id === savedWorldId)
        || worlds[0];

    await selectWorld(initialWorld.id, Number.isFinite(entryParam) && entryParam ? entryParam : null);
}

// ---------------------------------------------------------------------------
// Worlds
// ---------------------------------------------------------------------------

async function selectWorld(worldId, focusEntryId) {
    currentWorldId = worldId;
    localStorage.setItem('wb.currentWorldId', String(worldId));

    const world = worlds.find(w => w.id === worldId);
    document.getElementById('worldName').textContent = world ? world.name : '—';

    collapsedIds.clear();

    try {
        await loadEntries();
    } catch (err) {
        showToast('Не удалось загрузить сущности мира: ' + err.message);
        return;
    }

    const entries = [...entriesById.values()];
    if (entries.length === 0) {
        renderTree();
        renderEmptyEntryState();
        return;
    }

    const target = focusEntryId && entriesById.has(focusEntryId)
        ? focusEntryId
        : (world && world.rootEntryId && entriesById.has(world.rootEntryId) ? world.rootEntryId : entries.sort(byNameThenId)[0].id);

    await renderEntry(target);
}

async function loadEntries() {
    const all = await api('/api/entry/');
    entriesById = new Map(all.filter(e => e.worldId === currentWorldId).map(e => [e.id, e]));
    entriesById.forEach((entry, id) => entryCache.set(id, entry));
    rebuildTree();
}

async function getEntryCached(id) {
    if (entryCache.has(id)) return entryCache.get(id);
    const entry = await api(`/api/entry/${id}`);
    entryCache.set(id, entry);
    return entry;
}

/** Navigate to an entry, switching worlds first if it belongs to a different one. */
async function goToEntry(id) {
    if (entriesById.has(id)) {
        await renderEntry(id);
        return;
    }

    let entry;
    try {
        entry = await getEntryCached(id);
    } catch (err) {
        showToast('Сущность не найдена: ' + err.message);
        return;
    }

    if (entry.worldId !== currentWorldId && worlds.some(w => w.id === entry.worldId)) {
        await selectWorld(entry.worldId, id);
    } else {
        await renderEntry(id);
    }
}

// ---------------------------------------------------------------------------
// Hierarchy tree (built client-side from the flat entry list)
// ---------------------------------------------------------------------------

function rebuildTree() {
    const roots = [...entriesById.values()]
        .filter(e => e.parentId == null)
        .sort(byNameThenId);
    treeRoots = roots.map(entryToNode);
}

function entryToNode(entry) {
    return {
        kind: 'entry',
        treeId: 'e:' + entry.id,
        id: entry.id,
        icon: typeMeta(entry.type).icon,
        name: entry.name,
        children: groupChildren(entry.id)
    };
}

/** Children of one parent, grouped into synthetic category nodes when more than one type is present. */
function groupChildren(parentId) {
    const children = [...entriesById.values()]
        .filter(e => e.parentId === parentId)
        .sort(byNameThenId);

    if (children.length === 0) return [];

    const byType = new Map();
    children.forEach(c => {
        const key = c.type || 'EMPTY';
        if (!byType.has(key)) byType.set(key, []);
        byType.get(key).push(c);
    });

    if (byType.size === 1) {
        return children.map(entryToNode);
    }

    return ENTRY_TYPES
        .filter(t => byType.has(t.value))
        .map(t => ({
            kind: 'category',
            treeId: 'cat:' + parentId + ':' + t.value,
            icon: t.icon,
            name: t.label,
            children: byType.get(t.value).map(entryToNode)
        }));
}

function findTreePath(nodes, targetTreeId, trail = []) {
    for (const node of nodes) {
        const nextTrail = [...trail, node.treeId];
        if (node.treeId === targetTreeId) return nextTrail;
        if (node.children && node.children.length) {
            const found = findTreePath(node.children, targetTreeId, nextTrail);
            if (found) return found;
        }
    }
    return null;
}

function expandAncestors(id) {
    const path = findTreePath(treeRoots, 'e:' + id);
    if (!path) return;
    path.slice(0, -1).forEach(treeId => collapsedIds.delete(treeId));
}

function toggleCollapsed(treeId) {
    if (collapsedIds.has(treeId)) collapsedIds.delete(treeId);
    else collapsedIds.add(treeId);
    renderTree();
}

function renderTree() {
    const container = document.getElementById('hierarchyTree');
    container.innerHTML = '';

    if (treeRoots.length === 0) {
        container.innerHTML = '<div class="empty-hint">В этом мире пока нет сущностей</div>';
        return;
    }

    treeRoots.forEach(node => container.appendChild(renderTreeNode(node)));
}

function renderTreeNode(node) {
    const hasChildren = node.children && node.children.length > 0;

    const wrapper = document.createElement('div');
    wrapper.className = 'tree-node' + (hasChildren && collapsedIds.has(node.treeId) ? ' collapsed' : '');

    const row = document.createElement('div');
    row.className = 'tree-row' + (node.kind === 'entry' ? ' is-entry' : '');
    if (node.kind === 'entry' && node.id === currentEntryId) {
        row.classList.add('is-selected');
    }

    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle' + (hasChildren ? '' : ' leaf');
    toggle.textContent = '▾';
    row.appendChild(toggle);

    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.textContent = node.icon;
    row.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = node.name;
    row.appendChild(label);

    if (node.kind === 'entry') {
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'tree-row-add';
        addBtn.title = 'Добавить дочернюю сущность';
        addBtn.textContent = '+';
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openEntryModal('create', node.id);
        });
        row.appendChild(addBtn);
    }

    row.addEventListener('click', (e) => {
        if (hasChildren && (e.target === toggle || node.kind === 'category')) {
            toggleCollapsed(node.treeId);
        }
        if (node.kind === 'entry') {
            renderEntry(node.id);
        }
    });

    wrapper.appendChild(row);

    if (hasChildren) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'tree-children';
        node.children.forEach(child => childrenContainer.appendChild(renderTreeNode(child)));
        wrapper.appendChild(childrenContainer);
    }

    return wrapper;
}

// ---------------------------------------------------------------------------
// Rendering an entry
// ---------------------------------------------------------------------------

async function renderEntry(id) {
    currentEntryId = id;
    expandAncestors(id);
    renderTree();

    let entry = entriesById.get(id);
    if (!entry) {
        try {
            entry = await getEntryCached(id);
        } catch (err) {
            showToast('Не удалось загрузить сущность: ' + err.message);
            return;
        }
    }

    const meta = typeMeta(entry.type);
    document.getElementById('entryIcon').textContent = meta.icon;
    document.getElementById('entryName').textContent = entry.name;
    document.getElementById('entrySubtitle').textContent = entry.title || '';

    renderTags(entry, meta);
    renderDescription(entry);
    renderQuickInfo(entry, meta);
    renderNavigation(entry);
    renderNotes(entry);

    let relations = [];
    try {
        relations = await loadRelationsWithTargets(id);
    } catch (err) {
        showToast('Не удалось загрузить связи: ' + err.message);
    }
    renderRelations(relations);
    renderRelated(relations);

    document.getElementById('panel-description').scrollTop = 0;
    document.querySelector('.main-content').scrollTop = 0;

    updateUrl();
}

async function loadRelationsWithTargets(id) {
    const raw = await api(`/api/relations/entry/${id}`);

    return raw.map(r => {
        const meta = typeMeta(r.targetType);
        return {
            id: r.id,
            direction: r.isOutgoing ? 'out' : 'in',
            icon: meta.icon,
            targetId: r.targetId,
            targetName: r.targetName || `#${r.targetId}`,
            targetType: meta.label,
            label: r.relationName
        };
    });
}

function renderTags(entry, meta) {
    const container = document.getElementById('entryTags');
    container.innerHTML = '';

    const tags = [{ label: meta.label, primary: true }];
    const world = worlds.find(w => w.id === entry.worldId);
    if (world) tags.push({ label: world.name, primary: false });
    const parent = entry.parentId != null ? entriesById.get(entry.parentId) : null;
    if (parent) tags.push({ label: parent.name, primary: false });

    tags.forEach(tag => {
        const el = document.createElement('span');
        el.className = 'tag-pill' + (tag.primary ? ' tag-primary' : '');
        el.textContent = tag.label;
        container.appendChild(el);
    });
}

function renderQuickInfo(entry, meta) {
    const container = document.getElementById('quickInfo');
    container.innerHTML = '';

    const parent = entry.parentId != null ? entriesById.get(entry.parentId) : null;
    const world = worlds.find(w => w.id === entry.worldId);

    const rows = [
        { label: 'Тип', value: meta.label },
        { label: 'Мир', value: world ? world.name : '—' },
        { label: 'Родитель', value: parent ? parent.name : '— (корень)', link: parent ? parent.id : null },
        { label: 'ID', value: String(entry.id) }
    ];

    rows.forEach(row => {
        const rowEl = document.createElement('div');
        rowEl.className = 'info-row';

        const label = document.createElement('span');
        label.className = 'info-label';
        label.textContent = row.label;

        const value = document.createElement('span');
        value.className = 'info-value' + (row.link ? ' link' : '');
        value.textContent = row.value;
        if (row.link) {
            value.addEventListener('click', () => goToEntry(row.link));
        }

        rowEl.appendChild(label);
        rowEl.appendChild(value);
        container.appendChild(rowEl);
    });
}

function renderDescription(entry) {
    const container = document.getElementById('descriptionContent');
    container.innerHTML = '';

    const text = (entry.description || '').trim();
    if (!text) {
        container.innerHTML = '<div class="empty-hint">Описание пока не добавлено</div>';
        return;
    }

    text.split(/\n{2,}/).forEach(block => {
        const p = document.createElement('p');
        p.textContent = block;
        p.style.whiteSpace = 'pre-wrap';
        container.appendChild(p);
    });
}

function renderRelations(relations) {
    const container = document.getElementById('relationsContent');
    container.innerHTML = '';

    if (relations.length === 0) {
        container.innerHTML = '<div class="empty-hint">Связи не найдены</div>';
        return;
    }

    relations.forEach(rel => {
        const row = document.createElement('div');
        row.className = 'relation-row';

        const direction = document.createElement('span');
        direction.className = 'relation-direction';
        direction.textContent = rel.direction === 'out' ? '→' : '←';

        const icon = document.createElement('span');
        icon.className = 'relation-icon';
        icon.textContent = rel.icon || '🔹';

        const main = document.createElement('div');
        main.className = 'relation-main';

        const name = document.createElement('div');
        name.className = 'relation-name';
        name.textContent = rel.targetName;

        const type = document.createElement('div');
        type.className = 'relation-type';
        type.textContent = rel.targetType;

        main.appendChild(name);
        main.appendChild(type);

        const label = document.createElement('span');
        label.className = 'relation-label';
        label.textContent = rel.label;

        row.appendChild(direction);
        row.appendChild(icon);
        row.appendChild(main);
        row.appendChild(label);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'relation-delete';
        deleteBtn.title = 'Удалить связь';
        deleteBtn.textContent = '✕';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteRelation(rel.id);
        });
        row.appendChild(deleteBtn);

        row.addEventListener('click', () => goToEntry(rel.targetId));

        container.appendChild(row);
    });
}

async function deleteRelation(relationId) {
    if (relationId == null) return;
    const confirmed = window.confirm('Удалить эту связь?');
    if (!confirmed) return;

    try {
        await api(`/api/relations/${relationId}`, { method: 'DELETE' });
        showToast('Связь удалена');
        if (currentEntryId != null) await renderEntry(currentEntryId);
    } catch (err) {
        showToast('Не удалось удалить связь: ' + err.message);
    }
}

function renderRelated(relations) {
    const container = document.getElementById('relatedEntities');
    container.innerHTML = '';

    if (relations.length === 0) {
        container.innerHTML = '<div class="empty-hint">Нет связанных сущностей</div>';
        return;
    }

    relations.slice(0, 5).forEach(rel => {
        const item = document.createElement('div');
        item.className = 'related-item';

        const icon = document.createElement('span');
        icon.className = 'related-icon';
        icon.textContent = rel.icon || '🔹';

        const main = document.createElement('div');
        main.className = 'related-main';

        const name = document.createElement('div');
        name.className = 'related-name';
        name.textContent = rel.targetName;

        const type = document.createElement('div');
        type.className = 'related-type';
        type.textContent = rel.targetType;

        main.appendChild(name);
        main.appendChild(type);

        const arrow = document.createElement('span');
        arrow.className = 'related-arrow';
        arrow.textContent = '›';

        item.appendChild(icon);
        item.appendChild(main);
        item.appendChild(arrow);

        item.addEventListener('click', () => goToEntry(rel.targetId));

        container.appendChild(item);
    });
}

function renderNotes(entry) {
    const container = document.getElementById('notesContent');
    container.innerHTML = '';

    const notes = notesStore.get(entry.id) || [];
    if (notes.length === 0) {
        container.innerHTML = '<div class="empty-hint">Заметок пока нет</div>';
        return;
    }

    notes.forEach(note => {
        const item = document.createElement('div');
        item.className = 'note-item';

        const meta = document.createElement('div');
        meta.className = 'note-meta';
        meta.innerHTML = `<span>${note.author}</span><span>${note.date}</span>`;

        const text = document.createElement('div');
        text.className = 'note-text';
        text.textContent = note.text;

        item.appendChild(meta);
        item.appendChild(text);
        container.appendChild(item);
    });
}

function renderNavigation(entry) {
    const container = document.getElementById('entryNav');
    container.innerHTML = '';

    const siblings = [...entriesById.values()]
        .filter(e => e.parentId === entry.parentId)
        .sort(byNameThenId);
    const idx = siblings.findIndex(e => e.id === entry.id);
    const prevEntry = idx > 0 ? siblings[idx - 1] : null;
    const nextEntry = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

    const prev = document.createElement('div');
    prev.className = 'nav-item nav-prev' + (prevEntry ? '' : ' disabled');
    prev.innerHTML = `
        <span class="nav-arrow">←</span>
        <div class="nav-main">
            <span class="nav-label">Предыдущая сущность</span>
            <span class="nav-name">${prevEntry ? prevEntry.name : '—'}</span>
        </div>
    `;
    if (prevEntry) {
        prev.addEventListener('click', () => renderEntry(prevEntry.id));
    }

    const next = document.createElement('div');
    next.className = 'nav-item nav-next' + (nextEntry ? '' : ' disabled');
    next.innerHTML = `
        <div class="nav-main">
            <span class="nav-label">Следующая сущность</span>
            <span class="nav-name">${nextEntry ? nextEntry.name : '—'}</span>
        </div>
        <span class="nav-arrow">→</span>
    `;
    if (nextEntry) {
        next.addEventListener('click', () => renderEntry(nextEntry.id));
    }

    container.appendChild(prev);
    container.appendChild(next);
}

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

function renderNoWorldsState() {
    document.getElementById('worldName').textContent = 'Нет миров';
    document.getElementById('hierarchyTree').innerHTML =
        '<div class="empty-hint">Создайте первый мир, чтобы начать</div>';

    document.getElementById('entryIcon').textContent = '🌐';
    document.getElementById('entryName').textContent = '—';
    document.getElementById('entrySubtitle').textContent = '';
    document.getElementById('entryTags').innerHTML = '';
    document.getElementById('descriptionContent').innerHTML =
        '<div class="empty-hint">Сначала создайте мир — переключатель миров в верхней панели.</div>';
    document.getElementById('relationsContent').innerHTML = '';
    document.getElementById('notesContent').innerHTML = '';
    document.getElementById('quickInfo').innerHTML = '';
    document.getElementById('relatedEntities').innerHTML = '';
    document.getElementById('entryNav').innerHTML = '';
}

function renderEmptyEntryState() {
    currentEntryId = null;

    document.getElementById('entryIcon').textContent = '❔';
    document.getElementById('entryName').textContent = '—';
    document.getElementById('entrySubtitle').textContent = '';
    document.getElementById('entryTags').innerHTML = '';
    document.getElementById('descriptionContent').innerHTML =
        '<div class="empty-hint">В этом мире пока нет сущностей. Нажмите «+» в левой панели, чтобы создать первую.</div>';
    document.getElementById('relationsContent').innerHTML = '';
    document.getElementById('notesContent').innerHTML = '';
    document.getElementById('quickInfo').innerHTML = '';
    document.getElementById('relatedEntities').innerHTML = '';
    document.getElementById('entryNav').innerHTML = '';

    updateUrl();
}

// ---------------------------------------------------------------------------
// URL sync ("copy link")
// ---------------------------------------------------------------------------

function updateUrl() {
    const params = new URLSearchParams();
    if (currentWorldId) params.set('world', currentWorldId);
    if (currentEntryId) params.set('entry', currentEntryId);
    const query = params.toString();
    history.replaceState(null, '', query ? `?${query}` : location.pathname);
}

// ---------------------------------------------------------------------------
// World switcher dropdown
// ---------------------------------------------------------------------------

function renderWorldDropdown() {
    const dropdown = document.getElementById('worldDropdown');
    dropdown.innerHTML = '';

    worlds.forEach(w => {
        const item = document.createElement('div');
        item.className = 'world-dropdown-item' + (w.id === currentWorldId ? ' active' : '');
        item.textContent = w.name;
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            closeWorldDropdown();
            if (w.id !== currentWorldId) await selectWorld(w.id);
        });
        dropdown.appendChild(item);
    });

    const createItem = document.createElement('div');
    createItem.className = 'world-dropdown-create';
    createItem.textContent = '+ Создать мир';
    createItem.addEventListener('click', (e) => {
        e.stopPropagation();
        closeWorldDropdown();
        openWorldModal();
    });
    dropdown.appendChild(createItem);
}

function toggleWorldDropdown() {
    renderWorldDropdown();
    document.getElementById('worldDropdown').hidden = !document.getElementById('worldDropdown').hidden;
}

function closeWorldDropdown() {
    document.getElementById('worldDropdown').hidden = true;
}

// ---------------------------------------------------------------------------
// Create / edit entry modal
// ---------------------------------------------------------------------------

function descendantIdsOf(id) {
    const result = new Set();
    const stack = [id];
    while (stack.length) {
        const current = stack.pop();
        [...entriesById.values()].filter(e => e.parentId === current).forEach(child => {
            if (!result.has(child.id)) {
                result.add(child.id);
                stack.push(child.id);
            }
        });
    }
    return result;
}

function flattenEntriesForSelect() {
    const out = [];
    function walk(nodes, depth) {
        nodes.forEach(node => {
            if (node.kind === 'entry') {
                out.push({ entry: entriesById.get(node.id), depth });
                walk(node.children || [], depth + 1);
            } else {
                walk(node.children || [], depth);
            }
        });
    }
    walk(treeRoots, 0);
    return out;
}

function populateTypeSelect() {
    const select = document.getElementById('entryFieldType');
    select.innerHTML = '';
    ENTRY_TYPES.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.value;
        opt.textContent = `${t.icon} ${t.label}`;
        select.appendChild(opt);
    });
}

function populateParentSelect(editingId) {
    const select = document.getElementById('entryFieldParent');
    select.innerHTML = '';

    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '— Нет (корень) —';
    select.appendChild(noneOpt);

    const excluded = editingId != null ? descendantIdsOf(editingId) : new Set();
    if (editingId != null) excluded.add(editingId);

    flattenEntriesForSelect().forEach(({ entry, depth }) => {
        if (excluded.has(entry.id)) return;
        const opt = document.createElement('option');
        opt.value = String(entry.id);
        opt.textContent = (depth ? '—'.repeat(depth) + ' ' : '') + entry.name;
        select.appendChild(opt);
    });
}

function openEntryModal(mode, contextId) {
    if (!currentWorldId) {
        showToast('Сначала создайте или выберите мир');
        return;
    }

    entryModalMode = mode;
    entryModalEditingId = mode === 'edit' ? contextId : null;

    populateTypeSelect();
    populateParentSelect(mode === 'edit' ? contextId : null);

    const nameInput = document.getElementById('entryFieldName');
    const titleInput = document.getElementById('entryFieldTitle');
    const typeSelect = document.getElementById('entryFieldType');
    const parentSelect = document.getElementById('entryFieldParent');
    const descInput = document.getElementById('entryFieldDescription');
    const errorBox = document.getElementById('entryFieldError');
    errorBox.hidden = true;
    errorBox.textContent = '';

    if (mode === 'edit') {
        const entry = entriesById.get(contextId);
        document.getElementById('entryModalTitle').textContent = 'Редактировать сущность';
        document.getElementById('entryModalSubmitBtn').textContent = 'Сохранить';
        nameInput.value = entry.name || '';
        titleInput.value = entry.title || '';
        typeSelect.value = entry.type || 'EMPTY';
        parentSelect.value = entry.parentId != null ? String(entry.parentId) : '';
        descInput.value = entry.description || '';
    } else {
        document.getElementById('entryModalTitle').textContent = 'Создать сущность';
        document.getElementById('entryModalSubmitBtn').textContent = 'Создать';
        nameInput.value = '';
        titleInput.value = '';
        typeSelect.value = 'EMPTY';
        parentSelect.value = contextId != null ? String(contextId) : '';
        descInput.value = '';
    }

    document.getElementById('entryModalOverlay').hidden = false;
    nameInput.focus();
}

function closeEntryModal() {
    document.getElementById('entryModalOverlay').hidden = true;
}

/**
 * Closes every open pop-up: both known modals plus, generically, any other
 * `.modal-overlay` a future feature adds (so this doesn't need updating per
 * modal), and the world switcher dropdown. Used by the Escape key and can be
 * reused anywhere "close whatever is open" is needed.
 */
function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.hidden = true;
    });
    closeWorldDropdown();
}

function bindEntryModal() {
    document.getElementById('entryModalCloseBtn').addEventListener('click', closeEntryModal);
    document.getElementById('entryModalCancelBtn').addEventListener('click', closeEntryModal);
    document.getElementById('entryModalOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeEntryModal();
    });

    document.getElementById('entryModalForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const errorBox = document.getElementById('entryFieldError');
        errorBox.hidden = true;

        const name = document.getElementById('entryFieldName').value.trim();
        const title = document.getElementById('entryFieldTitle').value.trim();
        const type = document.getElementById('entryFieldType').value;
        const parentRaw = document.getElementById('entryFieldParent').value;
        const description = document.getElementById('entryFieldDescription').value.trim();

        if (entryModalMode === 'edit') {
            const original = entriesById.get(entryModalEditingId);
            if (original && original.parentId != null && parentRaw === '') {
                errorBox.textContent = 'Бэкенд пока не умеет снова делать сущность корневой через обновление ' +
                    '(см. docs/entry-view-missing-features.md). Выберите родителя или пересоздайте сущность.';
                errorBox.hidden = false;
                return;
            }
        }

        const payload = {
            name,
            title,
            description,
            type,
            parentId: parentRaw ? Number(parentRaw) : null,
            worldId: currentWorldId
        };

        const submitBtn = document.getElementById('entryModalSubmitBtn');
        submitBtn.disabled = true;
        try {
            let saved;
            if (entryModalMode === 'edit') {
                saved = await api(`/api/entry/update/${entryModalEditingId}`, { method: 'POST', body: payload });
                showToast(`Сущность «${saved.name}» обновлена`);
            } else {
                saved = await api('/api/entry/create', { method: 'POST', body: payload });
                showToast(`Сущность «${saved.name}» создана`);
            }
            entryCache.set(saved.id, saved);
            closeEntryModal();
            await loadEntries();
            await renderEntry(saved.id);
        } catch (err) {
            errorBox.textContent = err.message;
            errorBox.hidden = false;
        } finally {
            submitBtn.disabled = false;
        }
    });
}

// ---------------------------------------------------------------------------
// Create world modal
// ---------------------------------------------------------------------------

function openWorldModal() {
    document.getElementById('worldFieldName').value = '';
    document.getElementById('worldFieldError').hidden = true;
    document.getElementById('worldModalOverlay').hidden = false;
    document.getElementById('worldFieldName').focus();
}

function closeWorldModal() {
    document.getElementById('worldModalOverlay').hidden = true;
}

function bindWorldModal() {
    document.getElementById('worldModalCloseBtn').addEventListener('click', closeWorldModal);
    document.getElementById('worldModalCancelBtn').addEventListener('click', closeWorldModal);
    document.getElementById('worldModalOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeWorldModal();
    });

    document.getElementById('worldModalForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const errorBox = document.getElementById('worldFieldError');
        errorBox.hidden = true;
        const name = document.getElementById('worldFieldName').value.trim();

        try {
            const created = await api('/api/worlds/create', { method: 'POST', body: { name } });
            closeWorldModal();
            showToast(`Мир «${created.name}» создан`);
            worlds = await api('/api/worlds');
            await selectWorld(created.id);
        } catch (err) {
            errorBox.textContent = err.message;
            errorBox.hidden = false;
        }
    });
}

// ---------------------------------------------------------------------------
// Create relation modal
// ---------------------------------------------------------------------------

async function loadRelationDefinitions() {
    relationDefinitions = await api('/api/relations/definitions');
    return relationDefinitions;
}

function populateRelationTargetSelect() {
    const select = document.getElementById('relationFieldTarget');
    select.innerHTML = '';

    [...entriesById.values()]
        .filter(e => e.id !== currentEntryId)
        .sort(byNameThenId)
        .forEach(entry => {
            const opt = document.createElement('option');
            opt.value = String(entry.id);
            opt.textContent = `${typeMeta(entry.type).icon} ${entry.name}`;
            select.appendChild(opt);
        });
}

function populateRelationDefinitionSelect() {
    const select = document.getElementById('relationFieldDefinition');
    select.innerHTML = '';

    relationDefinitions.forEach(def => {
        const opt = document.createElement('option');
        opt.value = String(def.id);
        opt.textContent = `${def.name} / ${def.reverseName}`;
        select.appendChild(opt);
    });
}

async function openRelationModal() {
    if (!currentEntryId) {
        showToast('Сначала выберите сущность');
        return;
    }

    const errorBox = document.getElementById('relationFieldError');
    errorBox.hidden = true;
    errorBox.textContent = '';

    document.getElementById('relationNewDefinitionFields').hidden = true;
    document.getElementById('relationFieldDefName').value = '';
    document.getElementById('relationFieldDefReverseName').value = '';

    populateRelationTargetSelect();

    if (relationDefinitions.length === 0) {
        try {
            await loadRelationDefinitions();
        } catch (err) {
            showToast('Не удалось загрузить типы связей: ' + err.message);
        }
    }
    populateRelationDefinitionSelect();

    const definitionField = document.getElementById('relationFieldDefinition');
    definitionField.disabled = relationDefinitions.length === 0;
    if (relationDefinitions.length === 0) {
        document.getElementById('relationNewDefinitionFields').hidden = false;
    }

    document.getElementById('relationModalOverlay').hidden = false;
}

function closeRelationModal() {
    document.getElementById('relationModalOverlay').hidden = true;
}

function bindRelationModal() {
    document.getElementById('addRelationBtn').addEventListener('click', openRelationModal);
    document.getElementById('qaAddRelation').addEventListener('click', openRelationModal);

    document.getElementById('relationModalCloseBtn').addEventListener('click', closeRelationModal);
    document.getElementById('relationModalCancelBtn').addEventListener('click', closeRelationModal);
    document.getElementById('relationModalOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeRelationModal();
    });

    document.getElementById('relationNewDefinitionToggle').addEventListener('click', () => {
        const fields = document.getElementById('relationNewDefinitionFields');
        fields.hidden = !fields.hidden;
    });

    document.getElementById('relationModalForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const errorBox = document.getElementById('relationFieldError');
        errorBox.hidden = true;

        const targetId = Number(document.getElementById('relationFieldTarget').value);
        const newFieldsVisible = !document.getElementById('relationNewDefinitionFields').hidden;
        const defName = document.getElementById('relationFieldDefName').value.trim();
        const defReverseName = document.getElementById('relationFieldDefReverseName').value.trim();

        if (!targetId) {
            errorBox.textContent = 'Сначала создайте другую сущность, чтобы связать её с текущей.';
            errorBox.hidden = false;
            return;
        }

        const submitBtn = document.getElementById('relationModalSubmitBtn');
        submitBtn.disabled = true;
        try {
            let relationDefinitionId;

            if (newFieldsVisible && (defName || defReverseName)) {
                if (!defName || !defReverseName) {
                    errorBox.textContent = 'Укажите оба названия — прямое и обратное.';
                    errorBox.hidden = false;
                    return;
                }
                const definition = await api('/api/relations/definitions', {
                    method: 'POST',
                    body: { name: defName, reverseName: defReverseName }
                });
                relationDefinitions.push(definition);
                relationDefinitionId = definition.id;
            } else {
                relationDefinitionId = Number(document.getElementById('relationFieldDefinition').value);
                if (!relationDefinitionId) {
                    errorBox.textContent = 'Выберите тип связи или создайте новый.';
                    errorBox.hidden = false;
                    return;
                }
            }

            await api('/api/relations', {
                method: 'POST',
                body: { sourceId: currentEntryId, targetId, relationDefinitionId }
            });

            closeRelationModal();
            showToast('Связь добавлена');
            await renderEntry(currentEntryId);
        } catch (err) {
            errorBox.textContent = err.message;
            errorBox.hidden = false;
        } finally {
            submitBtn.disabled = false;
        }
    });
}

// ---------------------------------------------------------------------------
// Delete entry
// ---------------------------------------------------------------------------

async function deleteCurrentEntry() {
    if (!currentEntryId) {
        showToast('Сначала выберите сущность');
        return;
    }

    const entry = entriesById.get(currentEntryId);
    if (!entry) return;

    const confirmed = window.confirm(`Удалить «${entry.name}»? Дочерние сущности станут корневыми.`);
    if (!confirmed) return;

    try {
        await api(`/api/entry/${entry.id}`, { method: 'DELETE' });
        entryCache.delete(entry.id);
        showToast(`Сущность «${entry.name}» удалена`);

        await loadEntries();
        const remaining = [...entriesById.values()];
        if (remaining.length === 0) {
            renderTree();
            renderEmptyEntryState();
        } else {
            const next = entry.parentId != null && entriesById.has(entry.parentId)
                ? entry.parentId
                : remaining.sort(byNameThenId)[0].id;
            await renderEntry(next);
        }
    } catch (err) {
        showToast('Не удалось удалить: ' + err.message);
    }
}

// ---------------------------------------------------------------------------
// Static / cosmetic controls
// ---------------------------------------------------------------------------

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('visible'), 2200);
}

function bindStaticControls() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
        });
    });

    document.getElementById('themeToggle').addEventListener('click', () => {
        const root = document.documentElement;
        const isLight = root.getAttribute('data-theme') === 'light';
        root.setAttribute('data-theme', isLight ? 'dark' : 'light');
        document.getElementById('themeToggle').textContent = isLight ? '☀' : '☾';
    });

    document.getElementById('backBtn').addEventListener('click', () => history.back());

    document.getElementById('notifBtn').addEventListener('click', () => showToast('Уведомления: пока нет новых событий'));
    document.getElementById('userBtn').addEventListener('click', () => showToast('Профиль пользователя — раздел в разработке'));

    document.getElementById('worldSwitcher').addEventListener('click', (e) => {
        e.stopPropagation();
        if (worlds.length === 0) {
            openWorldModal();
            return;
        }
        toggleWorldDropdown();
    });
    document.addEventListener('click', () => closeWorldDropdown());
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllModals();
    });

    document.getElementById('refreshTreeBtn').addEventListener('click', async () => {
        if (!currentWorldId) return;
        try {
            await loadEntries();
            renderTree();
            showToast('Иерархия обновлена');
        } catch (err) {
            showToast('Не удалось обновить иерархию: ' + err.message);
        }
    });

    document.getElementById('addEntryBtn').addEventListener('click', () => openEntryModal('create', currentEntryId));
    document.querySelector('[title="Мои сущности"]').addEventListener('click', () => showToast('Мои сущности — раздел в разработке (нет модели пользователя)'));

    document.getElementById('editEntryBtn').addEventListener('click', () => {
        if (!currentEntryId) { showToast('Сначала выберите сущность'); return; }
        openEntryModal('edit', currentEntryId);
    });
    document.getElementById('deleteEntryBtn').addEventListener('click', deleteCurrentEntry);
    document.getElementById('copyLinkBtn').addEventListener('click', async () => {
        if (!currentEntryId) { showToast('Сначала выберите сущность'); return; }
        try {
            await navigator.clipboard.writeText(location.href);
            showToast('Ссылка скопирована');
        } catch {
            showToast(location.href);
        }
    });

    document.getElementById('qaEdit').addEventListener('click', () => {
        if (!currentEntryId) { showToast('Сначала выберите сущность'); return; }
        openEntryModal('edit', currentEntryId);
    });
    document.getElementById('qaCreateRelated').addEventListener('click', () => {
        if (!currentEntryId) { showToast('Сначала выберите сущность'); return; }
        openEntryModal('create', currentEntryId);
    });
    document.getElementById('qaDelete').addEventListener('click', deleteCurrentEntry);
    document.getElementById('qaAddNote').addEventListener('click', () => {
        document.querySelector('[data-tab="notes"]').click();
        document.getElementById('noteInput').focus();
    });

    document.getElementById('searchInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.value.trim()) {
            showToast(`Поиск «${e.target.value.trim()}» — раздел в разработке (нет API поиска)`);
        }
    });

    document.getElementById('noteForm').addEventListener('submit', (e) => {
        e.preventDefault();
        if (!currentEntryId) return;

        const input = document.getElementById('noteInput');
        const text = input.value.trim();
        if (!text) return;

        const notes = notesStore.get(currentEntryId) || [];
        notes.unshift({
            author: 'Вы',
            date: new Date().toLocaleDateString('ru-RU'),
            text
        });
        notesStore.set(currentEntryId, notes);

        renderNotes(entriesById.get(currentEntryId));
        input.value = '';
        showToast('Заметка добавлена (только локально — заметок пока нет на бэкенде)');
    });
}
