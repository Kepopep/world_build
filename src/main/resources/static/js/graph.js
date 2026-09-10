// Relationship graph, merging TWO sources into one view (per CLAUDE.md's
// graph decision):
//   - client-side [[wikilink]]-derived nodes/edges, computed locally from
//     already-loaded entry content (computeWorldGraph/computeEntryGraph) --
//     the original, still-independent-of-the-backend half.
//   - the formal Relation/RelationDefinition graph, fetched from
//     GET /api/graph/world/{worldId} / GET /api/graph/entry/{id} and merged
//     in (fetchWorldRelationGraph/fetchEntryRelationGraph + mergeGraphs).
// Nodes are deduped by entry id; edges carry a `kind: 'relation'|'wikilink'`
// so drawEdgeInitial() can render solid+labeled (relation) vs dashed
// (wikilink) distinctly. Two views: a full-world graph (every entry as a
// node) and a per-entry graph (the open entry plus its 1-hop neighbors from
// either source, in+out, no edges between two neighbors on the wikilink
// side -- the relation side's depth-1 BFS result is used as returned).
//
// The graph is a live, draggable force simulation, not a static one-shot
// layout -- see the "Live force simulation" section below: nodes repel each
// other, edges act as springs (so dragging one node drags its connected
// chain along), every node drifts toward the viewport center, and the
// simulation cools down and stops on its own once nothing is being dragged.
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
// svg/node-circle/simulation state so the two can never clobber each other
// if both happen to have been rendered at some point (only one is ever
// visible at a time in practice, but nothing here assumes that), and so
// each has exactly one live RAF loop, stopped on close()/re-render().
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
  // node already carries everything drawNodeInitial() needs). Relation
  // edges are tagged kind:'relation' and keep their label/
  // relationDefinitionId for drawEdgeInitial() to render solid+labeled.
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

  // ---- Live force simulation ----------------------------------------------
  //
  // The graph is a continuously-running, draggable physics simulation, not a
  // one-shot layout: nodes repel each other, edges act as springs pulling
  // their two endpoints toward a resting distance (so dragging one node
  // drags its whole connected chain along), and every node is drawn toward
  // the viewport center. Hand-rolled rather than pulling in d3-force -- no
  // new dependency, consistent with the "no framework/bundler" rule (see
  // CLAUDE.md tech stack) -- but follows the same shape: forces are scaled
  // by a cooling `alpha` that decays every tick, so the simulation settles
  // and the RAF loop stops on its own once nothing is left to react to.
  // Dragging (see attachDragHandlers below) reheats alpha, which both
  // un-freezes the motion and restarts the loop if it had already stopped.

  const ALPHA_DECAY = 0.02;   // per-tick cooldown -- alpha *= (1 - this)
  const ALPHA_MIN = 0.002;    // below this the layout is considered settled
  const REPULSION = 9000;
  const SPRING_LEN = 120;
  const SPRING_K = 0.03;
  const CENTER_PULL = 0.03;
  const VELOCITY_DECAY = 0.8;
  const BOUNDARY_PADDING = 30;

  // Seeds starting positions only -- a reasonable arrangement for the
  // simulation to relax from, not a fixed target. Entry mode starts the
  // center node in the middle with its neighbors around it in a circle
  // (nicer initial frame than everything spawning on top of each other);
  // world mode just spreads every node around a circle. Every node is
  // reset to non-fixed with zero velocity, including on re-render.
  function seedPositions(nodes, width, height, mode, centerId) {
    if (mode === "entry" && centerId && nodes.some((n) => n.id === centerId)) {
      const center = nodes.find((n) => n.id === centerId);
      const others = nodes.filter((n) => n.id !== centerId);
      center.x = width / 2;
      center.y = height / 2;
      const radius = Math.min(width, height) * 0.32;
      others.forEach((n, i) => {
        const a = (i / Math.max(others.length, 1)) * 2 * Math.PI - Math.PI / 2;
        n.x = center.x + Math.cos(a) * radius;
        n.y = center.y + Math.sin(a) * radius;
      });
    } else {
      const cx = width / 2, cy = height / 2;
      nodes.forEach((n, i) => {
        const a = (i / Math.max(nodes.length, 1)) * 2 * Math.PI;
        n.x = cx + Math.cos(a) * Math.min(width, height) / 3;
        n.y = cy + Math.sin(a) * Math.min(width, height) / 3;
      });
    }
    for (const n of nodes) {
      n.vx = 0;
      n.vy = 0;
      n.fixed = false;
    }
    return nodes;
  }

  // One physics step: repulsion between every node pair (O(n^2), fine at
  // 60fps for the small graphs this view shows), spring forces along every
  // edge, then center gravity + velocity integration. A node with
  // `fixed: true` (currently being dragged) is skipped by the integration
  // step -- its position is being driven directly by the pointer instead --
  // but it still exerts repulsion/spring forces on everyone else, which is
  // exactly what makes the rest of the graph react while it's being dragged.
  function simulationTick(nodes, edges, width, height, alpha) {
    const cx = width / 2, cy = height / 2;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          // Coincident nodes -- nudge apart in a random direction so they
          // don't sit stacked on each other forever.
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const f = (REPULSION * alpha) / d2;
        const fx = (f * dx) / d, fy = (f * dy) / d;
        if (!a.fixed) { a.vx -= fx; a.vy -= fy; }
        if (!b.fixed) { b.vx += fx; b.vy += fy; }
      }
    }
    for (const e of edges) {
      const a = e._a, b = e._b;
      if (!a || !b) {
        continue;
      }
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.max(Math.hypot(dx, dy), 0.01);
      const k = SPRING_K * (d - SPRING_LEN) * alpha;
      const fx = (k * dx) / d, fy = (k * dy) / d;
      if (!a.fixed) { a.vx += fx; a.vy += fy; }
      if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
    }
    for (const n of nodes) {
      if (n.fixed) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx += (cx - n.x) * CENTER_PULL * alpha;
      n.vy += (cy - n.y) * CENTER_PULL * alpha;
      n.vx *= VELOCITY_DECAY;
      n.vy *= VELOCITY_DECAY;
      n.x += n.vx;
      n.y += n.vy;
      n.x = Math.min(Math.max(n.x, BOUNDARY_PADDING), Math.max(width - BOUNDARY_PADDING, BOUNDARY_PADDING));
      n.y = Math.min(Math.max(n.y, BOUNDARY_PADDING), Math.max(height - BOUNDARY_PADDING, BOUNDARY_PADDING));
    }
  }

  // Owns the requestAnimationFrame loop for one simulation. `start()` is
  // idempotent (a no-op while already running); `reheat()` is what a drag
  // interaction calls on every pointer move -- it tops alpha back up (so
  // the layout is actively responsive again, not still coasting toward
  // zero) and restarts the loop if it had already cooled down and stopped.
  // `stop()` is a hard cancel, used when the view is closed/re-rendered.
  function createSimulationController(nodes, edges, width, height, onTick) {
    let alpha = 1;
    let rafId = null;

    function loop() {
      simulationTick(nodes, edges, width, height, alpha);
      alpha *= 1 - ALPHA_DECAY;
      onTick();
      if (alpha > ALPHA_MIN) {
        rafId = requestAnimationFrame(loop);
      } else {
        rafId = null;
      }
    }

    function start() {
      if (rafId === null) {
        rafId = requestAnimationFrame(loop);
      }
    }

    function reheat() {
      alpha = Math.max(alpha, 0.9);
      start();
    }

    function stop() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    return { start: start, reheat: reheat, stop: stop };
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

  // Edges and nodes are each created ONCE (drawEdgeInitial/drawNodeInitial)
  // and then repositioned in place every simulation tick
  // (positionEdge/positionNode) rather than torn down and recreated -- a
  // live 60fps simulation recreating the whole SVG subtree every frame
  // would both be slow and drop the drag/click listeners attached below.
  // `edge` is optional on drawEdgeInitial (falls back to a plain
  // wikilink-style line if omitted) -- relation edges (kind:'relation')
  // render solid with a text label at the midpoint; wikilink edges
  // (kind:'wikilink', or no edge at all) render dashed via the
  // .graph-edge-wikilink class (css/graph.css).
  function drawEdgeInitial(svg, edge) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("stroke", "var(--color-border)");
    line.setAttribute("stroke-width", "1.5");
    line.setAttribute("opacity", "0.6");
    if (!edge || edge.kind !== "relation") {
      line.setAttribute("class", "graph-edge-wikilink");
    }
    svg.appendChild(line);

    let label = null;
    if (edge && edge.kind === "relation" && edge.label) {
      label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("class", "graph-edge-label");
      label.textContent = edge.label;
      svg.appendChild(label);
    }
    return { line: line, label: label };
  }

  function positionEdge(a, b, refs) {
    refs.line.setAttribute("x1", String(a.x));
    refs.line.setAttribute("y1", String(a.y));
    refs.line.setAttribute("x2", String(b.x));
    refs.line.setAttribute("y2", String(b.y));
    if (refs.label) {
      refs.label.setAttribute("x", String((a.x + b.x) / 2));
      refs.label.setAttribute("y", String((a.y + b.y) / 2 - 4));
    }
  }

  // `nodeCircles` is an out-param (Map<node.id, circle>) rather than closed-
  // over module state -- see the Rendering section's createRenderer()
  // factory, which owns one such map per renderer instance (modal vs. the
  // embedded entry-graph panel) so the two can never clobber each other's
  // redrawNode() lookups. Click/drag interaction is wired separately by
  // attachDragHandlers() once the simulation controller exists, since
  // dragging needs to reheat it.
  function drawNodeInitial(svg, node, config, nodeCircles, nodeLabels) {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("r", String(nodeRadius(node, config)));
    circle.setAttribute("fill", nodeFill(node));
    circle.setAttribute("fill-opacity", nodeFillOpacity(node));
    circle.style.cursor = "grab";
    circle.style.touchAction = "none"; // let pointer events drive dragging, not touch-scroll
    if (config.mode === "entry" && node.id === config._centerId) {
      circle.setAttribute("stroke", "var(--color-accent)");
      circle.setAttribute("stroke-width", "2");
    }
    svg.appendChild(circle);
    nodeCircles.set(node.id, circle);

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("class", "graph-node-label");
    label.setAttribute("text-anchor", "middle");
    label.textContent = node.title;
    svg.appendChild(label);
    nodeLabels.set(node.id, label);

    return circle;
  }

  function positionNode(node, config, circle, label) {
    circle.setAttribute("cx", String(node.x));
    circle.setAttribute("cy", String(node.y));
    label.setAttribute("x", String(node.x));
    label.setAttribute("y", String(node.y + nodeRadius(node, config) + 12));
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

  // Converts a pointer event's viewport coordinates into the <svg>'s own
  // user-space coordinates via its screen CTM, rather than assuming
  // client pixels line up 1:1 with the viewBox -- correct regardless of how
  // the canvas is scaled by CSS (the embedded right-rail panel is a fixed
  // 260px-tall box, the modal canvas fills its panel, neither necessarily
  // matches the viewBox's own width/height numerically).
  function toSvgPoint(svg, clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) {
      return { x: clientX, y: clientY };
    }
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  // Wires drag-to-reposition + click-to-navigate + dblclick-to-create-stub
  // onto one node's circle. A node only becomes `fixed` (pinned to the
  // pointer, exempted from the simulation's own integration -- see
  // simulationTick) once the pointer has actually moved past a small
  // threshold, so a plain click never freezes/reheats anything; dragging
  // reheats the simulation on every move so the rest of the graph reacts
  // live, and once more on release so connected nodes get a few ticks to
  // resettle before everything cools back down to a stop. The `click`
  // handler ignores the synthetic click that follows a real drag (browsers
  // fire one on pointerup regardless), so dragging a node never also
  // navigates to it.
  const DRAG_THRESHOLD = 4;

  function attachDragHandlers(svg, circle, node, sim, config) {
    let pointerId = null;
    let downX = 0, downY = 0;
    let moved = false;

    circle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      pointerId = event.pointerId;
      circle.setPointerCapture(pointerId);
      moved = false;
      downX = event.clientX;
      downY = event.clientY;
      event.preventDefault();
    });

    circle.addEventListener("pointermove", (event) => {
      if (pointerId === null || event.pointerId !== pointerId) {
        return;
      }
      if (!moved) {
        const dx = event.clientX - downX, dy = event.clientY - downY;
        if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) {
          return;
        }
        moved = true;
        node.fixed = true;
        circle.style.cursor = "grabbing";
      }
      const p = toSvgPoint(svg, event.clientX, event.clientY);
      node.x = p.x;
      node.y = p.y;
      sim.reheat();
    });

    function endDrag(event) {
      if (pointerId === null || event.pointerId !== pointerId) {
        return;
      }
      circle.releasePointerCapture(pointerId);
      pointerId = null;
      if (moved) {
        node.fixed = false;
        circle.style.cursor = "grab";
        sim.reheat();
      }
    }
    circle.addEventListener("pointerup", endDrag);
    circle.addEventListener("pointercancel", endDrag);

    circle.addEventListener("click", (event) => {
      if (moved) {
        event.preventDefault();
        event.stopPropagation();
        moved = false;
        return;
      }
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
  }

  function containerSize(container) {
    const rect = container.getBoundingClientRect();
    const width = Math.round(rect.width) || 900;
    const height = Math.round(rect.height) || 600;
    return { width, height };
  }

  // One renderer instance backs the full-screen modal, a second backs the
  // small embedded right-rail entry-graph panel -- each owns its own
  // svgEl/currentContainer/nodeCircles/currentSim closure so the two can
  // never interfere with each other (see the module doc comment). Both
  // share every computation/simulation/draw function above; only this
  // render/close pairing (plus which DOM element `render()` is pointed at)
  // differs per instance. `currentSim` is the live force simulation backing
  // whichever graph this instance most recently rendered -- render() stops
  // any previous one before starting a fresh one, and close() stops it too,
  // so there's never more than one RAF loop per renderer instance and none
  // keep running once hidden.
  function createRenderer() {
    let svgEl = null;
    let currentContainer = null;
    let nodeCircles = new Map(); // node.id -> <circle> element, for redrawNode()
    let currentSim = null;

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

      // Stop any simulation already running for this renderer instance
      // before tearing down its DOM -- otherwise a stale RAF loop from a
      // previous render (e.g. switching from one entry's panel to
      // another's) would keep ticking against nodes/edges whose circles
      // and lines no longer exist.
      if (currentSim) {
        currentSim.stop();
        currentSim = null;
      }

      const svg = svgElFor(container, config);
      svgEl = svg;
      clearSvg(svg);
      nodeCircles = new Map();
      const nodeLabels = new Map();

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

      seedPositions(nodes, width, height, config.mode, centerId);

      // Resolve each edge's endpoint node references once up front
      // (e._a/_b) rather than doing a byId.get() lookup on every single
      // simulation tick -- these are the same node objects seedPositions
      // just placed, so the sim always reads their current live x/y.
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const drawableEdges = [];
      for (const edge of edges) {
        const a = byId.get(edge.source);
        const b = byId.get(edge.target);
        if (a && b) {
          edge._a = a;
          edge._b = b;
          drawableEdges.push(edge);
        }
      }

      // Create every edge/node element once, up front (drawEdgeInitial/
      // drawNodeInitial) -- edges first so nodes paint on top, same z-order
      // as before. The simulation's onTick callback below only ever
      // repositions these, never recreates them.
      const edgeRefs = drawableEdges.map((edge) => drawEdgeInitial(svg, edge));
      for (const node of nodes) {
        drawNodeInitial(svg, node, config, nodeCircles, nodeLabels);
      }

      const sim = createSimulationController(nodes, drawableEdges, width, height, () => {
        for (const node of nodes) {
          positionNode(node, config, nodeCircles.get(node.id), nodeLabels.get(node.id));
        }
        for (let i = 0; i < drawableEdges.length; i++) {
          positionEdge(drawableEdges[i]._a, drawableEdges[i]._b, edgeRefs[i]);
        }
      });
      currentSim = sim;

      // Wire drag/click/dblclick now that `sim` exists (dragging needs to
      // call sim.reheat()) -- one listener set per node circle.
      for (const node of nodes) {
        attachDragHandlers(svg, nodeCircles.get(node.id), node, sim, config);
      }

      // Paint the seeded starting positions immediately so there's no
      // blank first frame before the RAF loop's first tick, then start the
      // live simulation -- it cools down and stops on its own (see
      // createSimulationController), and dragging reheats it again.
      for (const node of nodes) {
        positionNode(node, config, nodeCircles.get(node.id), nodeLabels.get(node.id));
      }
      for (let i = 0; i < drawableEdges.length; i++) {
        positionEdge(drawableEdges[i]._a, drawableEdges[i]._b, edgeRefs[i]);
      }
      sim.start();
    }

    function close() {
      if (currentSim) {
        currentSim.stop();
        currentSim = null;
      }
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
    // wikilink+relation data and live simulation (radial seed, same as the
    // modal's "entry" mode), just a smaller chrome-free canvas
    // (config.canvasSelector points it at #entry-graph-panel-canvas instead
    // of #graph-canvas). See app.js's right-rail wiring.
    renderEntryPanel: panelRenderer.render,
    closeEntryPanel: panelRenderer.close,
  };
})();
