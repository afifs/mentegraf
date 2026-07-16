/**
 * nodeSizing.js — weighted-degree node sizing for Mentegraf / s-graf
 *
 * Sizes each node by the sum of (connected edge weights).
 * Area-true scaling: perceived circle AREA is proportional to weighted
 * degree, so radius grows with sqrt(degree). Sizes are normalized per
 * graph between minSize and maxSize, so any project looks sensible
 * regardless of its absolute weight range.
 *
 * Usage (in app.js, after cy is created):
 *
 *   NodeSizing.bind(cy);                    // enable with defaults
 *   NodeSizing.setMode(cy, 'out');          // s-graf: size by influence
 *   NodeSizing.disable(cy);                 // back to normal sizes
 *
 * Requires one stylesheet rule — see INTEGRATION.md.
 *
 * Assumptions (change in DEFAULTS if Mentegraf differs):
 *   - edge weight lives in edge.data('weight')
 *   - a missing/invalid weight counts as 1
 */
/* global cytoscape */
const NodeSizing = (function () {
    'use strict';

    const DEFAULTS = {
        enabled: true,
        mode: 'total',        // 'total' | 'in' | 'out'  (in/out need directed edges)
        minSize: 26,          // diameter (px) of the least-connected node
        maxSize: 88,          // diameter (px) of the most-connected node
        weightKey: 'weight',  // edge data field holding the weight
        defaultWeight: 1,     // used when an edge has no numeric weight
        useAbs: true,         // count negative (dampening) weights by magnitude
        debounceMs: 150       // recompute delay after graph edits
    };

    // one options object per cy instance
    const registry = new WeakMap();

    /* ------------------------------------------------------------------ */

    function edgeWeight(edge, opts) {
        const raw = Number(edge.data(opts.weightKey));
        const w = Number.isFinite(raw) ? raw : opts.defaultWeight;
        return opts.useAbs ? Math.abs(w) : w;
    }

    function weightedDegree(node, opts) {
        let sum = 0;
        node.connectedEdges().forEach(function (e) {
            if (opts.mode === 'in'  && e.target().id() !== node.id()) return;
            if (opts.mode === 'out' && e.source().id() !== node.id()) return;
            sum += edgeWeight(e, opts);
        });
        return sum;
    }

    /**
     * Compute and write sizes for every node.
     * Writes node.data('_wdeg')  — the raw weighted degree (useful for
     *                              tooltips: "influence: 3.4")
     * Writes node.data('_wsize') — the diameter the stylesheet maps to
     *                              width/height. Removed when disabled.
     */
    function apply(cy, options) {
        const opts = Object.assign({}, DEFAULTS, registry.get(cy), options);
        registry.set(cy, opts);

        const nodes = cy.nodes();
        if (nodes.length === 0) return;

        if (!opts.enabled) {
            cy.batch(function () {
                nodes.forEach(function (n) { n.removeData('_wsize'); });
            });
            return;
        }

        // pass 1: degrees, on sqrt scale (area-true perception)
        const roots = new Map();
        let lo = Infinity, hi = -Infinity;
        nodes.forEach(function (n) {
            const d = weightedDegree(n, opts);
            const r = Math.sqrt(Math.max(d, 0));
            roots.set(n.id(), { deg: d, root: r });
            if (r < lo) lo = r;
            if (r > hi) hi = r;
        });

        // pass 2: normalize into [minSize, maxSize]
        const span = hi - lo;
        cy.batch(function () {
            nodes.forEach(function (n) {
                const rec = roots.get(n.id());
                const t = span > 0 ? (rec.root - lo) / span : 0.5; // all equal → mid size
                const size = Math.round(opts.minSize + t * (opts.maxSize - opts.minSize));
                n.data('_wdeg', Math.round(rec.deg * 100) / 100);
                n.data('_wsize', size);
            });
        });
    }

    /* ------------------------------------------------------------------ */

    function debounce(fn, ms) {
        let t = null;
        return function () {
            clearTimeout(t);
            t = setTimeout(fn, ms);
        };
    }

    /**
     * Enable sizing and keep it current: recomputes (debounced) whenever
     * nodes/edges are added, removed, or an edge's data changes (e.g. the
     * user edits a weight). Returns an unbind function.
     */
    function bind(cy, options) {
        const opts = Object.assign({}, DEFAULTS, options);
        registry.set(cy, opts);

        const refresh = debounce(function () { apply(cy); }, opts.debounceMs);

        cy.on('add remove', 'node', refresh);
        cy.on('add remove data', 'edge', refresh);

        apply(cy);

        return function unbind() {
            cy.off('add remove', 'node', refresh);
            cy.off('add remove data', 'edge', refresh);
            disable(cy);
        };
    }

    function disable(cy) {
        const opts = Object.assign({}, DEFAULTS, registry.get(cy), { enabled: false });
        registry.set(cy, opts);
        apply(cy);
    }

    function enable(cy) {
        const opts = Object.assign({}, DEFAULTS, registry.get(cy), { enabled: true });
        registry.set(cy, opts);
        apply(cy);
    }

    /** mode: 'total' | 'in' | 'out' — in/out only meaningful with directed edges */
    function setMode(cy, mode) {
        const opts = Object.assign({}, DEFAULTS, registry.get(cy), { mode: mode });
        registry.set(cy, opts);
        apply(cy);
    }

    /** current options (for persisting into the settings file) */
    function getOptions(cy) {
        return Object.assign({}, DEFAULTS, registry.get(cy));
    }

    return {
        bind: bind,
        apply: apply,
        enable: enable,
        disable: disable,
        setMode: setMode,
        getOptions: getOptions,
        DEFAULTS: DEFAULTS
    };
})();

// CommonJS export for Electron renderer if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NodeSizing;
}