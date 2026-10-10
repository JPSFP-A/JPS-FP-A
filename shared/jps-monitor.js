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

  // ── Data-access audit: views, exports, prints ─────────
  // Records who opened, downloaded or printed data, through the log_data_access RPC
  // (public.audit_log, shown in the IT audit view). The database stamps the user and the real
  // source IP; this script only says what happened. Nothing is logged until setUser() has run.
  function _warn(what, err) {
    try { if (root.console) root.console.warn('[audit]', what, (err && err.message) || err || ''); } catch (e) {}
  }
  function _appId() {
    return String(_app || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 40);
  }
  function _audit(action, details) {
    try {
      if (!_cfn || !_uid) return;
      var c = _cfn();
      if (!c || !c.rpc) return;
      c.rpc('log_data_access', { p_app: _appId(), p_action: action, p_details: details || {} })
        .then(function (r) { if (r && r.error) _warn(action, r.error); }, function (e) { _warn(action, e); });
    } catch (e) { _warn(action, e); }
  }
  // Page path plus hash route. A hash that looks like a credential is dropped, never logged.
  function _target() {
    try {
      var loc = root.location;
      if (!loc) return '';
      var h = loc.hash || '';
      if (/token|code=|key=|secret|password|session/i.test(h)) h = '';
      return (loc.pathname + h).slice(0, 200);
    } catch (e) { return ''; }
  }
  var _lastEvt = {};
  function _once(kind, key) {
    var now = Date.now();
    var last = _lastEvt[kind];
    if (last && last.key === key && now - last.t < 3000) return false;
    _lastEvt[kind] = { key: key, t: now };
    return true;
  }
  function _noteDownload(a) {
    var name = String(a.getAttribute('download') || '').slice(0, 200);
    if (_once('dl', name)) _audit('data_exported', { file: name, target: _target() });
  }
  function _view() { _audit('data_viewed', { target: _target() }); }

  var _hooked = false;
  function _installHooks() {
    if (_hooked || !root.document || !root.HTMLAnchorElement) return;
    _hooked = true;
    var aClick = root.HTMLAnchorElement.prototype.click;
    root.HTMLAnchorElement.prototype.click = function () {
      try { if (this.hasAttribute('download')) _noteDownload(this); } catch (e) { _warn('download hook', e); }
      return aClick.apply(this, arguments);
    };
    // FileSaver-style libraries trigger the download by dispatching a click event on a detached anchor.
    var dispatch = root.EventTarget.prototype.dispatchEvent;
    root.EventTarget.prototype.dispatchEvent = function (ev) {
      try {
        if (ev && ev.type === 'click' && this instanceof root.HTMLAnchorElement && this.hasAttribute('download')) _noteDownload(this);
      } catch (e) { _warn('download hook', e); }
      return dispatch.apply(this, arguments);
    };
    // A person clicking a visible download link.
    root.document.addEventListener('click', function (ev) {
      try {
        var a = ev.target && ev.target.closest && ev.target.closest('a[download]');
        if (a) _noteDownload(a);
      } catch (e) { _warn('download hook', e); }
    }, true);
    // window.print() and Ctrl+P both fire beforeprint.
    root.addEventListener('beforeprint', function () {
      if (_once('print', _target())) _audit('data_printed', { target: _target() });
    });
    root.addEventListener('hashchange', _view);
    root.addEventListener('popstate', _view);
  }
  _installHooks();

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
      _view();
    },

    /** Explicit hook for an in-app page or report change that does not change the URL. */
    auditView:   function(target) { _audit('record_viewed', { target: String(target || _target()).slice(0, 200) }); },
    auditExport: function(what, rows) { _audit('data_exported', { file: String(what || '').slice(0, 200), rows: rows == null ? null : rows, target: _target() }); },

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
