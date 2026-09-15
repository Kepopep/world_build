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

  // ---- Camera (pan/zoom) ---------------------------------------------------
  //
  // Deliberately does NOT touch the physics simulation's coordinate space at
  // all -- node.x/node.y, simulationTick's width/height params, boundary
  // clamping, and center-pull all stay exactly as they are today. Pan/zoom is
  // implemented purely as a change to which slice of that SAME coordinate
  // space the <svg>'s viewBox displays. That's what makes zoom grow/shrink
  // nodes and edges "for free": circle r/cx/cy and line coordinates/
  // stroke-width are plain unitless SVG user-space numbers (not CSS px), so
  // showing a smaller/larger slice of the same coordinate space across the
  // same fixed-pixel canvas naturally renders them bigger/smaller with no
  // extra per-element JS scaling code needed -- adding that on top would
  // double-apply the effect.

  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 4;
  // Below this zoom, node labels fade out entirely, leaving only dots +
  // connection lines (see updateViewBox's .graph-labels-hidden toggle and
  // css/graph.css) -- picked by feel: 0.6 is zoomed out enough that most
  // graphs' labels would already be crowding/overlapping each other anyway.
  const LABEL_HIDE_ZOOM = 0.6;

  // Applies `camera` ({zoom, panX, panY}) to the <svg>'s viewBox, against the
  // renderer's base canvas size (the same width/height the force simulation
  // itself uses -- see containerSize()/render()). Also flips the
  // .graph-labels-hidden class per LABEL_HIDE_ZOOM -- a single class toggle
  // here is far cheaper than touching every individual label's opacity on
  // every wheel/pan tick.
  function updateViewBox(svg, camera, width, height) {
    const viewWidth = width / camera.zoom;
    const viewHeight = height / camera.zoom;
    svg.setAttribute("viewBox", `${camera.panX} ${camera.panY} ${viewWidth} ${viewHeight}`);
    svg.classList.toggle("graph-labels-hidden", camera.zoom < LABEL_HIDE_ZOOM);
  }

  // Zooms `camera` in/out around one SVG-space point (svgX, svgY -- e.g. the
  // cursor position under a wheel event, already converted via toSvgPoint)
  // so that point stays visually fixed on screen, the standard "zoom to
  // cursor" behavior. `deltaY` is a wheel event's raw deltaY; the exponential
  // factor gives smooth behavior for both notchy mice and smooth trackpads
  // (many small deltaY events compound multiplicatively, one big one jumps
  // further, without needing separate code paths). Mutates `camera` in
  // place; the caller is responsible for calling updateViewBox() afterward
  // -- kept separate so callers can decide when the redraw happens.
  function zoomAtPoint(camera, width, height, svgX, svgY, deltaY) {
    const oldZoom = camera.zoom;
    const factor = Math.pow(1.0015, -deltaY);
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom * factor));
    if (newZoom === oldZoom) {
      return;
    }
    const oldViewWidth = width / oldZoom;
    const oldViewHeight = height / oldZoom;
    const newViewWidth = width / newZoom;
    const newViewHeight = height / newZoom;
    // svgX sits at a fixed fractional offset into the OLD viewBox rect
    // ((svgX - panX_old) / oldViewWidth) -- solving for the panX that puts
    // svgX at that SAME fractional offset into the NEW (differently-sized)
    // viewBox rect keeps it under the cursor across the zoom change.
    camera.panX = svgX - (svgX - camera.panX) * (newViewWidth / oldViewWidth);
    camera.panY = svgY - (svgY - camera.panY) * (newViewHeight / oldViewHeight);
    camera.zoom = newZoom;
  }

  // Pans `camera` by a raw client-pixel delta (e.g. from consecutive
  // pointermove events), converting it into SVG user-space units via the
  // ratio of the current viewBox size to the svg element's actual rendered
  // pixel size (`rectWidth`/`rectHeight`, i.e. getBoundingClientRect()) --
  // needed because the canvas's CSS pixel size and its viewBox's user-space
  // size are two independent numbers that only happen to match at zoom=1.
  // Subtracting the (scaled) delta from panX/panY is what makes the content
  // visually "follow" the cursor while dragging: moving the cursor right
  // (positive clientDeltaX) should shift the visible viewBox window LEFT
  // (decrease panX) so the same content point tracks rightward on screen --
  // the usual "grab and drag the canvas" convention.
  function panBy(camera, width, height, clientDeltaX, clientDeltaY, rectWidth, rectHeight) {
    const viewWidth = width / camera.zoom;
    const viewHeight = height / camera.zoom;
    const scaleX = rectWidth > 0 ? viewWidth / rectWidth : 1;
    const scaleY = rectHeight > 0 ? viewHeight / rectHeight : 1;
    camera.panX -= clientDeltaX * scaleX;
    camera.panY -= clientDeltaY * scaleY;
  }

  // Wires wheel-to-zoom and drag-empty-background-to-pan onto one renderer's
  // <svg>. Called exactly once per <svg> DOM element (see render()'s
  // svg.dataset.mythosPanZoomBound guard) -- render() can run many times
  // against the same element (reopening the modal, switching entry <->
  // world graph), and re-adding these listeners on every render would stack
  // duplicate handlers that each fire once per event. `getSize()` is a
  // closure back into createRenderer()'s live canvasWidth/canvasHeight
  // rather than a snapshot, since those can change across re-renders even
  // though the listeners themselves are only attached once.
  //
  // Pan starts on the svg's own pointerdown -- a node-circle drag never
  // reaches this listener because attachDragHandlers' pointerdown calls
  // stopPropagation() (see below), so any pointerdown that DOES bubble here
  // is guaranteed to have started on empty canvas background.
  function attachCameraControls(svg, camera, getSize) {
    svg.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const { width, height } = getSize();
        const p = toSvgPoint(svg, event.clientX, event.clientY);
        zoomAtPoint(camera, width, height, p.x, p.y, event.deltaY);
        updateViewBox(svg, camera, width, height);
      },
      { passive: false }
    );

    let panPointerId = null;
    let lastClientX = 0;
    let lastClientY = 0;

    svg.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      panPointerId = event.pointerId;
      lastClientX = event.clientX;
      lastClientY = event.clientY;
      svg.setPointerCapture(panPointerId);
      svg.classList.add("graph-panning");
    });

    svg.addEventListener("pointermove", (event) => {
      if (panPointerId === null || event.pointerId !== panPointerId) {
        return;
      }
      const { width, height } = getSize();
      const rect = svg.getBoundingClientRect();
      const dx = event.clientX - lastClientX;
      const dy = event.clientY - lastClientY;
      lastClientX = event.clientX;
      lastClientY = event.clientY;
      panBy(camera, width, height, dx, dy, rect.width, rect.height);
      updateViewBox(svg, camera, width, height);
    });

    function endPan(event) {
      if (panPointerId === null || event.pointerId !== panPointerId) {
        return;
      }
      svg.releasePointerCapture(panPointerId);
      panPointerId = null;
      svg.classList.remove("graph-panning");
    }
    svg.addEventListener("pointerup", endPan);
    svg.addEventListener("pointercancel", endPan);
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

  // An edge's resting color mirrors its two endpoints' own node color, same
  // rule as nodeFill() above: accent when both ends are resolved existing
  // entries, or the unresolved/warn color when either end is a stub
  // reference to a title with no matching Entry yet (on direct request:
  // "links to nonexistent entities [get] the same color as the circles of
  // those nonexistent entities"). Since a resolved-resolved edge is now
  // accent-colored rather than the old flat neutral border color, this
  // applies equally to relation edges (kind:'relation') -- those can only
  // ever connect two resolved entries in the first place, so they always
  // read as "accent", which is the intended "color of the existing entity"
  // reading for that case too.
  function edgeStrokeColor(a, b) {
    return a.kind === "unresolved" || b.kind === "unresolved" ? UNRESOLVED_COLOR : "var(--color-accent)";
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
    const stroke = edge && edge._a && edge._b ? edgeStrokeColor(edge._a, edge._b) : "var(--color-border)";
    line.setAttribute("stroke", stroke);
    line.setAttribute("stroke-width", "1.5");
    line.setAttribute("opacity", "0.6");
    // Base class every edge line gets, regardless of kind -- lets the hover
    // interaction's CSS (graph-edge-highlighted/graph-edge-dimmed, see
    // createHoverController below) target a stable, always-present selector
    // with a transition, the same reasoning as .graph-node-circle on nodes.
    // .graph-edge-wikilink layers on top of it for the dashed variant only,
    // via classList (not setAttribute("class", ...), which would clobber the
    // base class instead of adding alongside it).
    line.classList.add("graph-edge-line");
    if (!edge || edge.kind !== "relation") {
      line.classList.add("graph-edge-wikilink");
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
    // Base class (previously nothing) so the hover interaction's CSS
    // (graph-node-hovered/graph-node-neighbor/graph-node-dimmed, see
    // createHoverController below) has a stable always-present selector to
    // put a transition on -- enlarging/glowing is done entirely via this
    // class's `transform`/`filter`, never by touching r/cx/cy here, since
    // positionNode() below re-sets cx/cy/r every simulation tick and a
    // competing attribute write would just get overwritten on the next tick.
    circle.classList.add("graph-node-circle");
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
    // font-size as an SVG presentation ATTRIBUTE (a unitless user-space
    // number), not a CSS length (rem/px/em) -- a CSS font-size renders at a
    // constant SCREEN pixel size regardless of viewBox zoom, unlike r/cx/cy
    // on a circle or a line's coordinates, which are plain SVG user-space
    // numbers that scale automatically with the viewBox. Setting it this way
    // is what makes labels shrink/grow with zoom the same way nodes/edges
    // already do (see the "Camera (pan/zoom)" section above).
    label.setAttribute("font-size", "11");
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
      // Now that edge color mirrors its endpoints' kind (edgeStrokeColor),
      // every edge touching this node needs recoloring too -- it just went
      // from "nonexistent" to "existing", so an edge that was warn-colored
      // because of THIS end may now read as accent (or stay warn, if its
      // other end is a still-unresolved stub). config._drawableEdges/
      // config._edgeRefs are stashed by render() for exactly this, same
      // private-field convention as config._centerId above.
      const drawableEdges = config._drawableEdges || [];
      const edgeRefs = config._edgeRefs || [];
      drawableEdges.forEach((edge, idx) => {
        if (edge._a === node || edge._b === node) {
          edgeRefs[idx].line.setAttribute("stroke", edgeStrokeColor(edge._a, edge._b));
        }
      });
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

  // ---- Hover interaction ---------------------------------------------------
  //
  // Hovering a node highlights it + its direct neighbors (either edge
  // direction, either kind) and fades everything else, per CLAUDE.md's task
  // spec. Purely a classList toggle on the SAME circle/text/line elements
  // drawNodeInitial/drawEdgeInitial already created and the live simulation
  // is still repositioning every tick -- nothing here creates DOM, and
  // nothing here touches cx/cy/r/x1..y2 (positionNode/positionEdge own
  // those exclusively; fighting them from here would just flicker on the
  // next tick). Built once per render() call, not per node, since it needs
  // to reach every node/edge to dim the ones NOT connected to whichever one
  // is currently hovered.

  // nodeId -> { neighbors: Set<nodeId>, edgeIdxs: number[] } -- edgeIdxs
  // indexes into the same drawableEdges/edgeRefs arrays (parallel, built
  // together in render()), so "highlight the edges touching this node" is a
  // direct index lookup rather than a re-scan of every edge per hover.
  function buildAdjacency(drawableEdges) {
    const adjacency = new Map();
    function ensure(id) {
      if (!adjacency.has(id)) {
        adjacency.set(id, { neighbors: new Set(), edgeIdxs: [] });
      }
      return adjacency.get(id);
    }
    drawableEdges.forEach((edge, idx) => {
      const a = ensure(edge.source);
      const b = ensure(edge.target);
      a.neighbors.add(edge.target);
      b.neighbors.add(edge.source);
      a.edgeIdxs.push(idx);
      b.edgeIdxs.push(idx);
    });
    return adjacency;
  }

  // `apply`/`clear` are the only two operations needed: `apply(nodeId)`
  // always clears first, so hovering straight from one node to another (or
  // re-entering the same one) never leaves a previous highlight combined
  // with a new one. Every node/label/edge gets exactly one of the mutually
  // exclusive state classes at a time (hovered XOR neighbor XOR dimmed for
  // nodes/labels; highlighted XOR dimmed for edges) -- resting state is
  // "none of the above", handled by simply removing all of them.
  // `shrinkDimmedToDots` is only ever true for the full-world graph (see
  // render()'s `config.mode === "world"` check) -- on direct request, dimmed
  // nodes there shrink to small unlabeled dots rather than just fading, since
  // a whole-world graph can have far more off-topic nodes cluttering the view
  // than a 1-hop entry graph ever does. The entry-mode modal and the small
  // embedded right-rail panel keep the plain fade-only dimming from before.
  function createHoverController(nodes, nodeCircles, nodeLabels, edgeRefs, adjacency, shrinkDimmedToDots) {
    function clear() {
      for (const n of nodes) {
        const circle = nodeCircles.get(n.id);
        const label = nodeLabels.get(n.id);
        if (circle) {
          circle.classList.remove("graph-node-hovered", "graph-node-neighbor", "graph-node-dimmed", "graph-node-dot");
        }
        if (label) {
          label.classList.remove("graph-label-prominent", "graph-label-dimmed", "graph-label-hidden");
        }
      }
      for (const refs of edgeRefs) {
        refs.line.classList.remove("graph-edge-highlighted", "graph-edge-dimmed");
        if (refs.label) {
          refs.label.classList.remove("graph-edge-highlighted", "graph-edge-dimmed");
        }
      }
    }

    function apply(nodeId) {
      clear();
      const info = adjacency.get(nodeId);
      const neighborIds = info ? info.neighbors : new Set();
      const edgeIdxs = info ? new Set(info.edgeIdxs) : new Set();

      for (const n of nodes) {
        const circle = nodeCircles.get(n.id);
        const label = nodeLabels.get(n.id);
        const isHovered = n.id === nodeId;
        const isNeighbor = neighborIds.has(n.id);
        if (circle) {
          if (isHovered) {
            circle.classList.add("graph-node-hovered");
          } else if (isNeighbor) {
            circle.classList.add("graph-node-neighbor");
          } else {
            circle.classList.add("graph-node-dimmed");
            if (shrinkDimmedToDots) {
              circle.classList.add("graph-node-dot");
            }
          }
        }
        // Labels: hovered + neighbor stay/become MORE prominent (spec
        // requirement 5); everything else dims along with its node -- or,
        // on the full-world graph, disappears entirely (graph-label-hidden)
        // rather than just fading, per the "dots without labels" request.
        if (label) {
          if (isHovered || isNeighbor) {
            label.classList.add("graph-label-prominent");
          } else {
            label.classList.add(shrinkDimmedToDots ? "graph-label-hidden" : "graph-label-dimmed");
          }
        }
      }
      edgeRefs.forEach((refs, idx) => {
        const cls = edgeIdxs.has(idx) ? "graph-edge-highlighted" : "graph-edge-dimmed";
        refs.line.classList.add(cls);
        if (refs.label) {
          refs.label.classList.add(cls);
        }
      });
    }

    return { apply: apply, clear: clear };
  }

  // Wires mouseenter/mouseleave onto one node's circle -- deliberately
  // separate from attachDragHandlers (which owns pointerdown/pointermove/
  // click/dblclick) rather than folded into it, since hover and drag are
  // independent interactions with no shared state of their own (the one
  // place they DO interact -- pointer capture during a drag suppressing
  // native mouseleave -- is handled from attachDragHandlers' endDrag via the
  // same `hoverController` reference, not from here).
  function attachHoverHandlers(circle, nodeId, hoverController) {
    circle.addEventListener("mouseenter", () => hoverController.apply(nodeId));
    circle.addEventListener("mouseleave", () => hoverController.clear());
  }

  function attachDragHandlers(svg, circle, node, sim, config, hoverController, nodeCircles) {
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
      // Stop this from also reaching the svg-level camera-pan listener (see
      // attachCameraControls) -- without this, starting a node drag would
      // simultaneously start panning the camera underneath it, since
      // pointerdown bubbles from the circle up to its parent <svg> by
      // default.
      event.stopPropagation();
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
        // While a pointer is captured (setPointerCapture, above, for the
        // whole drag), the browser keeps targeting THIS circle for mouse
        // events regardless of where the cursor actually is -- so a
        // mouseleave never fires on this circle if the drag carried the
        // cursor off of it, and no OTHER circle's mouseenter fires either
        // even if the drag ended on top of one. Once capture is released
        // (just above), explicitly recompute hover state from the real
        // cursor position rather than trusting stale/missing native
        // mouseenter/mouseleave events to have kept it in sync.
        if (hoverController && nodeCircles) {
          const target = document.elementFromPoint(event.clientX, event.clientY);
          let hoveredId = null;
          for (const [id, c] of nodeCircles) {
            if (c === target) {
              hoveredId = id;
              break;
            }
          }
          if (hoveredId !== null) {
            hoverController.apply(hoveredId);
          } else {
            hoverController.clear();
          }
        }
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
    // Camera (pan/zoom) state for THIS renderer instance -- see the "Camera
    // (pan/zoom)" section above. A single long-lived object (mutated in
    // place, never reassigned) so attachCameraControls' event listeners --
    // which are only ever attached ONCE per <svg> element, see the
    // mythosPanZoomBound guard below -- keep seeing live updates across many
    // render() calls without needing to be re-attached. canvasWidth/Height
    // mirror the same width/height the force simulation itself uses; kept
    // here (not just a local in render()) so attachCameraControls' getSize()
    // closure can read whatever the MOST RECENT render() set, even though
    // the listeners predate that render call.
    const camera = { zoom: 1, panX: 0, panY: 0 };
    let canvasWidth = 900;
    let canvasHeight = 600;

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
      canvasWidth = width;
      canvasHeight = height;

      // Reset the camera on every fresh render() -- same "start clean"
      // treatment as nodeCircles/nodeLabels just above -- so reopening the
      // modal, or switching between the entry-graph and world-graph views,
      // always starts framed at the default view rather than wherever a
      // previous render's pan/zoom was left.
      camera.zoom = 1;
      camera.panX = 0;
      camera.panY = 0;
      updateViewBox(svg, camera, width, height);

      // Pan/zoom listeners are attached to the <svg> element itself exactly
      // ONCE -- render() can run many times against the same DOM element
      // (clearSvg() only empties its children, it never replaces the <svg>
      // node), and re-adding these on every render would stack duplicate
      // listeners that each independently react to the same wheel/pointer
      // event. The dataset flag lives on the element, so it survives
      // exactly as long as the element itself does.
      if (!svg.dataset.mythosPanZoomBound) {
        attachCameraControls(svg, camera, () => ({ width: canvasWidth, height: canvasHeight }));
        svg.dataset.mythosPanZoomBound = "true";
      }

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
      // Stashed on config so createStubFromNode (called much later, from a
      // dblclick on some node's circle) can find + recolor the edges
      // touching whichever node just flipped from unresolved to resolved --
      // same private-field-on-config convention as config._centerId.
      config._drawableEdges = drawableEdges;
      config._edgeRefs = edgeRefs;
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

      // Built once per render, after drawableEdges/edgeRefs both exist (see
      // the "Hover interaction" section above) -- adjacency indexes into
      // edgeRefs by position, so it has to be built from the same
      // drawableEdges array edgeRefs was mapped from, not the raw `edges`.
      const adjacency = buildAdjacency(drawableEdges);
      const hoverController = createHoverController(
        nodes, nodeCircles, nodeLabels, edgeRefs, adjacency, config.mode === "world"
      );

      // Wire drag/click/dblclick/hover now that `sim` and `hoverController`
      // both exist (dragging needs to call sim.reheat(); its drag-end also
      // needs hoverController to resync hover state post-capture-release,
      // see attachDragHandlers' endDrag) -- one listener set per node circle.
      for (const node of nodes) {
        const circle = nodeCircles.get(node.id);
        attachDragHandlers(svg, circle, node, sim, config, hoverController, nodeCircles);
        attachHoverHandlers(circle, node.id, hoverController);
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

    // Resets ONLY the camera (zoom/pan) back to the default framed view --
    // deliberately does not touch the force-layout/node positions at all,
    // per spec ("recentering only resets the camera, never the graph's
    // shape"). A no-op if nothing has been rendered yet (svgEl is only set
    // inside render()).
    function recenter() {
      if (!svgEl) {
        return;
      }
      camera.zoom = 1;
      camera.panX = 0;
      camera.panY = 0;
      updateViewBox(svgEl, camera, canvasWidth, canvasHeight);
    }

    return { render: render, close: close, recenter: recenter };
  }

  const modalRenderer = createRenderer();
  const panelRenderer = createRenderer();

  window.graph = {
    render: modalRenderer.render,
    close: modalRenderer.close,
    // Resets the modal's camera (pan/zoom) back to the default framed view
    // without touching the graph's own layout -- wired to the modal
    // header's recenter button in app.js. Pan/zoom itself works on BOTH
    // renderer instances (createRenderer() wires it generically), but a
    // recenter BUTTON only exists in the modal's chrome -- the embedded
    // right-rail panel has no header to put one in (see CLAUDE.md's task
    // note on this).
    recenter: modalRenderer.recenter,
    // Small embedded right-rail per-entry graph panel -- same merged
    // wikilink+relation data and live simulation (radial seed, same as the
    // modal's "entry" mode), just a smaller chrome-free canvas
    // (config.canvasSelector points it at #entry-graph-panel-canvas instead
    // of #graph-canvas). See app.js's right-rail wiring.
    renderEntryPanel: panelRenderer.render,
    closeEntryPanel: panelRenderer.close,
  };
})();
