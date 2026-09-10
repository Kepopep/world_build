// Relationship graph, merging TWO sources into one view (per CLAUDE.md's
// graph decision):
//   - client-side [[wikilink]]-derived nodes/edges, computed locally from
//     already-loaded entry content (computeWorldGraph/computeEntryGraph) --
//     the original, still-independent-of-the-backend half.
//   - the formal Relation/RelationDefinition graph, fetched from
//     GET /api/graph/world/{worldId} / GET /api/graph/entry/{id} and merged
//     in (fetchWorldRelationGraph/fetchEntryRelationGraph + mergeGraphs).
// Nodes are deduped by entry id; edges carry a `kind: 'relation'|'wikilink'`
// so drawEdge() can render solid+labeled (relation) vs dashed (wikilink)
// distinctly. Two views: a full-world graph (every entry as a node) and a
// per-entry graph (the open entry plus its 1-hop neighbors from either
// source, in+out, no edges between two neighbors on the wikilink side --
// the relation side's depth-1 BFS result is used as returned).
//
// Self-contained, arm's-length module -- same pattern as sidebar.js/
// tags.js/editor.js: graph.js never reaches into app.js's `state` directly,
// only ever uses what's handed to it via `config` in render(). The only
// thing shared with editor.js is wikilink-parser.js (both need the same
// [[Title]] regex); graph.js never imports/calls editor.js or vice versa.
//
// Two independent renderer instances (see the Rendering section's
// createRenderer() factory): one backs the existing full-screen modal
// (#graph-modal), the other backs the small embedded right-rail per-entry
// panel (#entry-graph-panel) -- kept as separate closures over their own
// svg/node-circle state so the two can never clobber each other if both
// happen to have been rendered at some point (only one is ever visible at a
// time in practice, but nothing here assumes that).
//
// Relation-graph fetches degrade gracefully: if GET /api/graph/... fails
// (e.g. not deployed yet), the merge just falls back to wikilink-only data
// (a console.warn, not a user-facing error) rather than blocking the whole
// graph view on a still-landing backend endpoint.

(function () {
  // ---- Graph computation (pure functions) --------------------------------

  function buildTitleIndex(entries) {
    const map = new Map();
    for (const e of entries) {
      if (e && e.title) {
        map.set(e.title.toLowerCase(), e);
      }
    }
    return map;
  }

  function computeWorldGraph(entries) {
    const titleIndex = buildTitleIndex(entries);
    const nodes = new Map();
    const edges = new Map();

    for (const e of entries) {
      nodes.set("e:" + e.id, { id: "e:" + e.id, kind: "resolved", title: e.title, entryId: e.id, icon: e.icon });
    }

    for (const e of entries) {
      const sourceId = "e:" + e.id;
      for (const rawTitle of window.wikilinkParser.extractWikilinks(e.contentMarkdown)) {
        const key = rawTitle.toLowerCase();
        const target = titleIndex.get(key);
        let targetId;
        if (target) {
          targetId = "e:" + target.id;
        } else {
          targetId = "u:" + key;
          if (!nodes.has(targetId)) {
            nodes.set(targetId, { id: targetId, kind: "unresolved", title: rawTitle, entryId: null, icon: null });
          }
        }
        if (targetId === sourceId) {
          continue;
        }
        const edgeKey = [sourceId, targetId].sort().join("|");
        if (!edges.has(edgeKey)) {
          edges.set(edgeKey, { source: sourceId, target: targetId, kind: "wikilink" });
        }
      }
    }
    return { nodes: [...nodes.values()], edges: [...edges.values()] };
  }

  function computeEntryGraph(entries, centerEntryId) {
    const { nodes, edges } = computeWorldGraph(entries);
    const centerId = "e:" + centerEntryId;
    const touching = edges.filter((e) => e.source === centerId || e.target === centerId);
    const keepIds = new Set([centerId, ...touching.flatMap((e) => [e.source, e.target])]);
    return { nodes: nodes.filter((n) => keepIds.has(n.id)), edges: touching, centerId: centerId };
  }

  // ---- Formal-Relation graph: fetch + merge with the wikilink graph -------

  // Both degrade to `null` (rather than throwing) on failure -- see the
  // module doc comment's note on graceful degradation. Callers treat `null`
  // the same as "no relation data available yet".
  async function fetchEntryRelationGraph(entryId, depth) {
    try {
      return await window.api.getEntryGraph(entryId, depth || 1);
    } catch (err) {
      console.warn("Entry relation graph unavailable:", err && err.message ? err.message : err);
      return null;
    }
  }

  async function fetchWorldRelationGraph(worldId) {
    try {
      return await window.api.getWorldGraph(worldId);
    } catch (err) {
      console.warn("World relation graph unavailable:", err && err.message ? err.message : err);
      return null;
    }
  }

  // Merges a locally-computed wikilink graph ({nodes, edges}, edges already
  // tagged kind:'wikilink') with a server relation graph
  // ({nodes:[{id,title,icon}], edges:[{sourceId,targetId,label,
  // relationDefinitionId}]}, or null if unavailable). Nodes are deduped by
  // "e:" + entry id -- a relation-graph node for an entry already present
  // from the wikilink side is skipped, not overwritten (the wikilink side's
  // node already carries everything drawNode() needs). Relation edges are
  // tagged kind:'relation' and keep their label/relationDefinitionId for
  // drawEdge() to render solid+labeled.
  function mergeGraphs(local, relationGraph) {
    const nodes = new Map();
    for (const n of local.nodes) {
      nodes.set(n.id, n);
    }
    const edges = local.edges.slice();
    if (relationGraph) {
      for (const n of relationGraph.nodes || []) {
        const id = "e:" + n.id;
        if (!nodes.has(id)) {
          nodes.set(id, { id: id, kind: "resolved", title: n.title, entryId: n.id, icon: n.icon });
        }
      }
      for (const e of relationGraph.edges || []) {
        edges.push({
          source: "e:" + e.sourceId,
          target: "e:" + e.targetId,
          kind: "relation",
          label: e.label,
          relationDefinitionId: e.relationDefinitionId,
        });
      }
    }
    return { nodes: [...nodes.values()], edges: edges };
  }

  // ---- Layout -------------------------------------------------------------

  function fitToBounds(nodes, width, height) {
    if (nodes.length === 0) {
      return nodes;
    }
    const PADDING = 40;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const availW = Math.max(width - PADDING * 2, 1);
    const availH = Math.max(height - PADDING * 2, 1);
    // Preserve aspect ratio -- scale by the more constraining axis only.
    const scale = Math.min(availW / spanX, availH / spanY, 1);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const targetCx = width / 2;
    const targetCy = height / 2;
    for (const n of nodes) {
      n.x = targetCx + (n.x - cx) * scale;
      n.y = targetCy + (n.y - cy) * scale;
    }
    return nodes;
  }

  function layoutForceDirected(nodes, edges, width, height) {
    if (nodes.length === 0) {
      return nodes;
    }
    const cx = width / 2, cy = height / 2;
    nodes.forEach((n, i) => {
      const a = (i / nodes.length) * 2 * Math.PI;
      n.x = cx + Math.cos(a) * Math.min(width, height) / 3;
      n.y = cy + Math.sin(a) * Math.min(width, height) / 3;
      n.vx = 0;
      n.vy = 0;
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const REPULSION = 6000, SPRING_LEN = 120, SPRING_K = 0.02, DAMPING = 0.85, CENTER_PULL = 0.01;

    for (let iter = 0; iter < 300; iter++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
          const d2 = Math.max(dx * dx + dy * dy, 0.01), d = Math.sqrt(d2);
          const f = REPULSION / d2;
          const fx = f * dx / d, fy = f * dy / d;
          nodes[i].vx -= fx;
          nodes[i].vy -= fy;
          nodes[j].vx += fx;
          nodes[j].vy += fy;
        }
      }
      for (const e of edges) {
        const a = byId.get(e.source), b = byId.get(e.target);
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(Math.hypot(dx, dy), 0.01);
        const k = SPRING_K * (d - SPRING_LEN);
        const fx = k * dx / d, fy = k * dy / d;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
      for (const n of nodes) {
        n.vx += (cx - n.x) * CENTER_PULL;
        n.vy += (cy - n.y) * CENTER_PULL;
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        n.x += n.vx;
        n.y += n.vy;
      }
    }
    return fitToBounds(nodes, width, height);
  }

  function layoutRadial(centerNode, neighborNodes, width, height) {
    centerNode.x = width / 2;
    centerNode.y = height / 2;
    const radius = Math.min(width, height) * 0.35;
    const sorted = [...neighborNodes].sort((a, b) => a.title.localeCompare(b.title));
    sorted.forEach((n, i) => {
      const a = (i / sorted.length) * 2 * Math.PI - Math.PI / 2;
      n.x = centerNode.x + Math.cos(a) * radius;
      n.y = centerNode.y + Math.sin(a) * radius;
    });
    return [centerNode, ...sorted];
  }

  // ---- Rendering ------------------------------------------------------------

  const SVG_NS = "http://www.w3.org/2000/svg";
  const UNRESOLVED_COLOR = "var(--color-warn, #d98c46)";

  function clearSvg(svg) {
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }
  }

  function renderEmptyState(svg, width, height, message) {
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("class", "graph-empty-message");
    text.setAttribute("x", String(width / 2));
    text.setAttribute("y", String(height / 2));
    text.textContent = message;
    svg.appendChild(text);
  }

  function nodeRadius(node, config) {
    if (config.mode === "entry" && node.id === config._centerId) {
      return 11;
    }
    return 8;
  }

  function nodeFill(node) {
    return node.kind === "resolved" ? "var(--color-accent)" : UNRESOLVED_COLOR;
  }

  function nodeFillOpacity(node) {
    return node.kind === "resolved" ? "1" : "0.5";
  }

  // `edge` is optional (falls back to a plain wikilink-style line if
  // omitted, e.g. from any future caller that only has two nodes) --
  // relation edges (kind:'relation') render solid with a text label at the
  // midpoint; wikilink edges (kind:'wikilink', or no edge at all) render
  // dashed via the .graph-edge-wikilink class (css/graph.css).
  function drawEdge(svg, a, b, edge) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(a.x));
    line.setAttribute("y1", String(a.y));
    line.setAttribute("x2", String(b.x));
    line.setAttribute("y2", String(b.y));
    line.setAttribute("stroke", "var(--color-border)");
    line.setAttribute("stroke-width", "1.5");
    line.setAttribute("opacity", "0.6");
    if (!edge || edge.kind !== "relation") {
      line.setAttribute("class", "graph-edge-wikilink");
    }
    svg.appendChild(line);

    if (edge && edge.kind === "relation" && edge.label) {
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("class", "graph-edge-label");
      label.setAttribute("x", String((a.x + b.x) / 2));
      label.setAttribute("y", String((a.y + b.y) / 2 - 4));
      label.textContent = edge.label;
      svg.appendChild(label);
    }
  }

  // `nodeCircles` is an out-param (Map<node.id, circle>) rather than closed-
  // over module state -- see the Rendering section's createRenderer()
  // factory, which owns one such map per renderer instance (modal vs. the
  // embedded entry-graph panel) so the two can never clobber each other's
  // redrawNode() lookups.
  function drawNode(svg, node, config, nodeCircles) {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(node.x));
    circle.setAttribute("cy", String(node.y));
    circle.setAttribute("r", String(nodeRadius(node, config)));
    circle.setAttribute("fill", nodeFill(node));
    circle.setAttribute("fill-opacity", nodeFillOpacity(node));
    circle.style.cursor = "pointer";
    if (config.mode === "entry" && node.id === config._centerId) {
      circle.setAttribute("stroke", "var(--color-accent)");
      circle.setAttribute("stroke-width", "2");
    }

    circle.addEventListener("click", () => {
      if (node.kind === "resolved") {
        config.onNavigate(node.entryId);
      }
    });
    circle.addEventListener("dblclick", (event) => {
      if (node.kind === "unresolved") {
        event.preventDefault();
        createStubFromNode(node, circle, config);
      }
    });

    svg.appendChild(circle);
    nodeCircles.set(node.id, circle);

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("class", "graph-node-label");
    label.setAttribute("x", String(node.x));
    label.setAttribute("y", String(node.y + nodeRadius(node, config) + 12));
    label.setAttribute("text-anchor", "middle");
    label.textContent = node.title;
    svg.appendChild(label);
  }

  // Updates only this one node's fill/opacity in place -- no re-layout, no
  // position change, per spec (a stub being created shouldn't jolt the rest
  // of the graph around).
  function redrawNode(node, circle) {
    circle.setAttribute("fill", nodeFill(node));
    circle.setAttribute("fill-opacity", nodeFillOpacity(node));
    circle.removeAttribute("stroke");
    circle.removeAttribute("stroke-width");
  }

  // Reuses the identical entry-creation call editor.js's createStubEntry
  // uses (window.api.createEntry(worldId, {title, contentMarkdown: ""})),
  // same request body shape.
  async function createStubFromNode(node, circle, config) {
    try {
      const entry = await window.api.createEntry(config.worldId, {
        title: node.title,
        contentMarkdown: "",
      });
      node.kind = "resolved";
      node.entryId = entry.id;
      redrawNode(node, circle);
      config.onEntryCreated(entry);
    } catch (err) {
      config.onError(err && err.message ? err.message : String(err));
    }
  }

  function containerSize(container) {
    const rect = container.getBoundingClientRect();
    const width = Math.round(rect.width) || 900;
    const height = Math.round(rect.height) || 600;
    return { width, height };
  }

  // One renderer instance backs the full-screen modal, a second backs the
  // small embedded right-rail entry-graph panel -- each owns its own
  // svgEl/currentContainer/nodeCircles closure so the two can never
  // interfere with each other (see the module doc comment). Both share every
  // computation/layout/draw function above; only this render/close pairing
  // (plus which DOM element `render()` is pointed at) differs per instance.
  function createRenderer() {
    let svgEl = null;
    let currentContainer = null;
    let nodeCircles = new Map(); // node.id -> <circle> element, for redrawNode()

    // config.canvasSelector lets a caller point this at a different <svg>
    // than the modal's default #graph-canvas -- the embedded panel uses
    // #entry-graph-panel-canvas instead (see app.js's onOpenEntryGraphPanel/
    // css/graph.css).
    function svgElFor(container, config) {
      const selector = (config && config.canvasSelector) || "#graph-canvas";
      return container.querySelector(selector);
    }

    // Async: awaits the formal-Relation graph fetch (fetchEntryRelationGraph/
    // fetchWorldRelationGraph) before drawing, so the merged result renders
    // in one pass rather than the wikilink half flashing in first. Callers
    // don't need to await this themselves -- render() already shows/clears
    // the canvas synchronously up front, and a slow/failed relation fetch
    // only delays/omits the relation edges, never the wikilink ones (see the
    // module doc comment's graceful-degradation note).
    async function render(container, config) {
      currentContainer = container;
      container.hidden = false;

      const svg = svgElFor(container, config);
      svgEl = svg;
      clearSvg(svg);
      nodeCircles = new Map();

      // Canvas sizing is read after the container is made visible (`hidden`
      // was just cleared above) so getBoundingClientRect() reflects real
      // laid-out dimensions, not a collapsed hidden element -- falls back to
      // a fixed 900x600 default (see containerSize) if that still comes
      // back empty.
      const { width, height } = containerSize(svg);
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

      let local, centerId;
      if (config.mode === "entry") {
        local = computeEntryGraph(config.entries, config.centerEntryId);
        centerId = local.centerId;
      } else {
        local = computeWorldGraph(config.entries);
        centerId = null;
      }

      let relationGraph = null;
      if (config.mode === "entry" && config.centerEntryId) {
        relationGraph = await fetchEntryRelationGraph(config.centerEntryId, config.relationDepth);
      } else if (config.worldId) {
        relationGraph = await fetchWorldRelationGraph(config.worldId);
      }
      const merged = mergeGraphs(local, relationGraph);
      const nodes = merged.nodes;
      const edges = merged.edges;

      config._centerId = centerId;

      if (nodes.length === 0) {
        renderEmptyState(svg, width, height, config.mode === "entry" ? "No links yet" : "No entries yet");
        return;
      }

      if (config.mode === "entry") {
        const center = nodes.find((n) => n.id === centerId);
        const neighbors = nodes.filter((n) => n.id !== centerId);
        if (center) {
          layoutRadial(center, neighbors, width, height);
        } else {
          layoutForceDirected(nodes, edges, width, height);
        }
      } else {
        layoutForceDirected(nodes, edges, width, height);
      }

      const byId = new Map(nodes.map((n) => [n.id, n]));
      for (const edge of edges) {
        const a = byId.get(edge.source);
        const b = byId.get(edge.target);
        if (a && b) {
          drawEdge(svg, a, b, edge);
        }
      }
      for (const node of nodes) {
        drawNode(svg, node, config, nodeCircles);
      }
    }

    function close() {
      if (currentContainer) {
        currentContainer.hidden = true;
      }
      if (svgEl) {
        clearSvg(svgEl);
      }
    }

    return { render: render, close: close };
  }

  const modalRenderer = createRenderer();
  const panelRenderer = createRenderer();

  window.graph = {
    render: modalRenderer.render,
    close: modalRenderer.close,
    // Small embedded right-rail per-entry graph panel -- same merged
    // wikilink+relation data and radial layout as the modal's "entry" mode,
    // just a smaller chrome-free canvas (config.canvasSelector points it at
    // #entry-graph-panel-canvas instead of #graph-canvas). See app.js's
    // right-rail wiring.
    renderEntryPanel: panelRenderer.render,
    closeEntryPanel: panelRenderer.close,
  };
})();
