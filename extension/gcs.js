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

  function objectPath(email) {
    var normalized = String(email || '').toLowerCase();
    return 'users/' + encodeURIComponent(normalized) + '/gems.json';
  }

  // ---------- GCS REST helpers ----------

  function downloadUrl(bucket, name) {
    return 'https://storage.googleapis.com/storage/v1/b/' +
      encodeURIComponent(bucket) +
      '/o/' + encodeURIComponent(name) +
      '?alt=media';
  }

  function uploadUrl(bucket, name) {
    return 'https://storage.googleapis.com/upload/storage/v1/b/' +
      encodeURIComponent(bucket) +
      '/o?uploadType=media&name=' + encodeURIComponent(name);
  }

  function emptyDocument(email) {
    return {
      schemaVersion: 1,
      owner: String(email || '').toLowerCase(),
      updatedAt: null,
      gems: [],
    };
  }

  /**
   * Fetch users/<email>/gems.json. Returns { document, etag } where etag may
   * be null (e.g. on a fresh 404 — we synthesize an empty document).
   */
  async function loadUserGems(bucket, email, token) {
    var url = downloadUrl(bucket, objectPath(email));
    var res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (res.status === 404) {
      return { document: emptyDocument(email), etag: null };
    }
    if (!res.ok) {
      var body = await res.text();
      throw new Error('GCS download failed: ' + res.status + ' ' + body);
    }
    var etag = res.headers.get('ETag');
    var document = await res.json();
    if (!document || typeof document !== 'object') {
      document = emptyDocument(email);
    }
    return { document: document, etag: etag };
  }

  /**
   * Upload users/<email>/gems.json. If `etag` is supplied, we send
   * If-Match for optimistic concurrency; on 412 the caller can retry.
   */
  async function saveUserGems(bucket, email, token, document, etag) {
    var url = uploadUrl(bucket, objectPath(email));
    var headers = {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
    };
    if (etag) {
      headers['If-Match'] = etag;
    }
    var res = await fetch(url, {
      method: 'POST',
      headers: headers,
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

  // ---------- Export ----------

  root.GemFactoryGCS = {
    getAccessToken: getAccessToken,
    removeCachedAuthToken: removeCachedAuthToken,
    getUserEmail: getUserEmail,
    objectPath: objectPath,
    loadUserGems: loadUserGems,
    saveUserGems: saveUserGems,
  };
})(typeof self !== 'undefined' ? self : this);
