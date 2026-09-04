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

    svg.append('defs').append('marker')
        .attr('id', 'arrowhead')
        .attr('markerWidth', 10)
        .attr('markerHeight', 10)
        .attr('refX', 25)
        .attr('refY', 3)
        .attr('orient', 'auto')
        .append('polygon')
        .attr('points', '0 0, 10 3, 0 6')
        .attr('fill', '#b0bec5');

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

    const links = g.selectAll('.link')
        .data(graphData.edges)
        .enter()
        .append('g')
        .attr('class', 'link-group');

    links.append('line')
        .attr('class', 'link')
        .attr('stroke-width', 2)
        .attr('marker-end', 'url(#arrowhead)');

    links.append('text')
        .attr('class', 'link-label')
        .text(d => d.relationName)
        .attr('dy', -8);

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
        g.selectAll('.link line')
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);

        g.selectAll('.link-label')
            .attr('x', d => (d.source.x + d.target.x) / 2)
            .attr('y', d => (d.source.y + d.target.y) / 2);

        g.selectAll('.node')
            .attr('transform', d => `translate(${d.x},${d.y})`);
    });
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