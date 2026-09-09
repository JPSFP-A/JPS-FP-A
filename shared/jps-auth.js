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
    },
    /* Cross-app session sync -- mitigates a refresh-token race inherent to
     * sharing one cookie-backed session across many independent origins.
     * Each subdomain runs its own supabase-js client with its own
     * autoRefreshToken timer. Refresh tokens rotate on use: whichever app
     * refreshes first writes the new token pair to the shared cookie, and
     * every other already-open app is left holding the now-consumed
     * refresh token in memory. When that app's own timer later fires,
     * Supabase rejects the reused refresh token and the client silently
     * drops to anonymous -- every subsequent authenticated write then
     * fails RLS with "new row violates row-level security policy", not an
     * auth error, because the request goes out anon rather than failing to
     * send. There's no native cross-origin signal for this (the `storage`
     * event that lets supabase-js coordinate same-origin tabs never fires
     * for cookies, and each subdomain is a different origin anyway), so
     * this polls the shared cookie directly and adopts whatever's newest
     * via setSession() -- an app that lost the race picks up the winner's
     * fresh tokens instead of trying (and failing) to refresh its own
     * stale copy.
     *
     * Call once, right after creating the client:
     *   var client = supabase.createClient(URL, KEY, JpsAuth.clientOptions())
     *   JpsAuth.startSessionSync(client)
     */
    startSessionSync: function (client, opts) {
      var self = this;
      var intervalMs = (opts && opts.intervalMs) || 15000;
      var lastSeenToken = null;
      var timer = null;

      function storedSession() {
        try {
          var raw = self.storage.getItem(STORAGE_KEY);
          if (!raw) return null;
          var parsed = JSON.parse(raw);
          return (parsed && parsed.access_token && parsed.refresh_token) ? parsed : null;
        } catch (e) { return null; }
      }

      function sync() {
        var stored = storedSession();
        if (!stored || stored.access_token === lastSeenToken) return;
        client.auth.getSession().then(function (res) {
          var current = res && res.data && res.data.session;
          if (current && current.access_token === stored.access_token) {
            lastSeenToken = stored.access_token;
            return;
          }
          // Storage holds a token this client hasn't adopted -- another
          // tab/app already refreshed. Adopt it directly rather than
          // letting our own refresh timer fire later with our stale
          // (already-used) refresh token.
          return client.auth.setSession({
            access_token: stored.access_token,
            refresh_token: stored.refresh_token
          }).then(function () { lastSeenToken = stored.access_token; });
        }).catch(function (e) {
          if (root.JpsMonitor && JpsMonitor.logError) JpsMonitor.logError('jps-auth sessionSync', e);
        });
      }

      timer = root.setInterval(sync, intervalMs);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(); });
      root.addEventListener('focus', sync);
      sync();

      return function stopSessionSync() { root.clearInterval(timer); };
    }
  };

  root.JpsAuth = JpsAuth;
})(window);
