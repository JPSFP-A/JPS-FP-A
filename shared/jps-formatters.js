/**
 * jps-formatters.js — JPS canonical number formatter library
 *
 * UMD: available as window.JpsFmt in browsers, module.exports in Node.
 *
 * Conventions (all formatters):
 *   - null / undefined / NaN  →  '—'
 *   - Zero                     →  '—'
 *   - Negative                 →  parentheses  (123)  not minus sign
 */
(function (root) {
  'use strict';

  // ── safe numeric parse ────────────────────────────────────────────────────
  function _safe(v) {
    var n = parseFloat(v);
    return (isNaN(n) || !isFinite(n)) ? null : n;
  }

  // ── comma separator (plain, no symbol) ───────────────────────────────────
  function _commas(abs, dp) {
    return abs.toFixed(dp).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // ── parentheses wrapper ───────────────────────────────────────────────────
  function _paren(abs, dp) {
    return '(' + _commas(abs, dp) + ')';
  }

  /**
   * _fmtM(v, dp=0)
   * Format as thousands with commas.  Negative → parentheses.  Zero → '—'.
   * Used for JMD $000s table cells (no currency prefix).
   */
  function _fmtM(v, dp) {
    dp = (dp == null) ? 0 : dp;
    var n = _safe(v);
    if (n === null) return '—';
    if (n === 0) return '—';
    var abs = Math.abs(n);
    if (n < 0) return _paren(abs, dp);
    return _commas(abs, dp);
  }

  /**
   * _fmtN(v, dp=0)
   * Generic number formatter: K / M suffix, no symbol.  Zero → '—'.
   * Negative values in parentheses.
   */
  function _fmtN(v, dp) {
    dp = (dp == null) ? 0 : dp;
    var n = _safe(v);
    if (n === null) return '—';
    if (n === 0) return '—';
    var abs = Math.abs(n);
    var s;
    if (abs >= 1e6)      { s = (abs / 1e6).toFixed(dp) + 'M'; }
    else if (abs >= 1e3) { s = (abs / 1e3).toFixed(dp) + 'K'; }
    else                 { s = abs.toFixed(dp); }
    return n < 0 ? '(' + s + ')' : s;
  }

  /**
   * _fmtK(v, dp=1)
   * Divide by 1 000, show as e.g. "1.5K" or "2.3M".  No symbol.  Zero → '—'.
   */
  function _fmtK(v, dp) {
    dp = (dp == null) ? 1 : dp;
    var n = _safe(v);
    if (n === null) return '—';
    if (n === 0) return '—';
    var abs = Math.abs(n);
    var s;
    if (abs >= 1e6)      { s = (abs / 1e6).toFixed(dp) + 'M'; }
    else if (abs >= 1e3) { s = (abs / 1e3).toFixed(dp) + 'K'; }
    else                 { s = abs.toFixed(dp); }
    return n < 0 ? '(' + s + ')' : s;
  }

  /**
   * _fmtJMD(v, dp=0)
   * JMD currency with "J$" prefix, full thousands separator.  Zero → '—'.
   * Negative → (J$123).
   */
  function _fmtJMD(v, dp) {
    dp = (dp == null) ? 0 : dp;
    var n = _safe(v);
    if (n === null) return '—';
    if (n === 0) return '—';
    var abs = Math.abs(n);
    var body = 'J$' + abs.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return n < 0 ? '(' + body + ')' : body;
  }

  /**
   * _fmtUSD(v, dp=0)
   * USD currency with "$" prefix, full thousands separator.  Zero → '—'.
   * Negative → ($123).
   */
  function _fmtUSD(v, dp) {
    dp = (dp == null) ? 0 : dp;
    var n = _safe(v);
    if (n === null) return '—';
    if (n === 0) return '—';
    var abs = Math.abs(n);
    var body = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return n < 0 ? '(' + body + ')' : body;
  }

  /**
   * _fmtMusd(v)
   * USD abbreviated: $1.2M / $500.0K / $42.  Zero → '—'.
   */
  function _fmtMusd(v) {
    var n = _safe(v);
    if (n === null) return '—';
    if (n === 0) return '—';
    var abs = Math.abs(n);
    var s;
    if (abs >= 1e6)      { s = '$' + (abs / 1e6).toFixed(1) + 'M'; }
    else if (abs >= 1e3) { s = '$' + (abs / 1e3).toFixed(1) + 'K'; }
    else                 { s = '$' + abs.toFixed(0); }
    return n < 0 ? '(' + s + ')' : s;
  }

  /**
   * _fmtCost(v, dp=0)
   * Cost / expense formatter.  Values stored positive, shown positive.
   * Zero → '—'.  Negative (unusual) shown in parentheses for safety.
   */
  function _fmtCost(v, dp) {
    dp = (dp == null) ? 0 : dp;
    var n = _safe(v);
    if (n === null) return '—';
    var abs = Math.abs(n);
    if (abs === 0) return '—';
    return _commas(abs, dp);
  }

  /**
   * _fmtPct(act, bud)
   * Variance %: (act − bud) / |bud| × 100, formatted as "+X.X%" or "−X.X%".
   * Returns '—' when bud is zero or non-finite.
   */
  function _fmtPct(act, bud) {
    var b = _safe(bud);
    if (b === null || b === 0) return '—';
    var a = _safe(act);
    if (a === null) return '—';
    var p = ((a - b) / Math.abs(b)) * 100;
    return (p >= 0 ? '+' : '') + p.toFixed(1) + '%';
  }

  /**
   * fmtVar(v)
   * Variance cell value — plain text "+X.XK" / "(X.XK)" using _fmtN.
   * Returns '—' for null/NaN.
   */
  function fmtVar(v) {
    var n = _safe(v);
    if (n === null) return '—';
    if (n === 0) return '—';
    // use _fmtN (K/M suffix) — negative already handled by _fmtN parentheses
    var abs = Math.abs(n);
    var s;
    if (abs >= 1e6)      { s = (abs / 1e6).toFixed(1) + 'M'; }
    else if (abs >= 1e3) { s = (abs / 1e3).toFixed(1) + 'K'; }
    else                 { s = abs.toFixed(0); }
    if (n < 0) return '(' + s + ')';
    return '+' + s;
  }

  // ── export ────────────────────────────────────────────────────────────────
  var JpsFmt = {
    _fmtM:    _fmtM,
    _fmtN:    _fmtN,
    _fmtK:    _fmtK,
    _fmtJMD:  _fmtJMD,
    _fmtUSD:  _fmtUSD,
    _fmtMusd: _fmtMusd,
    _fmtCost: _fmtCost,
    _fmtPct:  _fmtPct,
    fmtVar:   fmtVar
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = JpsFmt;
  } else {
    root.JpsFmt = JpsFmt;
  }

})(typeof self !== 'undefined' ? self : this);
