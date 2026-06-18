// ==========================================================================
// Gem Factory Extractor — Google Cloud Storage client
//
// All functions are async (Promise-returning). They are attached to the
// global `window.GemFactoryGCS` so popup.js can call them directly. The
// extension uses chrome.identity to acquire an OAuth access token on behalf
// of the signed-in Chrome profile; the bucket grants devstorage.read_write
// to the user's identity (or to a group containing them).
// ==========================================================================

(function (root) {
  // ---------- OAuth ----------

  function getAccessToken(interactive) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.identity.getAuthToken({ interactive: interactive !== false }, function (token) {
          if (chrome.runtime.lastError || !token) {
            reject(new Error(
              (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
              'Could not obtain OAuth token'
            ));
            return;
          }
          resolve(token);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Invalidate a previously cached token (e.g. after a 401). The next call
  // to getAuthToken will mint a fresh one.
  function removeCachedAuthToken(token) {
    return new Promise(function (resolve) {
      if (!token) return resolve();
      try {
        chrome.identity.removeCachedAuthToken({ token: token }, function () { resolve(); });
      } catch (e) {
        resolve();
      }
    });
  }

  // ---------- Identity discovery ----------

  /**
   * Resolve the user's email address. If an OAuth token is provided, we fetch
   * from the Google userinfo endpoint (most reliable). Otherwise, we fall back
   * to chrome.identity.getProfileUserInfo (requires Chrome sync).
   */
  async function getUserEmail(token) {
    if (token) {
      try {
        var res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (res.ok) {
          var info = await res.json();
          if (info && info.email) {
            return info.email.toLowerCase();
          }
        }
      } catch (err) {
        // Fall through to getProfileUserInfo
      }
    }

    return new Promise(function (resolve, reject) {
      try {
        chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, function (info) {
          if (!info || !info.email) {
            reject(new Error('No signed-in Google profile found in this Chrome window.'));
            return;
          }
          resolve(info.email.toLowerCase());
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // ---------- Object path ----------

  // Each gem becomes its own immutable object at users/<email>/gems/<id>.json.
  // Writes never overwrite — see saveGem() below — so we don't need any
  // storage.objects.delete permission. The SPA reader enumerates every
  // .json object under users/<email>/gems/ and flattens them into the catalog.
  function gemObjectPath(email, gemId) {
    var normalized = String(email || '').toLowerCase();
    return 'users/' + encodeURIComponent(normalized) +
      '/gems/' + encodeURIComponent(String(gemId)) + '.json';
  }

  // ---------- GCS REST helpers ----------

  /**
   * Upload a single gem at users/<email>/gems/<id>.json with create-only
   * semantics (ifGenerationMatch=0). If the object already exists, GCS
   * returns 412 Precondition Failed without modifying anything — so we
   * never need storage.objects.delete. The caller treats 412 as
   * "already in registry".
   */
  async function saveGem(bucket, email, token, gem) {
    var path = gemObjectPath(email, gem.id);
    var url = 'https://storage.googleapis.com/upload/storage/v1/b/' +
      encodeURIComponent(bucket) +
      '/o?uploadType=media&ifGenerationMatch=0&name=' + encodeURIComponent(path);
    var document = {
      schemaVersion: 1,
      owner: String(email || '').toLowerCase(),
      updatedAt: new Date().toISOString(),
      gems: [gem],
    };
    var res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(document),
    });
    if (!res.ok) {
      var body = await res.text();
      var err = new Error('GCS upload failed: ' + res.status + ' ' + body);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  }

  /**
   * List the gem IDs already saved for `email` at users/<email>/gems/*.json.
   * Used by the popup to mark locally-extracted gems that are already in the
   * registry. Throws on network / auth errors; the caller swallows them.
   */
  async function listUserGemIds(bucket, email, token) {
    var prefix = 'users/' + encodeURIComponent(String(email || '').toLowerCase()) + '/gems/';
    var ids = [];
    var pageToken = null;
    do {
      var url = 'https://storage.googleapis.com/storage/v1/b/' +
        encodeURIComponent(bucket) +
        '/o?prefix=' + encodeURIComponent(prefix) +
        (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
      var res = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + token },
      });
      if (!res.ok) {
        var body = await res.text();
        var err = new Error('GCS list failed: ' + res.status + ' ' + body);
        err.status = res.status;
        throw err;
      }
      var data = await res.json();
      var items = data.items || [];
      for (var i = 0; i < items.length; i++) {
        var match = items[i].name.match(/^users\/[^/]+\/gems\/(.+)\.json$/);
        if (!match) continue;
        try {
          ids.push(decodeURIComponent(match[1]));
        } catch (e) {
          ids.push(match[1]);
        }
      }
      pageToken = data.nextPageToken || null;
    } while (pageToken);
    return ids;
  }

  // ---------- Export ----------

  root.GemFactoryGCS = {
    getAccessToken: getAccessToken,
    removeCachedAuthToken: removeCachedAuthToken,
    getUserEmail: getUserEmail,
    saveGem: saveGem,
    listUserGemIds: listUserGemIds,
  };
})(typeof self !== 'undefined' ? self : this);
