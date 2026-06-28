// ═══════════════════════════════════════════════════════
//  JPS PLATFORM MONITOR  v2.0  (canonical)
//  UMD IIFE — works as <script src> or CommonJS require.
//
//  Usage (in every app's <head>, after this script):
//    JpsMonitor.setApp('hub');          // set app name
//    // after login:
//    JpsMonitor._clientFn = () => sb;  // wire Supabase client
//    JpsMonitor.setUser(uid, email);    // start heartbeat
//
//  Heartbeat: record_heartbeat RPC every 60 s (p_app, p_user_id)
//  Logging:   info/warning/error write to platform_audit_results
// ═══════════════════════════════════════════════════════

(function (root) {
  'use strict';

  var _uid    = null;
  var _email  = null;
  var _app    = 'unknown';
  var _cfn    = null;   // function() => supabase client

  // ── Heartbeat ─────────────────────────────────────────
  function _beat() {
    try {
      if (_cfn && _uid) {
        var c = _cfn();
        if (c && c.rpc) {
          // record_heartbeat takes a single p_app arg
          c.rpc('record_heartbeat', { p_app: _app })
           .then(function(){}).catch(function(){});
        }
      }
    } catch(e) {}
  }

  setInterval(_beat, 60000);

  // ── Error writer → platform_audit_results (schema-correct) ───
  function _uuid() {
    try { if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID(); } catch(e) {}
    return '00000000-0000-0000-0000-000000000000';
  }
  function _log(level, evt, msg) {
    try {
      if (_cfn && _uid) {
        var c = _cfn();
        if (c && c.from) {
          c.from('platform_audit_results').insert({
            app:          _app,
            check_name:   evt   || 'event',
            check_type:   'monitor',
            status:       level,
            message:      msg   || level,
            run_id:       _uuid(),
            run_at:       new Date().toISOString(),
            triggered_by: 'monitor'
          }).then(function(){}).catch(function(){});
        }
      }
    } catch(e) {}
  }

  // ── Public API ────────────────────────────────────────
  var JpsMonitor = {

    /** Wire the Supabase client factory BEFORE calling setUser. */
    _clientFn: null,

    /** Set the app name (call once at startup). */
    setApp: function(appName) {
      _app = appName || 'unknown';
    },

    /**
     * Call after login. Stores uid + email, syncs _cfn from
     * JpsMonitor._clientFn, and fires the first heartbeat.
     */
    setUser: function(id, email) {
      _uid   = id    || null;
      _email = email || null;
      _cfn   = JpsMonitor._clientFn || _cfn;
      _beat();
    },

    // info/warning are console-only (originally no-ops) — avoids flooding the audit table.
    info:    function(evt, msg) { try { if (root.console) root.console.info('[mon]', evt, msg || ''); } catch(e){} },
    warning: function(evt, msg) { try { if (root.console) root.console.warn('[mon]', evt, msg || ''); } catch(e){} },
    error:   function(evt, msg) { _log('error', evt, msg); },

    /** Legacy compat — some apps call JpsMonitor.init() */
    init: function(opts) {
      if (!opts) return;
      if (opts.appName)   { _app = opts.appName; }
      if (opts.getClient) { _cfn = opts.getClient; JpsMonitor._clientFn = opts.getClient; }
      if (opts.user && opts.user.id) { JpsMonitor.setUser(opts.user.id, opts.user.name || opts.user.email); }
    },

    /** Legacy compat — some apps call _beat() directly. */
    _beat: _beat,
  };

  // UMD export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = JpsMonitor;
  } else {
    root.JpsMonitor = JpsMonitor;
  }

})(typeof self !== 'undefined' ? self : this);
