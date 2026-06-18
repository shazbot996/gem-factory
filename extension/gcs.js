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
   * Download a single gem document and return the inner gem object.
   * Each per-gem GCS document wraps exactly one gem inside a `gems` array
   * (see saveGem above). Returns null for 404 or malformed payloads.
   */
  async function downloadGemObject(bucket, objectName, token) {
    var url = 'https://storage.googleapis.com/storage/v1/b/' +
      encodeURIComponent(bucket) +
      '/o/' + encodeURIComponent(objectName) + '?alt=media';
    var res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      var body = await res.text();
      var err = new Error('GCS download failed: ' + res.status + ' ' + body);
      err.status = res.status;
      throw err;
    }
    var doc = await res.json();
    if (!doc || !Array.isArray(doc.gems) || doc.gems.length === 0) return null;
    // Tag the gem with the source object so callers can correlate against
    // local pending gems and optionally locate it for delete later.
    var g = doc.gems[0];
    g.objectName = objectName;
    if (!g.extractedAt && doc.updatedAt) g.extractedAt = doc.updatedAt;
    return g;
  }

  /**
   * List + download every per-gem document for `email`. Returns the full
   * gem payloads (id, name, description, instructions, knowledgeFiles,
   * defaultTools, source, extractedAt) so the popup can render the bucket
   * as the canonical list. Throws on network/auth errors; the caller is
   * responsible for soft-failing as needed.
   */
  async function listUserGems(bucket, email, token) {
    var prefix = 'users/' + encodeURIComponent(String(email || '').toLowerCase()) + '/gems/';
    var objectNames = [];
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
        // Only accept the per-gem path; ignore anything else (including any
        // legacy users/<email>/gems.json file still sitting in the bucket).
        if (/^users\/[^/]+\/gems\/[^/]+\.json$/.test(items[i].name)) {
          objectNames.push(items[i].name);
        }
      }
      pageToken = data.nextPageToken || null;
    } while (pageToken);

    var gems = await Promise.all(objectNames.map(function (name) {
      return downloadGemObject(bucket, name, token).catch(function () { return null; });
    }));
    return gems.filter(function (g) { return g != null; });
  }

  // ---------- Export ----------

  root.GemFactoryGCS = {
    getAccessToken: getAccessToken,
    removeCachedAuthToken: removeCachedAuthToken,
    getUserEmail: getUserEmail,
    saveGem: saveGem,
    listUserGems: listUserGems,
  };
})(typeof self !== 'undefined' ? self : this);
