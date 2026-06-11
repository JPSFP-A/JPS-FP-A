/* jps-auth.js — JPS platform shared SSO storage adapter.
 * Stores the Supabase auth session in a cookie on .jmfinancelab.com so all
 * platform apps (apex + subdomains) share one login. Falls back to
 * localStorage when running off-domain (vercel.app previews, localhost).
 *
 * Usage:
 *   supabase.createClient(URL, KEY, JpsAuth.clientOptions())
 *   // optionally merge: JpsAuth.clientOptions({ detectSessionInUrl: false })
 */
(function (root) {
  'use strict';

  var APEX = 'jmfinancelab.com';
  var STORAGE_KEY = 'jps_sso_v1';
  var CHUNK = 2000;            // raw chars per cookie; URI-encoding can inflate ~1.5x, keep under 4096 incl. name+attrs
  var MAX_CHUNKS = 8;
  var MAX_AGE = 60 * 60 * 24 * 180; // 180 days, outlives refresh-token rotation

  function onPlatformDomain() {
    var h = root.location && root.location.hostname || '';
    return h === APEX || h.endsWith('.' + APEX);
  }

  function setCookie(name, value, maxAge) {
    var attrs = '; Domain=.' + APEX + '; Path=/; Max-Age=' + maxAge +
                '; Secure; SameSite=Lax';
    document.cookie = name + '=' + encodeURIComponent(value) + attrs;
  }

  function getCookie(name) {
    var m = document.cookie.match('(?:^|;\\s*)' + name.replace(/[.[\]]/g, '\\$&') + '=([^;]*)');
    return m ? decodeURIComponent(m[1]) : null;
  }

  function delCookie(name) {
    setCookie(name, '', 0);
  }

  var cookieStorage = {
    getItem: function (key) {
      var whole = getCookie(key);
      if (whole !== null) return whole;
      var parts = [];
      for (var i = 0; i < MAX_CHUNKS; i++) {
        var c = getCookie(key + '.' + i);
        if (c === null) break;
        parts.push(c);
      }
      return parts.length ? parts.join('') : null;
    },
    setItem: function (key, value) {
      this.removeItem(key);
      if (value.length <= CHUNK) {
        setCookie(key, value, MAX_AGE);
        return;
      }
      for (var i = 0; i * CHUNK < value.length && i < MAX_CHUNKS; i++) {
        setCookie(key + '.' + i, value.slice(i * CHUNK, (i + 1) * CHUNK), MAX_AGE);
      }
    },
    removeItem: function (key) {
      delCookie(key);
      for (var i = 0; i < MAX_CHUNKS; i++) delCookie(key + '.' + i);
    }
  };

  var JpsAuth = {
    STORAGE_KEY: STORAGE_KEY,
    isPlatform: onPlatformDomain(),
    storage: onPlatformDomain() ? cookieStorage : root.localStorage,
    clientOptions: function (extra) {
      var auth = {
        storage: this.storage,
        storageKey: STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      };
      if (extra) for (var k in extra) auth[k] = extra[k];
      return { auth: auth };
    },
    /* Global sign-out: revokes the shared session, clears the shared cookie.
     * Every platform app loses the session at once. */
    signOutAll: function (sbClient) {
      var self = this;
      return sbClient.auth.signOut({ scope: 'global' })
        .catch(function (e) {
          if (root.JpsMonitor && JpsMonitor.logError) JpsMonitor.logError('jps-auth signOutAll', e);
          throw e;
        })
        .finally(function () { self.storage.removeItem(STORAGE_KEY); });
    }
  };

  root.JpsAuth = JpsAuth;
})(window);
