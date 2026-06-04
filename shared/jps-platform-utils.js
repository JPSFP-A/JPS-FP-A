// jps-platform-utils.js — shared JPS platform utilities
// UMD: works as <script> tag (window.JpsUtils) or CommonJS module.exports
// Source: canonical _syncDerivedFormulas + _arithEval ported from DataManager/CapEx/Treasury/O&M.
// Version: 1.0.0

(function(root) {
  'use strict';

  // CSP-safe arithmetic evaluator — replaces Function()/eval (blocked by CSP 'unsafe-eval').
  // Handles +, -, *, / and parentheses. Returns 0 on any parse error.
  function _arithEval(code) {
    if (typeof code !== 'string') return 0;
    var toks = [], re = /\s*([0-9]*\.?[0-9]+(?:[eE][+\-]?[0-9]+)?|[+\-*/()])\s*/g, last = 0, mm;
    while ((mm = re.exec(code)) !== null) { if (mm.index !== last) return 0; toks.push(mm[1]); last = re.lastIndex; }
    if (last !== code.length) return 0;
    var p = 0;
    function peek(){ return toks[p]; }
    function next(){ return toks[p++]; }
    function expr(){ var v=term(); while(peek()==='+'||peek()==='-'){ var o=next(); var r=term(); v=o==='+'?v+r:v-r; } return v; }
    function term(){ var v=factor(); while(peek()==='*'||peek()==='/'){ var o=next(); var r=factor(); v=o==='*'?v*r:(r===0?0:v/r); } return v; }
    function factor(){ var t=peek(); if(t==='+'){next();return factor();} if(t==='-'){next();return -factor();} if(t==='('){next();var v=expr();if(peek()===')')next();return v;} next(); var n=parseFloat(t); return isNaN(n)?0:n; }
    try { var r=expr(); return (typeof r==='number'&&isFinite(r))?r:0; } catch(e){ return 0; }
  }

  /**
   * syncDerivedFormulas — recalculates derived fpa_facts lines for a given version+year.
   *
   * Source-protection guard: never overwrites rows where source != 'formula'.
   * Fetches formula definitions ordered by sort_order so chained formulas resolve correctly.
   * Batches upserts in chunks of 500.
   *
   * @param {object} sbClient   - Supabase client (service role or anon with RLS allowing formula writes)
   * @param {string} versionId  - fpa_versions.id
   * @param {number} yr         - 4-digit year (e.g. 2026)
   * @returns {Promise<void>}
   */
  async function syncDerivedFormulas(sbClient, versionId, yr) {
    if (!sbClient || !versionId || !yr) return;
    try {
      // 1. Load formula definitions ordered by sort_order (chaining dependency)
      var _fResult = await sbClient
        .from('fpa_derived_formulas')
        .select('line_id,calc_expr,sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      var formulas = _fResult.data;
      var fErr = _fResult.error;
      if (fErr || !formulas || !formulas.length) return;

      // 2. Extract component line IDs from all formula expressions
      var componentIds = new Set();
      formulas.forEach(function(f) {
        var m; var re = /\b([A-Za-z][A-Za-z0-9_]*)\b/g;
        while ((m = re.exec(f.calc_expr)) !== null) componentIds.add(m[1]);
      });

      // 3. Fetch component facts for this version+year
      var _rResult = await sbClient
        .from('fpa_facts')
        .select('line_id,period_id,value')
        .eq('version_id', versionId)
        .in('line_id', Array.from(componentIds))
        .gte('period_id', yr * 100 + 1)
        .lte('period_id', yr * 100 + 12);
      var rows = _rResult.data;
      var rErr = _rResult.error;
      if (rErr || !rows || !rows.length) return;

      var facts = {};
      rows.forEach(function(r) {
        if (!facts[r.line_id]) facts[r.line_id] = {};
        facts[r.line_id][r.period_id] = r.value != null ? r.value : 0;
      });

      // 4. Determine sorted period list from available facts
      var periods = new Set();
      Object.values(facts).forEach(function(pm) {
        Object.keys(pm).forEach(function(p) { periods.add(Number(p)); });
      });
      if (!periods.size) return;
      var sortedPeriods = Array.from(periods).sort(function(a, b) { return a - b; });

      // 5. Source-protection guard — fetch all existing rows to identify non-formula sources
      //    Restrict to derived line_ids only to avoid a full-table scan on large versions
      var derivedLineIds = formulas.map(function(f) { return f.line_id; });
      var _efResult = await sbClient
        .from('fpa_facts')
        .select('line_id,period_id,source')
        .eq('version_id', versionId)
        .in('line_id', derivedLineIds);
      var _protectedKeys = new Set(
        (_efResult.data || [])
          .filter(function(r) { return r.source !== 'formula'; })
          .map(function(r) { return r.line_id + '|' + r.period_id; })
      );

      // 6. Evaluate each formula across all periods (in sort_order so chained lines resolve)
      var upsertRows = [];
      formulas.forEach(function(formula) {
        sortedPeriods.forEach(function(p) {
          // Sort keys longest-first to prevent partial substitution (e.g. ipp_total before ipp)
          var allKeys = Object.keys(facts).sort(function(a, b) { return b.length - a.length; });
          var code = formula.calc_expr;
          allKeys.forEach(function(k) {
            var v = (facts[k] && facts[k][p] != null) ? facts[k][p] : 0;
            code = code.replace(new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), String(v));
          });
          var val = _arithEval(code);
          upsertRows.push({ version_id: versionId, line_id: formula.line_id, period_id: p, value: val, source: 'formula' });
          // Make result available to downstream chained formulas
          if (!facts[formula.line_id]) facts[formula.line_id] = {};
          facts[formula.line_id][p] = val;
        });
      });

      // 7. Apply source-protection filter
      upsertRows = upsertRows.filter(function(row) {
        return !_protectedKeys.has(row.line_id + '|' + row.period_id);
      });

      // 8. Batch upsert in chunks of 500
      for (var i = 0; i < upsertRows.length; i += 500) {
        var _uResult = await sbClient
          .from('fpa_facts')
          .upsert(upsertRows.slice(i, i + 500), { onConflict: 'version_id,line_id,period_id' });
        if (_uResult.error) throw _uResult.error;
      }

      console.log('[JpsUtils] syncDerivedFormulas: recalculated', formulas.map(function(f) { return f.line_id; }).join(', '), 'for', versionId, 'yr', yr);
    } catch(e) {
      console.error('[JpsUtils] syncDerivedFormulas failed', e);
      throw e;
    }
  }

  var JpsUtils = {
    syncDerivedFormulas: syncDerivedFormulas,
    _arithEval: _arithEval,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = JpsUtils;
  } else {
    root.JpsUtils = JpsUtils;
  }

})(typeof self !== 'undefined' ? self : this);
