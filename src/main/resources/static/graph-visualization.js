let graphData = null;
let simulation = null;
let svg = null;
let g = null;
let physicsEnabled = true;

document.addEventListener('DOMContentLoaded', () => {
    setupSVG();
    loadGraph();
});

function setupSVG() {
    const container = document.getElementById('graphContainer');
    const width = container.clientWidth;
    const height = container.clientHeight;

    svg = d3.select('#graphContainer')
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    const defs = svg.append('defs');

    // Default arrow marker for inactive relations
    defs.append('marker')
        .attr('id', 'arrowhead-default')
        .attr('markerWidth', 8)
        .attr('markerHeight', 8)
        .attr('refX', 18)
        .attr('refY', 4)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M 0 0 L 8 4 L 0 8 Z')
        .attr('fill', '#90a4ae');

    // Active arrow marker for highlighted relations
    defs.append('marker')
        .attr('id', 'arrowhead-active')
        .attr('markerWidth', 8)
        .attr('markerHeight', 8)
        .attr('refX', 18)
        .attr('refY', 4)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M 0 0 L 8 4 L 0 8 Z')
        .attr('fill', '#667eea');

    // Shadow filter for better visibility
    defs.append('filter')
        .attr('id', 'shadow')
        .html(`
            <feGaussianBlur in="SourceGraphic" stdDeviation="2"/>
            <feOffset dx="1" dy="1" result="offsetblur"/>
            <feMerge>
                <feMergeNode in="offsetblur"/>
                <feMergeNode in="SourceGraphic"/>
            </feMerge>
        `);

    const zoom = d3.zoom()
        .on('zoom', (event) => {
            g.attr('transform', event.transform);
        });

    svg.call(zoom);

    g = svg.append('g');
}

function changeView(value) {
    const entryContainer = document.getElementById('entryLabelContainer');
    const depthContainer = document.getElementById('depthLabelContainer');

    if (value === 'entry') {
        entryContainer.style.display = 'flex';
        depthContainer.style.display = 'flex';
    } else {
        entryContainer.style.display = 'none';
        depthContainer.style.display = 'none';
    }
}

async function loadGraph() {
    const container = document.getElementById('graphContainer');
    const viewType = document.getElementById('viewType').value;

    let url = '/api/graph/all';

    if (viewType === 'entry') {
        const entryId = document.getElementById('entryId').value;
        const depth = document.getElementById('depth').value;

        if (!entryId) {
            alert('Please enter an entry ID');
            return;
        }

        url = `/api/graph/entry/${entryId}?depth=${depth}`;
    }

    container.innerHTML = `
        <div class="loading">
            <div class="spinner"></div>
            Loading graph...
        </div>
    `;

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        graphData = await response.json();

        container.innerHTML = '';
        setupSVG();
        renderGraph();
        updateStats();

        document.getElementById('stats').style.display = 'flex';
    } catch (error) {
        container.innerHTML = `
            <div class="loading" style="color: #d32f2f;">
                Error loading graph: ${error.message}
            </div>
        `;
    }
}

function renderGraph() {
    const width = document.getElementById('graphContainer').clientWidth;
    const height = document.getElementById('graphContainer').clientHeight;

    g.selectAll('*').remove();

    if (simulation) {
        simulation.stop();
    }

    simulation = d3.forceSimulation(graphData.nodes)
        .force(
            'link',
            d3.forceLink(graphData.edges)
                .id(d => d.id)
                .distance(150)
        )
        .force(
            'charge',
            d3.forceManyBody().strength(-500)
        )
        .force(
            'collide',
            d3.forceCollide().radius(120)
        )
        .force(
            'center',
            d3.forceCenter(width / 2, height / 2)
        );

    const links = g.selectAll('.link-group')
        .data(graphData.edges)
        .enter()
        .append('g')
        .attr('class', 'link-group');

    // Add background line for better visibility on hover
    links.append('line')
        .attr('class', 'link-background')
        .attr('stroke-width', 8)
        .attr('stroke', 'transparent')
        .style('cursor', 'pointer');

    // Main directional line with arrow
    links.append('line')
        .attr('class', 'link')
        .attr('stroke-width', 2.5)
        .attr('marker-end', 'url(#arrowhead-default)');

    // Relation label with background for readability
    const labelGroups = links.append('g')
        .attr('class', 'link-label-group')
        .style('pointer-events', 'none');

    labelGroups.append('rect')
        .attr('class', 'link-label-bg')
        .attr('fill', 'white')
        .attr('rx', 4)
        .attr('ry', 3)
        .attr('opacity', 0.85);

    labelGroups.append('text')
        .attr('class', 'link-label')
        .text(d => d.relationName)
        .attr('dy', -8)
        .attr('text-anchor', 'middle');

    // Update background rect dimensions after text is rendered
    simulation.on('tick', () => {
        g.selectAll('.link-label-bg').each(function(d) {
            const text = d3.select(this.parentNode).select('text');
            const bbox = text.node().getBBox();
            d3.select(this)
                .attr('x', bbox.x - 4)
                .attr('y', bbox.y - 2)
                .attr('width', bbox.width + 8)
                .attr('height', bbox.height + 4);
        });
    });

    // Add hover interactions
    links.on('mouseenter', function(event, d) {
        d3.select(this).classed('link-hover', true);
        d3.select(this).select('.link')
            .attr('marker-end', 'url(#arrowhead-active)');

        // Show tooltip on link hover
        const tooltip = document.getElementById('tooltip');
        tooltip.innerHTML = `
            <strong>${d.relationName}</strong><br>
            <small>${d.source.title} → ${d.target.title}</small>
        `;
        tooltip.classList.add('visible');
        tooltip.style.left = event.pageX + 12 + 'px';
        tooltip.style.top = event.pageY + 12 + 'px';
    });

    links.on('mouseleave', function(event, d) {
        d3.select(this).classed('link-hover', false);
        d3.select(this).select('.link')
            .attr('marker-end', 'url(#arrowhead-default)');

        hideTooltip();
    });

    const nodes = g.selectAll('.node')
        .data(graphData.nodes)
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
        .attr('width', 160)
        .attr('height', 100)
        .attr('x', -80)
        .attr('y', -50)
        .attr('rx', 8);

    nodes.append('text')
        .attr('class', 'title')
        .attr('y', -20)
        .attr('text-anchor', 'middle')
        .text(d =>
            d.title.length > 20
                ? d.title.substring(0, 17) + '...'
                : d.title
        );

    nodes.append('text')
        .attr('class', 'description')
        .attr('y', 15)
        .attr('text-anchor', 'middle')
        .text(d =>
            d.description.length > 25
                ? d.description.substring(0, 22) + '...'
                : d.description
        );

    nodes.append('text')
        .attr('class', 'description')
        .attr('y', 35)
        .attr('font-size', '10px')
        .text(d => `ID: ${d.id}`);

    nodes.on('click', (event, d) => {
        event.stopPropagation();
        highlightNode(d.id);
        showTooltip(event, d);
    });

    nodes.on('mouseenter', (event, d) => {
        showTooltip(event, d);
        d3.select(event.currentTarget).classed('active', true);
    });

    nodes.on('mouseleave', (event) => {
        hideTooltip();
        d3.select(event.currentTarget).classed('active', false);
    });

    simulation.on('tick', () => {
        // Update all line types (background and main) with boundary calculation
        g.selectAll('.link-group line')
            .attr('x1', d => {
                const start = calculateLineEndpoint(d.source, d.target, true);
                return start.x;
            })
            .attr('y1', d => {
                const start = calculateLineEndpoint(d.source, d.target, true);
                return start.y;
            })
            .attr('x2', d => {
                const end = calculateLineEndpoint(d.source, d.target, false);
                return end.x;
            })
            .attr('y2', d => {
                const end = calculateLineEndpoint(d.source, d.target, false);
                return end.y;
            });

        // Update label positions and background rects
        g.selectAll('.link-label-group')
            .attr('transform', d => {
                const start = calculateLineEndpoint(d.source, d.target, true);
                const end = calculateLineEndpoint(d.source, d.target, false);
                const mx = (start.x + end.x) / 2;
                const my = (start.y + end.y) / 2;
                return `translate(${mx},${my})`;
            });

        g.selectAll('.node')
            .attr('transform', d => `translate(${d.x},${d.y})`);
    });
}

function getNodeBoundary(node) {
    // Node rect is 160x100, centered at node position (-80 to 80 on x, -50 to 50 on y)
    return { width: 160, height: 100 };
}

function calculateLineEndpoint(source, target, isSource) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance === 0) return isSource ? source : target;

    const angle = Math.atan2(dy, dx);
    const bounds = getNodeBoundary();

    // Calculate perpendicular distances to node boundaries
    const halfWidth = bounds.width / 2;
    const halfHeight = bounds.height / 2;

    // Find intersection with node rectangle
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    let distToEdge;

    // Check which edge the line intersects
    if (Math.abs(cosA) > 0) {
        const distX = halfWidth / Math.abs(cosA);
        distToEdge = distX;
    }
    if (Math.abs(sinA) > 0) {
        const distY = halfHeight / Math.abs(sinA);
        if (distToEdge === undefined || distY < distToEdge) {
            distToEdge = distY;
        }
    }

    const offset = distToEdge || 70;
    const node = isSource ? source : target;

    return {
        x: node.x + (isSource ? -1 : 1) * cosA * offset,
        y: node.y + (isSource ? -1 : 1) * sinA * offset
    };
}

function highlightNode(nodeId) {
    g.selectAll('.node')
        .classed('selected', d => d.id === nodeId);

    g.selectAll('.link')
        .classed(
            'active',
            d => d.source.id === nodeId || d.target.id === nodeId
        );
}

function showTooltip(event, d) {
    const tooltip = document.getElementById('tooltip');

    tooltip.innerHTML = `
        <strong>${d.title}</strong><br>
        ${d.description}<br>
        <small style="opacity: 0.8;">ID: ${d.id}</small>
    `;

    tooltip.classList.add('visible');
    tooltip.style.left = event.pageX + 12 + 'px';
    tooltip.style.top = event.pageY + 12 + 'px';
}

function hideTooltip() {
    document.getElementById('tooltip')
        .classList.remove('visible');
}

function dragStarted(event, d) {
    if (!event.active) {
        simulation.alphaTarget(0.3).restart();
    }

    d.fx = d.x;
    d.fy = d.y;
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

function dragEnded(event, d) {
    if (!event.active) {
        simulation.alphaTarget(0);
    }

    if (!event.sourceEvent.shiftKey) {
        d.fx = null;
        d.fy = null;
    }
}

function resetZoom() {
    svg.transition()
        .duration(750)
        .call(
            d3.zoom().transform,
            d3.zoomIdentity
                .translate(0, 0)
                .scale(1)
        );
}

function centerGraph() {
    const width = document.getElementById('graphContainer').clientWidth;
    const height = document.getElementById('graphContainer').clientHeight;

    if (simulation) {
        simulation.force(
            'center',
            d3.forceCenter(width / 2, height / 2)
        );

        simulation.alpha(0.3).restart();
    }
}

function togglePhysics() {
    physicsEnabled = !physicsEnabled;

    if (simulation) {
        if (physicsEnabled) {
            simulation.alpha(1).restart();
        } else {
            simulation.stop();
        }
    }
}

function updateStats() {
    document.getElementById('statEntries').textContent =
        graphData.nodes.length;

    document.getElementById('statRelations').textContent =
        graphData.edges.length;
}

window.addEventListener('resize', () => {
    if (graphData) {
        if (simulation) {
            simulation.stop();
        }

        svg.remove();
        setupSVG();
        renderGraph();
    }
});

document.getElementById('entryForm')
    .addEventListener('submit', async (event) => {
        event.preventDefault();

        const message = document.getElementById('entryMessage');

        const request = {
            name: document.getElementById('entryName').value.trim(),
            title: document.getElementById('entryTitle').value.trim(),
            description: document.getElementById('entryDescription').value.trim()
        };

        try {
            const response = await fetch('/api/entry/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(request)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    errorText || `HTTP ${response.status}`
                );
            }

            const createdEntry = await response.json();

            message.textContent =
                `Entry "${createdEntry.name}" created. ID: ${createdEntry.id}`;

            message.className = 'form-message success';

            document.getElementById('entryForm').reset();

            await loadGraph();
        } catch (error) {
            console.error('Error creating entry:', error);

            message.textContent =
                `Error creating entry: ${error.message}`;

            message.className = 'form-message error';
        }
    });

document.getElementById('relationForm')
    .addEventListener('submit', async (event) => {
        event.preventDefault();

        const message = document.getElementById('relationMessage');

        const request = {
            sourceId: Number(
                document.getElementById('relationSourceId').value
            ),
            targetId: Number(
                document.getElementById('relationTargetId').value
            ),
            relationDefinitionId: Number(
                document.getElementById('relationDefinitionId').value
            )
        };

        try {
            const response = await fetch('/api/relations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(request)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    errorText || `HTTP ${response.status}`
                );
            }

            const relation = await response.json();

            message.textContent =
                `Relation created successfully. ID: ${relation.id}`;

            message.className = 'form-message success';

            document.getElementById('relationForm').reset();

            await loadGraph();
        } catch (error) {
            console.error('Error creating relation:', error);

            message.textContent =
                `Error creating relation: ${error.message}`;

            message.className = 'form-message error';
        }
    });

document.getElementById('definitionForm')
    .addEventListener('submit', async (event) => {
        event.preventDefault();

        const message = document.getElementById('definitionMessage');

        const request = {
            name: document.getElementById('definitionName').value.trim(),
            reverseName: document
                .getElementById('definitionReverseName')
                .value
                .trim()
        };

        try {
            const response = await fetch(
                '/api/relations/definitions',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(request)
                }
            );

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    errorText || `HTTP ${response.status}`
                );
            }

            const definition = await response.json();

            message.textContent =
                `Definition "${definition.name}" created. ID: ${definition.id}`;

            message.className = 'form-message success';

            document.getElementById('definitionForm').reset();
        } catch (error) {
            console.error(
                'Error creating relation definition:',
                error
            );

            message.textContent =
                `Error creating definition: ${error.message}`;

            message.className = 'form-message error';
        }
    });

document.getElementById('toggleCreationPanel').addEventListener('click', () => {
    document.querySelector('.creation-panel').classList.toggle('visible');
});