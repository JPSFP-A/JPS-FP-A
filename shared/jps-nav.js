/* jps-nav.js — JPS platform shared navigation strip.
 * Injects a fixed top bar with the app switcher, current-app highlight,
 * signed-in user chip and platform-wide logout (via JpsAuth.signOutAll).
 * Mobile: hamburger + full-width dropdown drawer below the bar.
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
    { id: 'treasury',    accessId: 'treasury',    name: 'Treasury',       url: 'https://treasury.jmfinancelab.com' },
    { id: 'sales',       accessId: 'sales',       name: 'Sales',          url: 'https://sales.jmfinancelab.com' },
    { id: 'om',          accessId: 'om',          name: 'O&M',            url: 'https://om.jmfinancelab.com' },
    { id: 'capex',       accessId: 'capex',       name: 'CapEx',          url: 'https://capex.jmfinancelab.com' },
    { id: 'datamanager', accessId: 'datamanager', name: 'DataManager',    url: 'https://datamanager.jmfinancelab.com' },
    { id: 'cash',        accessId: 'cashflow',    name: 'Cash',           url: 'https://cash.jmfinancelab.com' },
    { id: 'workforce',   accessId: 'labour_cap',  name: 'Workforce',      url: 'https://workforce.jmfinancelab.com' },
    { id: 'tracker',     accessId: 'tracker',     name: 'Tracker',        url: 'https://tracker.jmfinancelab.com' },
    { id: 'admin',       accessId: 'admin',       name: 'Admin',          url: 'https://admin.jmfinancelab.com' }
  ];

  var BAR_H   = 38;
  var _client     = null;
  var _emailEl    = null;
  var _logoutBtn  = null;
  var _hamburger  = null;
  var _dropdown   = null;
  var _menuOpen   = false;
  var _linkEls     = {};   // app id -> bar <a> element
  var _dropLinkEls = {};   // app id -> dropdown <a> element

  function currentAppId() {
    var h = root.location.hostname;
    if (h === 'jmfinancelab.com' || h === 'www.jmfinancelab.com') return 'hub';
    var sub = h.split('.')[0];
    for (var i = 0; i < APPS.length; i++) {
      if (APPS[i].id === sub) return APPS[i].id;
    }
    return null;
  }

  function el(tag, css, text) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text != null) n.textContent = text;
    return n;
  }

  function injectStyles() {
    if (document.getElementById('jps-nav-styles')) return;
    var s = document.createElement('style');
    s.id = 'jps-nav-styles';
    s.textContent =
      '#jps-nav-links{display:flex;align-items:center;gap:2px;overflow:hidden;}' +
      '#jps-nav-hamburger{display:none;background:transparent;border:1px solid #2a4a73;' +
        'color:#cfe3f5;cursor:pointer;padding:3px 9px;border-radius:5px;font-size:17px;line-height:1;' +
        "font-family:'IBM Plex Sans',system-ui,sans-serif;}" +
      '#jps-nav-hamburger[aria-expanded="true"]{background:#173050;}' +
      '#jps-nav-hamburger:focus-visible{outline:2px solid #00aeef;outline-offset:2px;}' +
      '#jps-nav-dropdown{display:none;position:fixed;top:' + BAR_H + 'px;left:0;right:0;' +
        'background:#0d1e3a;border-bottom:2px solid #00aeef;z-index:2147482999;' +
        'padding:8px;flex-direction:column;gap:2px;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.4);}' +
      '#jps-nav-dropdown.open{display:flex;}' +
      '#jps-nav-dropdown a{padding:11px 14px;color:#cfe3f5;text-decoration:none;border-radius:6px;' +
        "font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:13.5px;display:block;}" +
      '#jps-nav-dropdown a:hover{background:#173050;}' +
      '#jps-nav-dropdown a[aria-current="page"]{background:#00aeef;color:#0d1e3a;font-weight:600;}' +
      '#jps-nav-dropdown a:focus-visible{outline:2px solid #00aeef;outline-offset:2px;}' +
      '@media(max-width:767px){' +
        '#jps-nav-links{display:none;}' +
        '#jps-nav-hamburger{display:inline-block;}' +
        '#jps-nav-email{display:none;}' +
      '}';
    document.head.appendChild(s);
  }

  function closeMenu() {
    _menuOpen = false;
    if (_dropdown)  _dropdown.classList.remove('open');
    if (_hamburger) {
      _hamburger.setAttribute('aria-expanded', 'false');
      _hamburger.textContent = '☰';
    }
  }

  function toggleMenu() {
    _menuOpen = !_menuOpen;
    if (_dropdown)  _dropdown.classList.toggle('open', _menuOpen);
    if (_hamburger) {
      _hamburger.setAttribute('aria-expanded', String(_menuOpen));
      _hamburger.textContent = _menuOpen ? '✕' : '☰';
    }
    if (_menuOpen) {
      var first = _dropdown.querySelector('a:not([style*="display: none"]):not([style*="display:none"])');
      if (first) setTimeout(function () { first.focus(); }, 16);
    }
  }

  function inject() {
    if (document.getElementById('jps-nav-bar')) return;
    injectStyles();

    var cur = currentAppId();

    /* ---- bar ---- */
    var bar = el('nav');
    bar.id = 'jps-nav-bar';
    bar.setAttribute('role', 'navigation');
    bar.setAttribute('aria-label', 'JPS platform navigation');
    bar.style.cssText =
      'position:fixed;top:0;left:0;right:0;height:' + BAR_H + 'px;z-index:2147483000;' +
      'display:flex;align-items:center;gap:2px;padding:0 10px;box-sizing:border-box;' +
      'background:#0d1e3a;border-bottom:2px solid #00aeef;' +
      "font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:12.5px;";

    var brand = el('span',
      'color:#00aeef;font-weight:700;letter-spacing:.06em;margin-right:8px;flex-shrink:0;', 'JPS');
    bar.appendChild(brand);

    /* desktop link strip */
    var linkStrip = el('div');
    linkStrip.id = 'jps-nav-links';
    APPS.forEach(function (app) {
      var a = el('a', '', app.name);
      a.href = app.url;
      var active = app.id === cur;
      a.style.cssText =
        'padding:4px 9px;border-radius:5px;text-decoration:none;white-space:nowrap;' +
        (active ? 'background:#00aeef;color:#0d1e3a;font-weight:600;cursor:default;'
                : 'color:#cfe3f5;');
      if (active) {
        a.setAttribute('aria-current', 'page');
        a.addEventListener('click', function (e) { e.preventDefault(); });
      } else {
        a.addEventListener('mouseenter', function () { a.style.background = '#173050'; });
        a.addEventListener('mouseleave', function () { a.style.background = 'transparent'; });
      }
      _linkEls[app.id] = a;
      linkStrip.appendChild(a);
    });
    bar.appendChild(linkStrip);

    /* spacer */
    bar.appendChild(el('span', 'flex:1;'));

    /* hamburger */
    _hamburger = el('button', '', '☰');
    _hamburger.id = 'jps-nav-hamburger';
    _hamburger.setAttribute('aria-label', 'Open app menu');
    _hamburger.setAttribute('aria-expanded', 'false');
    _hamburger.setAttribute('aria-controls', 'jps-nav-dropdown');
    _hamburger.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleMenu();
    });
    bar.appendChild(_hamburger);

    /* email chip */
    _emailEl = el('span', '', '');
    _emailEl.id = 'jps-nav-email';
    _emailEl.style.cssText = 'color:#8fa9c4;margin-right:8px;max-width:180px;' +
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;';
    bar.appendChild(_emailEl);

    /* logout */
    _logoutBtn = el('button', '', 'Sign out all');
    _logoutBtn.style.cssText =
      'background:transparent;border:1px solid #2a4a73;color:#cfe3f5;border-radius:5px;' +
      'padding:3px 10px;cursor:pointer;font:inherit;display:none;flex-shrink:0;';
    _logoutBtn.addEventListener('click', function () {
      if (!_client || !root.JpsAuth) return;
      _logoutBtn.disabled = true;
      JpsAuth.signOutAll(_client)
        .catch(function () {})
        .finally(function () { root.location.reload(); });
    });
    bar.appendChild(_logoutBtn);

    /* ---- dropdown (mobile) ---- */
    _dropdown = el('div');
    _dropdown.id = 'jps-nav-dropdown';
    _dropdown.setAttribute('role', 'menu');
    APPS.forEach(function (app) {
      var a = el('a', '', app.name);
      a.href = app.url;
      a.setAttribute('role', 'menuitem');
      var active = app.id === cur;
      if (active) {
        a.setAttribute('aria-current', 'page');
        a.addEventListener('click', function (e) { e.preventDefault(); closeMenu(); });
      } else {
        a.addEventListener('click', function () { closeMenu(); });
      }
      a.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { closeMenu(); if (_hamburger) _hamburger.focus(); }
      });
      _dropLinkEls[app.id] = a;
      _dropdown.appendChild(a);
    });

    document.body.appendChild(bar);
    document.body.appendChild(_dropdown);

    /* close dropdown on outside click */
    document.addEventListener('click', function (e) {
      if (_menuOpen && !bar.contains(e.target) && !_dropdown.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _menuOpen) { closeMenu(); if (_hamburger) _hamburger.focus(); }
    });

    /* push page content down */
    var prev = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
    document.body.style.paddingTop = (prev + BAR_H) + 'px';
  }

  function renderUser(session) {
    if (!_emailEl) return;
    var email = session && session.user && session.user.email || '';
    _emailEl.textContent = email;
    _emailEl.title = email;
    _logoutBtn.style.display = email ? 'inline-block' : 'none';
  }

  /* Hide links the signed-in user has no access to.
   * Fail-open: if the RPC errors, leave all links visible. */
  function applyAccess(session) {
    if (!session) {
      APPS.forEach(function (app) {
        if (_linkEls[app.id])     _linkEls[app.id].style.display = '';
        if (_dropLinkEls[app.id]) _dropLinkEls[app.id].style.display = '';
      });
      return;
    }
    APPS.forEach(function (app) {
      if (_linkEls[app.id])     _linkEls[app.id].style.opacity = '.4';
      if (_dropLinkEls[app.id]) _dropLinkEls[app.id].style.opacity = '.4';
    });
    _client.rpc('get_my_app_access').then(function (res) {
      if (res.error || !Array.isArray(res.data)) {
        if (res.error) console.warn('[jps-nav] access RPC failed, showing all links:', res.error.message);
        APPS.forEach(function (app) {
          if (_linkEls[app.id])     _linkEls[app.id].style.opacity = '';
          if (_dropLinkEls[app.id]) _dropLinkEls[app.id].style.opacity = '';
        });
        return;
      }
      var allowed = {};
      res.data.forEach(function (r) { if (r.can_access) allowed[r.app_id] = true; });
      APPS.forEach(function (app) {
        var show = allowed[app.accessId] ? '' : 'none';
        if (_linkEls[app.id])     { _linkEls[app.id].style.opacity = '';     _linkEls[app.id].style.display = show; }
        if (_dropLinkEls[app.id]) { _dropLinkEls[app.id].style.opacity = ''; _dropLinkEls[app.id].style.display = show; }
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
