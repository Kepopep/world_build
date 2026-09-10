/**
 * Relation Graph page.
 *
 * Visual language mirrors entry-view.{html,css}: dark card UI, gold accent,
 * modals/toast/world-switcher components reused verbatim. Unlike the old
 * version there are no always-visible creation forms — every mutation
 * (create/edit/delete entity, create/delete relation) is reached through a
 * right-click context menu on a node, an edge, or empty canvas.
 *
 * Relationship creation is dynamic: "Создать связь" on a node's context menu
 * arms "linking mode" — a dashed preview arrow follows the cursor from that
 * node. Clicking a second node opens a small modal to pick the relation
 * type, then POSTs /api/relations and reloads the graph.
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
let currentWorldFilter = null; // null = "all worlds"

let fullGraphData = { nodes: [], edges: [] };  // raw /api/graph/all
let viewGraphData = { nodes: [], edges: [] };  // after world filter / neighborhood

let neighborhoodCenterId = null;
let neighborhoodDepth = 2;

let relationDefinitions = [];

let svg = null;
let g = null;
let simulation = null;
let physicsEnabled = true;
let selectedNodeId = null;

// Linking mode ("create relationship" via right-click node -> click target)
let linkSource = null;      // node datum
let linkPreviewLine = null; // d3 selection

// Pending relation waiting on the relation-type modal
let pendingRelation = null; // { sourceId, sourceLabel, targetId, targetLabel }

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

function byTitleThenId(a, b) {
    return a.title.localeCompare(b.title, 'ru') || a.id - b.id;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    setupSVG();
    bindStaticControls();
    bindEntryModal();
    bindWorldModal();
    bindRelationModal();
    bindContextMenu();
    init();
});

async function init() {
    try {
        worlds = await api('/api/worlds');
    } catch (err) {
        showToast('Не удалось загрузить список миров: ' + err.message);
    }
    await loadGraph();
}

// ---------------------------------------------------------------------------
// SVG / D3 setup
// ---------------------------------------------------------------------------

function setupSVG() {
    const container = document.getElementById('graphContainer');
    container.innerHTML = '';

    const width = container.clientWidth;
    const height = container.clientHeight;

    svg = d3.select('#graphContainer')
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    const defs = svg.append('defs');

    defs.append('marker')
        .attr('id', 'arrowhead-default')
        .attr('markerWidth', 8)
        .attr('markerHeight', 8)
        .attr('refX', 18)
        .attr('refY', 4)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M 0 0 L 8 4 L 0 8 Z')
        .attr('fill', 'var(--text-faint)');

    defs.append('marker')
        .attr('id', 'arrowhead-active')
        .attr('markerWidth', 8)
        .attr('markerHeight', 8)
        .attr('refX', 18)
        .attr('refY', 4)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M 0 0 L 8 4 L 0 8 Z')
        .attr('fill', 'var(--accent)');

    const zoom = d3.zoom()
        .scaleExtent([0.15, 3])
        .on('zoom', (event) => {
            g.attr('transform', event.transform);
        });

    svg.call(zoom);
    svg.on('dblclick.zoom', null);

    g = svg.append('g');

    svg.on('contextmenu', (event) => {
        if (event.target.tagName !== 'svg') return;
        event.preventDefault();
        if (linkSource) { cancelLinking(); return; }
        openCanvasContextMenu(event);
    });

    svg.on('click', (event) => {
        if (event.target.tagName !== 'svg') return;
        closeContextMenu();
        if (linkSource) { cancelLinking(); return; }
        clearSelection();
    });

    svg.on('mousemove', (event) => {
        if (!linkSource) return;
        const [mx, my] = d3.pointer(event, g.node());
        updateLinkPreview(mx, my);
    });

    svg.__zoom = zoom;
}

// ---------------------------------------------------------------------------
// Loading & filtering graph data
// ---------------------------------------------------------------------------

async function loadGraph() {
    const container = document.getElementById('graphContainer');

    if (fullGraphData.nodes.length === 0) {
        container.innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                Загрузка графа...
            </div>
        `;
    }

    try {
        fullGraphData = await api('/api/graph/all');
        if (container.querySelector('.loading')) {
            setupSVG();
        }
        applyFilters();
        document.getElementById('stats').style.display = 'flex';
    } catch (error) {
        container.innerHTML = `
            <div class="loading" style="color: var(--danger);">
                Ошибка загрузки графа: ${error.message}
            </div>
        `;
    }
}

function applyFilters() {
    let nodes = fullGraphData.nodes;
    let edges = fullGraphData.edges;

    if (neighborhoodCenterId != null) {
        const result = computeNeighborhood(nodes, edges, neighborhoodCenterId, neighborhoodDepth);
        nodes = result.nodes;
        edges = result.edges;
    } else if (currentWorldFilter != null) {
        const idsInWorld = new Set(nodes.filter(n => n.worldId === currentWorldFilter).map(n => n.id));
        nodes = nodes.filter(n => idsInWorld.has(n.id));
        edges = edges.filter(e => idsInWorld.has(e.source) && idsInWorld.has(e.target));
    }

    // d3 mutates edge.source/target in place; work on fresh copies each render.
    viewGraphData = {
        nodes: nodes.map(n => ({ ...n })),
        edges: edges.map(e => ({ ...e }))
    };

    renderGraph();
    updateStats();
    renderNeighborhoodChip();
}

function computeNeighborhood(nodes, edges, centerId, depth) {
    const connected = new Set([centerId]);
    let frontier = new Set([centerId]);

    for (let i = 0; i < depth; i++) {
        const next = new Set();
        edges.forEach(e => {
            if (frontier.has(e.source) && !connected.has(e.target)) next.add(e.target);
            if (frontier.has(e.target) && !connected.has(e.source)) next.add(e.source);
        });
        next.forEach(id => connected.add(id));
        frontier = next;
        if (frontier.size === 0) break;
    }

    return {
        nodes: nodes.filter(n => connected.has(n.id)),
        edges: edges.filter(e => connected.has(e.source) && connected.has(e.target))
    };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const NODE_WIDTH = 168;
const NODE_HEIGHT = 84;

function renderGraph() {
    const width = document.getElementById('graphContainer').clientWidth;
    const height = document.getElementById('graphContainer').clientHeight;

    g.selectAll('*').remove();
    if (simulation) simulation.stop();

    const data = viewGraphData;

    simulation = d3.forceSimulation(data.nodes)
        .force('link', d3.forceLink(data.edges).id(d => d.id).distance(170))
        .force('charge', d3.forceManyBody().strength(-550))
        .force('collide', d3.forceCollide().radius(110))
        .force('center', d3.forceCenter(width / 2, height / 2));

    if (!physicsEnabled) simulation.stop();

    const links = g.selectAll('.link-group')
        .data(data.edges)
        .enter()
        .append('g')
        .attr('class', 'link-group');

    links.append('line')
        .attr('class', 'link-background')
        .attr('stroke-width', 10);

    links.append('line')
        .attr('class', 'link')
        .attr('marker-end', 'url(#arrowhead-default)');

    const labelGroups = links.append('g')
        .attr('class', 'link-label-group')
        .style('pointer-events', 'none');

    labelGroups.append('rect')
        .attr('class', 'link-label-bg')
        .attr('rx', 4)
        .attr('ry', 3);

    labelGroups.append('text')
        .attr('class', 'link-label')
        .attr('dy', -8)
        .attr('text-anchor', 'middle');

    links.on('mouseenter', function (event, d) {
        d3.select(this).classed('link-hover', true);
        const tooltip = document.getElementById('tooltip');
        tooltip.innerHTML = `<strong>${d.relationName}</strong><br><small>${d.source.title || d.source} → ${d.target.title || d.target}</small>`;
        tooltip.classList.add('visible');
        tooltip.style.left = event.clientX + 12 + 'px';
        tooltip.style.top = event.clientY + 12 + 'px';
    });

    links.on('mouseleave', function () {
        d3.select(this).classed('link-hover', false);
        hideTooltip();
    });

    links.on('contextmenu', (event, d) => {
        event.preventDefault();
        event.stopPropagation();
        openEdgeContextMenu(event, d);
    });

    const nodes = g.selectAll('.node')
        .data(data.nodes)
        .enter()
        .append('g')
        .attr('class', 'node')
        .call(
            d3.drag()
                .on('start', dragStarted)
                .on('drag', dragged)
                .on('end', dragEnded)
        );

    nodes.append('rect')
        .attr('width', NODE_WIDTH)
        .attr('height', NODE_HEIGHT)
        .attr('x', -NODE_WIDTH / 2)
        .attr('y', -NODE_HEIGHT / 2);

    nodes.append('text')
        .attr('class', 'type-icon')
        .attr('y', -22)
        .text(d => typeMeta(d.type).icon);

    nodes.append('text')
        .attr('class', 'title')
        .attr('y', 4)
        .text(d => truncate(d.title, 20));

    nodes.append('text')
        .attr('class', 'description')
        .attr('y', 24)
        .text(d => truncate(d.description, 26));

    nodes.on('click', (event, d) => {
        event.stopPropagation();
        closeContextMenu();
        if (linkSource) {
            finishLinking(d);
            return;
        }
        selectedNodeId = (selectedNodeId === d.id) ? null : d.id;
        highlightSelection();
        showTooltip(event, d);
    });

    nodes.on('dblclick', (event, d) => {
        event.stopPropagation();
        openInEntryView(d.id);
    });

    nodes.on('mouseenter', (event, d) => {
        if (!linkSource) showTooltip(event, d);
        d3.select(event.currentTarget).classed('active', true);
    });

    nodes.on('mousemove', (event) => {
        if (linkSource) return;
        const tooltip = document.getElementById('tooltip');
        tooltip.style.left = event.clientX + 12 + 'px';
        tooltip.style.top = event.clientY + 12 + 'px';
    });

    nodes.on('mouseleave', (event) => {
        hideTooltip();
        d3.select(event.currentTarget).classed('active', false);
    });

    nodes.on('contextmenu', (event, d) => {
        event.preventDefault();
        event.stopPropagation();
        if (linkSource) { cancelLinking(); return; }
        openNodeContextMenu(event, d);
    });

    simulation.on('tick', () => {
        g.selectAll('.link-group line')
            .attr('x1', d => calculateLineEndpoint(d.source, d.target, true).x)
            .attr('y1', d => calculateLineEndpoint(d.source, d.target, true).y)
            .attr('x2', d => calculateLineEndpoint(d.source, d.target, false).x)
            .attr('y2', d => calculateLineEndpoint(d.source, d.target, false).y);

        g.selectAll('.link-label-group')
            .attr('transform', d => {
                const start = calculateLineEndpoint(d.source, d.target, true);
                const end = calculateLineEndpoint(d.source, d.target, false);
                return `translate(${(start.x + end.x) / 2},${(start.y + end.y) / 2})`;
            });

        g.selectAll('.link-label-bg').each(function () {
            const text = d3.select(this.parentNode).select('text');
            const bbox = text.node().getBBox();
            d3.select(this)
                .attr('x', bbox.x - 4)
                .attr('y', bbox.y - 2)
                .attr('width', bbox.width + 8)
                .attr('height', bbox.height + 4);
        });

        g.selectAll('.node').attr('transform', d => `translate(${d.x},${d.y})`);
    });

    highlightSelection();
}

function truncate(text, max) {
    const s = text || '';
    return s.length > max ? s.substring(0, max - 3) + '...' : s;
}

function calculateLineEndpoint(source, target, isSource) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance === 0) return isSource ? source : target;

    const angle = Math.atan2(dy, dx);
    const halfWidth = NODE_WIDTH / 2;
    const halfHeight = NODE_HEIGHT / 2;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    let distToEdge;
    if (Math.abs(cosA) > 0) distToEdge = halfWidth / Math.abs(cosA);
    if (Math.abs(sinA) > 0) {
        const distY = halfHeight / Math.abs(sinA);
        if (distToEdge === undefined || distY < distToEdge) distToEdge = distY;
    }

    const offset = distToEdge || 70;
    const node = isSource ? source : target;
    // Source clips toward the target (+cosA/sinA, the source->target direction);
    // target clips back toward the source (-cosA/sinA) — i.e. each endpoint sits
    // on the near edge facing the other node, not the far edge.
    return {
        x: node.x + (isSource ? 1 : -1) * cosA * offset,
        y: node.y + (isSource ? 1 : -1) * sinA * offset
    };
}

function highlightSelection() {
    g.selectAll('.node').classed('selected', d => d.id === selectedNodeId);
    g.selectAll('.link').classed('active', d =>
        selectedNodeId != null && (d.source.id === selectedNodeId || d.target.id === selectedNodeId));
    updateLinkLabels();
}

// Relationship text stays hidden until the entity at one end of it is
// selected. An outgoing edge (selected node is the source) shows the
// relation's forward name; an incoming edge (selected node is the target)
// shows the reverse name — mirrors how entry-view traverses edges from the
// target's side.
function updateLinkLabels() {
    g.selectAll('.link-label-group').each(function (d) {
        const group = d3.select(this);
        const outgoing = selectedNodeId != null && d.source.id === selectedNodeId;
        const incoming = selectedNodeId != null && d.target.id === selectedNodeId;
        const visible = outgoing || incoming;

        group.classed('visible', visible);
        group.select('.link-label').text(visible ? (outgoing ? d.relationName : d.reverseRelationName) : '');
    });
}

function clearSelection() {
    selectedNodeId = null;
    highlightSelection();
}

function showTooltip(event, d) {
    const tooltip = document.getElementById('tooltip');
    const meta = typeMeta(d.type);
    tooltip.innerHTML = `
        <strong>${meta.icon} ${d.title}</strong><br>
        ${d.description || ''}<br>
        <small style="opacity:0.7;">${meta.label} · ID ${d.id}</small>
    `;
    tooltip.classList.add('visible');
    tooltip.style.left = event.clientX + 12 + 'px';
    tooltip.style.top = event.clientY + 12 + 'px';
}

function hideTooltip() {
    document.getElementById('tooltip').classList.remove('visible');
}

function dragStarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

function dragEnded(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    if (!event.sourceEvent.shiftKey) {
        d.fx = null;
        d.fy = null;
    }
}

function updateStats() {
    document.getElementById('statEntries').textContent = viewGraphData.nodes.length;
    document.getElementById('statRelations').textContent = viewGraphData.edges.length;
    const avg = viewGraphData.nodes.length
        ? (2 * viewGraphData.edges.length / viewGraphData.nodes.length).toFixed(2)
        : '0';
    document.getElementById('statAvgDegree').textContent = avg;
}

// ---------------------------------------------------------------------------
// Linking mode (dynamic relationship creation)
// ---------------------------------------------------------------------------

function startLinking(sourceNode) {
    linkSource = sourceNode;
    if (simulation) simulation.stop(); // freeze layout so the preview arrow stays accurate
    svg.classed('linking-mode', true);
    g.selectAll('.node').classed('link-source', d => d.id === sourceNode.id);
    document.getElementById('linkHint').classList.add('visible');

    linkPreviewLine = g.append('line')
        .attr('class', 'link-preview')
        .attr('x1', sourceNode.x)
        .attr('y1', sourceNode.y)
        .attr('x2', sourceNode.x)
        .attr('y2', sourceNode.y);
}

function updateLinkPreview(mx, my) {
    if (!linkPreviewLine || !linkSource) return;
    // Clip the start point to the source node's edge (like a real link);
    // the end point just follows the cursor directly.
    const start = calculateLineEndpoint(linkSource, { x: mx, y: my }, true);
    linkPreviewLine
        .attr('x1', start.x)
        .attr('y1', start.y)
        .attr('x2', mx)
        .attr('y2', my);
}

function finishLinking(targetNode) {
    if (!linkSource) return;

    if (targetNode.id === linkSource.id) {
        showToast('Нельзя создать связь сущности с самой собой');
        return;
    }

    const source = linkSource;
    cancelLinking();
    openRelationTypeModal(source, targetNode);
}

function cancelLinking() {
    linkSource = null;
    svg.classed('linking-mode', false);
    g.selectAll('.node').classed('link-source', false);
    document.getElementById('linkHint').classList.remove('visible');
    if (linkPreviewLine) {
        linkPreviewLine.remove();
        linkPreviewLine = null;
    }
    if (simulation && physicsEnabled) simulation.alpha(0.3).restart();
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

function bindContextMenu() {
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('contextMenu');
        if (!menu.hidden && !menu.contains(e.target)) closeContextMenu();
    });
    window.addEventListener('resize', closeContextMenu);
    window.addEventListener('scroll', closeContextMenu, true);
}

function closeContextMenu() {
    document.getElementById('contextMenu').hidden = true;
}

function showContextMenu(event, items) {
    const menu = document.getElementById('contextMenu');
    menu.innerHTML = '';

    items.forEach(item => {
        if (item.separator) {
            const sep = document.createElement('div');
            sep.className = 'context-menu-sep';
            menu.appendChild(sep);
            return;
        }
        if (item.label && !item.action) {
            const label = document.createElement('div');
            label.className = 'context-menu-label';
            label.textContent = item.label;
            menu.appendChild(label);
            return;
        }

        const el = document.createElement('div');
        el.className = 'context-menu-item' + (item.danger ? ' danger' : '') + (item.accent ? ' accent' : '');
        el.textContent = item.icon ? `${item.icon} ${item.label}` : item.label;
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            closeContextMenu();
            item.action();
        });
        menu.appendChild(el);
    });

    menu.hidden = false;
    const { innerWidth, innerHeight } = window;
    let left = event.clientX;
    let top = event.clientY;
    const rect = menu.getBoundingClientRect();
    if (left + rect.width > innerWidth - 8) left = innerWidth - rect.width - 8;
    if (top + rect.height > innerHeight - 8) top = innerHeight - rect.height - 8;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
}

function openNodeContextMenu(event, d) {
    const meta = typeMeta(d.type);
    showContextMenu(event, [
        { label: `${meta.icon} ${d.title}` },
        { icon: '🔗', label: 'Создать связь', accent: true, action: () => startLinking(d) },
        { separator: true },
        { icon: '↗', label: 'Открыть в редакторе', action: () => openInEntryView(d.id) },
        { icon: '➕', label: 'Добавить дочернюю сущность', action: () => openEntryModal('create', { parentId: d.id, worldId: d.worldId }) },
        { icon: '✎', label: 'Редактировать', action: () => openEntryModal('edit', { editingId: d.id }) },
        { icon: '🔎', label: 'Показать окружение', action: () => setNeighborhood(d.id) },
        { separator: true },
        { icon: '🗑', label: 'Удалить сущность', danger: true, action: () => deleteEntry(d) }
    ]);
}

function openEdgeContextMenu(event, d) {
    showContextMenu(event, [
        { label: `${d.source.title || ''} → ${d.target.title || ''} («${d.relationName}»)` },
        { separator: true },
        { icon: '🗑', label: 'Удалить связь', danger: true, action: () => deleteRelation(d.relationId) }
    ]);
}

function openCanvasContextMenu(event) {
    showContextMenu(event, [
        { icon: '➕', label: 'Создать сущность', accent: true, action: () => openEntryModal('create', { worldId: currentWorldFilter }) },
        { icon: '⟳', label: 'Обновить граф', action: () => loadGraph() },
        { icon: '🎯', label: 'Центрировать', action: () => centerGraph() }
    ]);
}

// ---------------------------------------------------------------------------
// Neighborhood mode
// ---------------------------------------------------------------------------

function setNeighborhood(entryId) {
    neighborhoodCenterId = entryId;
    applyFilters();
}

function clearNeighborhood() {
    neighborhoodCenterId = null;
    applyFilters();
}

function renderNeighborhoodChip() {
    const container = document.getElementById('neighborhoodChip');
    if (neighborhoodCenterId == null) {
        container.hidden = true;
        container.innerHTML = '';
        return;
    }

    const center = fullGraphData.nodes.find(n => n.id === neighborhoodCenterId);
    container.hidden = false;
    container.innerHTML = '';

    const chip = document.createElement('div');
    chip.className = 'neighborhood-chip';
    chip.innerHTML = `<span>Окружение «${center ? center.title : neighborhoodCenterId}» (глубина ${neighborhoodDepth})</span>`;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.title = 'Показать весь граф';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', clearNeighborhood);

    chip.appendChild(closeBtn);
    container.appendChild(chip);
}

// ---------------------------------------------------------------------------
// Navigation to entry-view
// ---------------------------------------------------------------------------

function openInEntryView(entryId) {
    const node = fullGraphData.nodes.find(n => n.id === entryId);
    const params = new URLSearchParams();
    if (node && node.worldId) params.set('world', node.worldId);
    params.set('entry', entryId);
    window.location.href = `entry-view.html?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Reset zoom / center / physics
// ---------------------------------------------------------------------------

function resetZoom() {
    svg.transition().duration(600).call(svg.__zoom.transform, d3.zoomIdentity);
}

function centerGraph() {
    const width = document.getElementById('graphContainer').clientWidth;
    const height = document.getElementById('graphContainer').clientHeight;
    if (simulation) {
        simulation.force('center', d3.forceCenter(width / 2, height / 2));
        simulation.alpha(0.3).restart();
    }
}

function togglePhysics() {
    physicsEnabled = !physicsEnabled;
    document.getElementById('physicsBtn').classList.toggle('active', physicsEnabled);
    if (simulation) {
        if (physicsEnabled) simulation.alpha(1).restart();
        else simulation.stop();
    }
}

// ---------------------------------------------------------------------------
// World switcher
// ---------------------------------------------------------------------------

function renderWorldDropdown() {
    const dropdown = document.getElementById('worldDropdown');
    dropdown.innerHTML = '';

    const allItem = document.createElement('div');
    allItem.className = 'world-dropdown-item' + (currentWorldFilter == null ? ' active' : '');
    allItem.textContent = 'Все миры';
    allItem.addEventListener('click', (e) => {
        e.stopPropagation();
        closeWorldDropdown();
        selectWorldFilter(null);
    });
    dropdown.appendChild(allItem);

    worlds.forEach(w => {
        const item = document.createElement('div');
        item.className = 'world-dropdown-item' + (w.id === currentWorldFilter ? ' active' : '');
        item.textContent = w.name;
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            closeWorldDropdown();
            selectWorldFilter(w.id);
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

function selectWorldFilter(worldId) {
    currentWorldFilter = worldId;
    neighborhoodCenterId = null;
    const world = worlds.find(w => w.id === worldId);
    document.getElementById('worldName').textContent = world ? world.name : 'Все миры';
    applyFilters();
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

let entryModalMode = 'create';
let entryModalEditingId = null;

function descendantIdsOf(id) {
    const result = new Set();
    const stack = [id];
    while (stack.length) {
        const current = stack.pop();
        fullGraphData.nodes.filter(n => n.parentId === current).forEach(child => {
            if (!result.has(child.id)) {
                result.add(child.id);
                stack.push(child.id);
            }
        });
    }
    return result;
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

function populateWorldSelect(selectedWorldId) {
    const select = document.getElementById('entryFieldWorld');
    select.innerHTML = '';
    worlds.forEach(w => {
        const opt = document.createElement('option');
        opt.value = String(w.id);
        opt.textContent = w.name;
        select.appendChild(opt);
    });
    if (selectedWorldId != null && worlds.some(w => w.id === selectedWorldId)) {
        select.value = String(selectedWorldId);
    } else if (worlds.length > 0) {
        select.value = String(worlds[0].id);
    }
}

function populateParentSelect(worldId, editingId) {
    const select = document.getElementById('entryFieldParent');
    select.innerHTML = '';

    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '— Нет (корень) —';
    select.appendChild(noneOpt);

    const excluded = editingId != null ? descendantIdsOf(editingId) : new Set();
    if (editingId != null) excluded.add(editingId);

    fullGraphData.nodes
        .filter(n => n.worldId === worldId && !excluded.has(n.id))
        .sort(byTitleThenId)
        .forEach(n => {
            const opt = document.createElement('option');
            opt.value = String(n.id);
            opt.textContent = `${typeMeta(n.type).icon} ${n.title}`;
            select.appendChild(opt);
        });

    return select;
}

async function openEntryModal(mode, context = {}) {
    if (worlds.length === 0) {
        showToast('Сначала создайте мир');
        openWorldModal();
        return;
    }

    entryModalMode = mode;
    entryModalEditingId = mode === 'edit' ? context.editingId : null;

    populateTypeSelect();

    const nameInput = document.getElementById('entryFieldName');
    const titleInput = document.getElementById('entryFieldTitle');
    const typeSelect = document.getElementById('entryFieldType');
    const worldSelect = document.getElementById('entryFieldWorld');
    const descInput = document.getElementById('entryFieldDescription');
    const errorBox = document.getElementById('entryFieldError');
    errorBox.hidden = true;
    errorBox.textContent = '';

    if (mode === 'edit') {
        // GraphNode only carries the display title, not the entry's real
        // (unique) `name` — fetch the full entry so editing doesn't clobber it.
        let entry;
        try {
            entry = await api(`/api/entry/${context.editingId}`);
        } catch (err) {
            showToast('Не удалось загрузить сущность: ' + err.message);
            return;
        }

        document.getElementById('entryModalTitle').textContent = 'Редактировать сущность';
        document.getElementById('entryModalSubmitBtn').textContent = 'Сохранить';

        populateWorldSelect(entry.worldId);
        populateParentSelect(entry.worldId, context.editingId);

        nameInput.value = entry.name || '';
        titleInput.value = entry.title || '';
        typeSelect.value = entry.type || 'EMPTY';
        descInput.value = entry.description || '';
        document.getElementById('entryFieldParent').value = entry.parentId != null ? String(entry.parentId) : '';
    } else {
        document.getElementById('entryModalTitle').textContent = 'Создать сущность';
        document.getElementById('entryModalSubmitBtn').textContent = 'Создать';

        const worldId = context.worldId != null ? context.worldId : (worlds[0] && worlds[0].id);
        populateWorldSelect(worldId);
        populateParentSelect(worldId, null);

        nameInput.value = '';
        titleInput.value = '';
        typeSelect.value = 'EMPTY';
        descInput.value = '';
        document.getElementById('entryFieldParent').value = context.parentId != null ? String(context.parentId) : '';
    }

    worldSelect.onchange = () => {
        populateParentSelect(Number(worldSelect.value), entryModalMode === 'edit' ? entryModalEditingId : null);
    };

    document.getElementById('entryModalOverlay').hidden = false;
    nameInput.focus();
}

function closeEntryModal() {
    document.getElementById('entryModalOverlay').hidden = true;
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
        const worldId = Number(document.getElementById('entryFieldWorld').value);
        const parentRaw = document.getElementById('entryFieldParent').value;
        const description = document.getElementById('entryFieldDescription').value.trim();

        const payload = {
            name,
            title,
            description,
            type,
            parentId: parentRaw ? Number(parentRaw) : null,
            worldId
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
            closeEntryModal();
            await loadGraph();
        } catch (err) {
            errorBox.textContent = err.message;
            errorBox.hidden = false;
        } finally {
            submitBtn.disabled = false;
        }
    });
}

async function deleteEntry(node) {
    const confirmed = window.confirm(`Удалить «${node.title}»? Дочерние сущности станут корневыми.`);
    if (!confirmed) return;

    try {
        await api(`/api/entry/${node.id}`, { method: 'DELETE' });
        showToast(`Сущность «${node.title}» удалена`);
        if (neighborhoodCenterId === node.id) neighborhoodCenterId = null;
        if (selectedNodeId === node.id) selectedNodeId = null;
        await loadGraph();
    } catch (err) {
        showToast('Не удалось удалить: ' + err.message);
    }
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
            selectWorldFilter(created.id);
        } catch (err) {
            errorBox.textContent = err.message;
            errorBox.hidden = false;
        }
    });
}

// ---------------------------------------------------------------------------
// Relation type modal (last step of dynamic relationship creation)
// ---------------------------------------------------------------------------

async function loadRelationDefinitions() {
    relationDefinitions = await api('/api/relations/definitions');
    return relationDefinitions;
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

async function openRelationTypeModal(sourceNode, targetNode) {
    pendingRelation = {
        sourceId: sourceNode.id,
        sourceLabel: `${typeMeta(sourceNode.type).icon} ${sourceNode.title}`,
        targetId: targetNode.id,
        targetLabel: `${typeMeta(targetNode.type).icon} ${targetNode.title}`
    };

    document.getElementById('relationSummary').innerHTML =
        `<span>${pendingRelation.sourceLabel}</span><span class="arrow">→</span><span>${pendingRelation.targetLabel}</span>`;

    const errorBox = document.getElementById('relationFieldError');
    errorBox.hidden = true;
    errorBox.textContent = '';

    document.getElementById('relationNewDefinitionFields').hidden = true;
    document.getElementById('relationFieldDefName').value = '';
    document.getElementById('relationFieldDefReverseName').value = '';

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
    pendingRelation = null;
}

function bindRelationModal() {
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
        if (!pendingRelation) return;

        const errorBox = document.getElementById('relationFieldError');
        errorBox.hidden = true;

        const newFieldsVisible = !document.getElementById('relationNewDefinitionFields').hidden;
        const defName = document.getElementById('relationFieldDefName').value.trim();
        const defReverseName = document.getElementById('relationFieldDefReverseName').value.trim();

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
                body: {
                    sourceId: pendingRelation.sourceId,
                    targetId: pendingRelation.targetId,
                    relationDefinitionId
                }
            });

            showToast('Связь создана');
            closeRelationModal();
            await loadGraph();
        } catch (err) {
            errorBox.textContent = err.message;
            errorBox.hidden = false;
        } finally {
            submitBtn.disabled = false;
        }
    });
}

async function deleteRelation(relationId) {
    if (relationId == null) return;
    const confirmed = window.confirm('Удалить эту связь?');
    if (!confirmed) return;

    try {
        await api(`/api/relations/${relationId}`, { method: 'DELETE' });
        showToast('Связь удалена');
        await loadGraph();
    } catch (err) {
        showToast('Не удалось удалить связь: ' + err.message);
    }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function searchAndFocus(query) {
    const q = query.trim().toLowerCase();
    if (!q) return;

    const match = viewGraphData.nodes.find(n => (n.title || '').toLowerCase().includes(q));
    if (!match) {
        showToast(`Ничего не найдено: «${query}»`);
        return;
    }

    selectedNodeId = match.id;
    highlightSelection();

    const width = document.getElementById('graphContainer').clientWidth;
    const height = document.getElementById('graphContainer').clientHeight;
    const scale = 1.1;
    const transform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-match.x, -match.y);
    svg.transition().duration(500).call(svg.__zoom.transform, transform);
}

// ---------------------------------------------------------------------------
// Toast / static controls / resize
// ---------------------------------------------------------------------------

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('visible'), 2200);
}

function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(overlay => { overlay.hidden = true; });
    pendingRelation = null;
    closeWorldDropdown();
    closeContextMenu();
}

function bindStaticControls() {
    document.getElementById('themeToggle').addEventListener('click', () => {
        const root = document.documentElement;
        const isLight = root.getAttribute('data-theme') === 'light';
        root.setAttribute('data-theme', isLight ? 'dark' : 'light');
        document.getElementById('themeToggle').textContent = isLight ? '☀' : '☾';
    });

    document.getElementById('worldSwitcher').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleWorldDropdown();
    });
    document.addEventListener('click', () => closeWorldDropdown());

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (linkSource) { cancelLinking(); return; }
            closeAllModals();
        }
    });

    document.getElementById('refreshBtn').addEventListener('click', () => loadGraph());
    document.getElementById('resetZoomBtn').addEventListener('click', resetZoom);
    document.getElementById('centerBtn').addEventListener('click', centerGraph);
    document.getElementById('physicsBtn').addEventListener('click', togglePhysics);
    document.getElementById('physicsBtn').classList.add('active');

    document.getElementById('searchInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.value.trim()) {
            searchAndFocus(e.target.value.trim());
        }
    });
}

window.addEventListener('resize', () => {
    if (fullGraphData.nodes.length) {
        setupSVG();
        renderGraph();
    }
});
