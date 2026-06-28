/* jps-nav.js — JPS platform shared navigation strip.
 * Injects a fixed top bar with the app switcher, current-app highlight,
 * signed-in user chip and platform-wide logout (via JpsAuth.signOutAll).
 *
 * Usage:
 *   <script src="shared/jps-auth.js"></script>
 *   <script src="shared/jps-nav.js"></script>
 *   // after the app's Supabase client exists:
 *   JpsNav.bind(client);   // wires user chip + logout, listens to auth changes
 */
(function (root) {
  'use strict';

  /* accessId = app_id in admin.app_access (checked via get_my_app_access RPC) */
  var APPS = [
    { id: 'hub',         accessId: 'fpa_hub',     name: 'Finance Hub',    url: 'https://jmfinancelab.com' },
    { id: 'treasury',    accessId: 'treasury',    name: 'Treasury',    url: 'https://treasury.jmfinancelab.com' },
    { id: 'sales',       accessId: 'sales',       name: 'Sales',       url: 'https://sales.jmfinancelab.com' },
    { id: 'om',          accessId: 'om',          name: 'O&M',         url: 'https://om.jmfinancelab.com' },
    { id: 'capex',       accessId: 'capex',       name: 'CapEx',       url: 'https://capex.jmfinancelab.com' },
    { id: 'datamanager', accessId: 'datamanager', name: 'DataManager', url: 'https://datamanager.jmfinancelab.com' },
    { id: 'cash',        accessId: 'cashflow',    name: 'Cash',        url: 'https://cash.jmfinancelab.com' },
    { id: 'workforce',   accessId: 'labour_cap',  name: 'Workforce',   url: 'https://workforce.jmfinancelab.com' },
    { id: 'tracker',     accessId: 'tracker',     name: 'Tracker',     url: 'https://tracker.jmfinancelab.com' },
    { id: 'admin',       accessId: 'admin',       name: 'Admin',       url: 'https://admin.jmfinancelab.com' }
  ];

  var BAR_H = 38;
  var _client = null;
  var _emailEl = null;
  var _logoutBtn = null;
  var _linkEls = {};   // app id -> <a> element, for access-based show/hide

  function currentAppId() {
    var h = root.location.hostname;
    if (h === 'jmfinancelab.com' || h === 'www.jmfinancelab.com') return 'hub';
    var sub = h.split('.')[0];
    for (var i = 0; i < APPS.length; i++) {
      if (APPS[i].id === sub) return APPS[i].id;
    }
    return null; // vercel.app preview or unknown — no highlight
  }

  function el(tag, css, text) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text != null) n.textContent = text;
    return n;
  }

  function inject() {
    if (document.getElementById('jps-nav-bar')) return;

    var cur = currentAppId();
    var bar = el('div');
    bar.id = 'jps-nav-bar';
    bar.style.cssText =
      'position:fixed;top:0;left:0;right:0;height:' + BAR_H + 'px;z-index:2147483000;' +
      'display:flex;align-items:center;gap:2px;padding:0 10px;box-sizing:border-box;' +
      'background:#0d1e3a;border-bottom:2px solid #00aeef;' +
      "font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:12.5px;";

    var brand = el('span',
      'color:#00aeef;font-weight:700;letter-spacing:.06em;margin-right:10px;', 'JPS');
    bar.appendChild(brand);

    APPS.forEach(function (app) {
      var a = el('a', '', app.name);
      a.href = app.url;
      var active = app.id === cur;
      a.style.cssText =
        'padding:4px 9px;border-radius:5px;text-decoration:none;white-space:nowrap;' +
        (active
          ? 'background:#00aeef;color:#0d1e3a;font-weight:600;cursor:default;'
          : 'color:#cfe3f5;');
      if (active) a.addEventListener('click', function (e) { e.preventDefault(); });
      else {
        a.addEventListener('mouseenter', function () { a.style.background = '#173050'; });
        a.addEventListener('mouseleave', function () { a.style.background = 'transparent'; });
      }
      _linkEls[app.id] = a;
      bar.appendChild(a);
    });

    var spacer = el('span', 'flex:1;');
    bar.appendChild(spacer);

    _emailEl = el('span', 'color:#8fa9c4;margin-right:8px;', '');
    bar.appendChild(_emailEl);

    _logoutBtn = el('button', '', 'Sign out all');
    _logoutBtn.style.cssText =
      'background:transparent;border:1px solid #2a4a73;color:#cfe3f5;border-radius:5px;' +
      'padding:3px 10px;cursor:pointer;font:inherit;display:none;';
    _logoutBtn.addEventListener('click', function () {
      if (!_client || !root.JpsAuth) return;
      _logoutBtn.disabled = true;
      JpsAuth.signOutAll(_client)
        .catch(function () { /* error already logged by JpsAuth; still reload to login */ })
        .finally(function () { root.location.reload(); });
    });
    bar.appendChild(_logoutBtn);

    document.body.appendChild(bar);

    // push page content down without fighting app CSS
    var prev = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
    document.body.style.paddingTop = (prev + BAR_H) + 'px';
  }

  function renderUser(session) {
    if (!_emailEl) return;
    var email = session && session.user && session.user.email || '';
    _emailEl.textContent = email;
    _logoutBtn.style.display = email ? 'inline-block' : 'none';
  }

  /* Hide links the signed-in user has no access to (admin.app_access via RPC).
   * Fail-open: if the RPC errors, leave all links visible — links are UX,
   * actual protection is each app's login gate + RLS. Signed out: show all. */
  function applyAccess(session) {
    if (!session) {
      APPS.forEach(function (app) { if (_linkEls[app.id]) _linkEls[app.id].style.display = ''; });
      return;
    }
    _client.rpc('get_my_app_access').then(function (res) {
      if (res.error || !Array.isArray(res.data)) {
        if (res.error) console.warn('[jps-nav] access RPC failed, showing all links:', res.error.message);
        return;
      }
      var allowed = {};
      res.data.forEach(function (r) { if (r.can_access) allowed[r.app_id] = true; });
      APPS.forEach(function (app) {
        if (_linkEls[app.id]) _linkEls[app.id].style.display = allowed[app.accessId] ? '' : 'none';
      });
    });
  }

  var JpsNav = {
    apps: APPS,
    bind: function (client) {
      _client = client;
      client.auth.getSession().then(function (res) {
        var session = res && res.data && res.data.session;
        renderUser(session);
        applyAccess(session);
      });
      client.auth.onAuthStateChange(function (_evt, session) {
        renderUser(session);
        applyAccess(session);
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

  root.JpsNav = JpsNav;
})(window);
