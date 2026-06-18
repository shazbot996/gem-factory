// Gem Factory Extractor — Popup
//
// The GCS bucket is the canonical list of saved gems. The popup fetches
// the user's per-gem objects from the bucket and renders them as the
// authoritative registry; chrome.storage.local is used only as a holding
// area for newly extracted gems that haven't been uploaded yet ("pending").
//
// Workflow:
//   1. Extract a gem on a Gemini edit page → STORE_GEM writes it locally.
//   2. Open the popup → fetch cloud gems + local pending gems, render both.
//      Any pending gem whose id already appears in the cloud is silently
//      cleaned up (it was previously uploaded; the local copy is stale).
//   3. Click "Upload pending" → upload every pending gem to GCS; on success,
//      remove the local copy.
//
// There is no Clear button and no GCS delete from the extension — the SPA
// owns deletes.

var contentEl = document.getElementById('content');
var countEl = document.getElementById('count');
var statusEl = document.getElementById('status');
var authStatusEl = document.getElementById('auth-status');
var bucketDisplayEl = document.getElementById('bucket-display');

var currentEmail = null;
// null = not yet attempted; [] = loaded, empty; [gems...] = loaded with content.
var cloudGems = null;
var pendingGems = [];
// True once we've successfully made a non-interactive OAuth attempt that
// returned a token. False if the cached token is missing/expired and we're
// waiting for the user to click "Sign in to load cloud gems".
var cloudAuthorized = false;

// ---------- Bucket info ----------

function renderBucketInfo() {
  if (!bucketDisplayEl) return;
  var bucket = (self.GEM_FACTORY_CONFIG && self.GEM_FACTORY_CONFIG.bucketName) || '(not configured)';
  bucketDisplayEl.textContent = bucket;
}

// ---------- Auth display ----------

function renderAuthStatus(email) {
  while (authStatusEl.firstChild) authStatusEl.removeChild(authStatusEl.firstChild);

  if (email) {
    authStatusEl.className = 'auth-status signed-in';
    var label = document.createElement('div');
    label.className = 'auth-label';
    label.textContent = 'Signed in as';
    var emailEl = document.createElement('div');
    emailEl.className = 'auth-email';
    emailEl.textContent = email;
    var box = document.createElement('div');
    box.appendChild(label);
    box.appendChild(emailEl);
    authStatusEl.appendChild(box);
  } else {
    authStatusEl.className = 'auth-status signed-out';
    var msg = document.createElement('div');
    msg.className = 'auth-message';
    msg.textContent = 'Sign in to view your registry.';
    authStatusEl.appendChild(msg);
  }
}

// ---------- Status messages ----------

function showStatus(message, type) {
  statusEl.className = 'status-msg ' + type;
  statusEl.textContent = message;
  if (type === 'success') {
    setTimeout(function () { statusEl.textContent = ''; statusEl.className = ''; }, 4000);
  }
}

function clearStatus() {
  statusEl.textContent = '';
  statusEl.className = '';
}

// ---------- Gem list rendering ----------

/**
 * Combine cloud + pending into a single render list, tagged with _state.
 * Local entries whose id appears in the cloud are skipped (they get
 * auto-cleaned out of local storage separately).
 */
function buildRenderList() {
  var byId = new Map();
  var cloud = cloudGems || [];
  for (var i = 0; i < cloud.length; i++) {
    var g = cloud[i];
    byId.set(g.id, Object.assign({}, g, { _state: 'synced' }));
  }
  for (var j = 0; j < pendingGems.length; j++) {
    var p = pendingGems[j];
    if (byId.has(p.id)) continue; // already synced; local copy is stale
    byId.set(p.id, Object.assign({}, p, { _state: 'pending' }));
  }
  return Array.from(byId.values()).sort(function (a, b) {
    // Pending first so user sees what needs action; newest within each group.
    if (a._state !== b._state) return a._state === 'pending' ? -1 : 1;
    return (b.extractedAt || '').localeCompare(a.extractedAt || '');
  });
}

function countPending() {
  if (!cloudGems) return pendingGems.length;
  var cloudIds = new Set(cloudGems.map(function (g) { return g.id; }));
  return pendingGems.filter(function (p) { return !cloudIds.has(p.id); }).length;
}

function render() {
  var gems = buildRenderList();
  var pendingCount = countPending();
  var totalCount = gems.length;

  countEl.textContent = totalCount + (totalCount === 1 ? ' gem' : ' gems');

  contentEl.innerHTML = '';

  if (cloudGems === null && !cloudAuthorized) {
    // Cloud not loaded and we don't have a silent token — offer a manual
    // sign-in button. Pending gems still render below.
    var signin = document.createElement('div');
    signin.className = 'empty';
    var signinMsg = document.createElement('div');
    signinMsg.textContent = 'Sign in to load your cloud registry.';
    signin.appendChild(signinMsg);
    var signinBtn = document.createElement('button');
    signinBtn.className = 'btn-export';
    signinBtn.style.marginTop = '10px';
    signinBtn.textContent = 'Sign in';
    signinBtn.addEventListener('click', function () {
      signinBtn.disabled = true;
      signinBtn.textContent = 'Signing in…';
      refreshCloud({ interactive: true }).finally(function () {
        render();
      });
    });
    signin.appendChild(signinBtn);
    contentEl.appendChild(signin);
  }

  if (totalCount === 0 && cloudGems !== null) {
    var empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No gems extracted yet.';
    var hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Visit a gem edit page on gemini.google.com and click the diamond button to extract.';
    empty.appendChild(hint);
    contentEl.appendChild(empty);
    return;
  }

  if (totalCount > 0) {
    var list = document.createElement('ul');
    list.className = 'gem-list';
    gems.forEach(function (gem) {
      list.appendChild(renderRow(gem));
    });
    contentEl.appendChild(list);
  }

  // ---------- Footer ----------
  var footer = document.createElement('div');
  footer.className = 'footer';

  var uploadBtn = document.createElement('button');
  uploadBtn.className = 'btn-save';
  if (pendingCount === 0) {
    uploadBtn.textContent = cloudGems === null ? 'Upload pending' : 'Nothing to upload';
    uploadBtn.disabled = true;
    uploadBtn.title = 'No local gems waiting to be uploaded.';
  } else {
    uploadBtn.textContent = 'Upload ' + pendingCount + ' pending';
    uploadBtn.disabled = false;
    uploadBtn.title = 'Upload all pending gems to the bucket.';
  }
  uploadBtn.addEventListener('click', function () {
    uploadPending(uploadBtn);
  });
  footer.appendChild(uploadBtn);

  var exportBtn = document.createElement('button');
  exportBtn.className = 'btn-export';
  exportBtn.textContent = 'Copy JSON';
  exportBtn.addEventListener('click', function () {
    var payload = gems.map(function (g) {
      return {
        id: g.id,
        name: g.name,
        description: g.description || '',
        instructions: g.instructions,
        knowledgeFiles: g.knowledgeFiles || [],
        defaultTools: g.defaultTools || [],
        source: g.source || 'edit_page',
        extractedAt: g.extractedAt || null,
        state: g._state,
      };
    });
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(function () {
      exportBtn.textContent = 'Copied!';
      setTimeout(function () { exportBtn.textContent = 'Copy JSON'; }, 1500);
    });
  });
  footer.appendChild(exportBtn);

  contentEl.appendChild(footer);
}

function renderRow(gem) {
  var li = document.createElement('li');
  li.className = 'gem-item ' + (gem._state === 'synced' ? 'synced' : 'pending');

  var info = document.createElement('div');
  info.className = 'gem-info';

  var name = document.createElement('div');
  name.className = 'gem-name';
  name.textContent = gem.name || '(unnamed)';
  info.appendChild(name);

  var badgeRow = document.createElement('div');
  badgeRow.className = 'gem-badge-row';
  var badge = document.createElement('span');
  if (gem._state === 'synced') {
    badge.className = 'badge-cloud';
    badge.textContent = 'In cloud';
  } else {
    badge.className = 'badge-pending';
    badge.textContent = 'Pending upload';
  }
  badgeRow.appendChild(badge);
  info.appendChild(badgeRow);

  if (gem.extractedAt) {
    var meta = document.createElement('div');
    meta.className = 'gem-meta';
    meta.textContent = formatDate(gem.extractedAt);
    info.appendChild(meta);
  }

  if (gem.instructions) {
    var preview = document.createElement('div');
    preview.className = 'gem-preview';
    preview.textContent = gem.instructions;
    info.appendChild(preview);
  }

  if (gem.knowledgeFiles && gem.knowledgeFiles.length > 0) {
    var kfNames = gem.knowledgeFiles.map(function (f) {
      return typeof f === 'string' ? f : f.name;
    });
    var kf = document.createElement('div');
    kf.className = 'gem-meta';
    kf.style.marginTop = '4px';
    kf.textContent = 'Knowledge: ' + kfNames.join(', ');
    info.appendChild(kf);
  }

  if (gem.defaultTools && gem.defaultTools.length > 0) {
    var dt = document.createElement('div');
    dt.className = 'gem-meta';
    dt.style.marginTop = '2px';
    dt.textContent = 'Tools: ' + gem.defaultTools.join(', ');
    info.appendChild(dt);
  }

  li.appendChild(info);
  return li;
}

// ---------- Local pending storage ----------

function loadPending() {
  return new Promise(function (resolve) {
    chrome.runtime.sendMessage({ type: 'GET_ALL_GEMS' }, function (data) {
      pendingGems = (data && data.gems) || [];
      resolve();
    });
  });
}

function deleteLocal(gemId) {
  return new Promise(function (resolve) {
    chrome.runtime.sendMessage({ type: 'DELETE_GEM', gemId: gemId }, function () {
      pendingGems = pendingGems.filter(function (g) { return g.id !== gemId; });
      resolve();
    });
  });
}

/**
 * Any pending gem whose id is already in the cloud is, by definition,
 * stale — it was uploaded by a previous popup session that didn't clean
 * up. Remove those local copies so the user sees a consistent state.
 */
async function reconcilePendingWithCloud() {
  if (!cloudGems) return;
  var cloudIds = new Set(cloudGems.map(function (g) { return g.id; }));
  var stale = pendingGems.filter(function (p) { return cloudIds.has(p.id); });
  for (var i = 0; i < stale.length; i++) {
    await deleteLocal(stale[i].id);
  }
}

// ---------- Cloud refresh ----------

async function refreshCloud(opts) {
  opts = opts || {};
  var bucket = self.GEM_FACTORY_CONFIG && self.GEM_FACTORY_CONFIG.bucketName;
  if (!bucket) return;

  var token;
  try {
    token = await self.GemFactoryGCS.getAccessToken(opts.interactive === true);
  } catch (e) {
    if (opts.interactive) {
      showStatus('Sign-in failed: ' + (e.message || e), 'error');
    }
    cloudAuthorized = false;
    return;
  }
  if (!token) {
    cloudAuthorized = false;
    return;
  }

  if (!currentEmail) {
    try {
      currentEmail = await self.GemFactoryGCS.getUserEmail(token);
      renderAuthStatus(currentEmail);
    } catch (e) {
      if (opts.interactive) {
        showStatus('Could not read your Google profile: ' + (e.message || e), 'error');
      }
      return;
    }
  }

  try {
    var gems = await self.GemFactoryGCS.listUserGems(bucket, currentEmail, token);
    cloudGems = gems;
    cloudAuthorized = true;
    await reconcilePendingWithCloud();
  } catch (err) {
    if (err && err.status === 401) {
      await self.GemFactoryGCS.removeCachedAuthToken(token);
      cloudAuthorized = false;
      if (opts.interactive) {
        showStatus('Authorization expired. Sign in again.', 'error');
      }
      return;
    }
    if (opts.interactive) {
      showStatus('Could not load cloud registry: ' + ((err && err.message) || err), 'error');
    }
  }
}

// ---------- Upload pending ----------

function serializeGem(g) {
  return {
    id: g.id,
    name: g.name,
    description: g.description || '',
    instructions: g.instructions,
    knowledgeFiles: (g.knowledgeFiles || []).map(function (f) {
      if (typeof f === 'string') return { name: f };
      return {
        name: f.name,
        type: f.type || '',
        mimeType: f.mimeType || '',
        driveId: f.driveId || null,
        driveUrl: f.driveUrl || null,
      };
    }),
    defaultTools: g.defaultTools || [],
    source: g.source || 'edit_page',
    extractedAt: g.extractedAt || null,
  };
}

function pluralize(n, singular, plural) {
  return n + ' ' + (n === 1 ? singular : plural);
}

async function uploadPending(btn) {
  var bucket = self.GEM_FACTORY_CONFIG && self.GEM_FACTORY_CONFIG.bucketName;
  if (!bucket) {
    showStatus('Bucket name not configured (check config.js).', 'error');
    return;
  }

  var cloudIds = new Set((cloudGems || []).map(function (g) { return g.id; }));
  var toUpload = pendingGems.filter(function (p) { return !cloudIds.has(p.id); });
  if (toUpload.length === 0) {
    showStatus('Nothing pending to upload.', 'info');
    return;
  }

  clearStatus();
  btn.disabled = true;
  btn.textContent = 'Uploading…';

  var token = null;
  try {
    token = await self.GemFactoryGCS.getAccessToken(true);

    if (!currentEmail) {
      currentEmail = await self.GemFactoryGCS.getUserEmail(token);
      renderAuthStatus(currentEmail);
    }

    var savedCount = 0;
    var duplicateCount = 0;
    var firstSavedName = null;
    var firstDuplicateName = null;
    var failures = [];

    for (var i = 0; i < toUpload.length; i++) {
      var gem = serializeGem(toUpload[i]);
      try {
        await self.GemFactoryGCS.saveGem(bucket, currentEmail, token, gem);
        savedCount++;
        if (!firstSavedName) firstSavedName = gem.name || gem.id;
        await deleteLocal(gem.id);
      } catch (err) {
        if (err && err.status === 412) {
          // Already in registry — clean up the stale local copy.
          duplicateCount++;
          if (!firstDuplicateName) firstDuplicateName = gem.name || gem.id;
          await deleteLocal(gem.id);
        } else if (err && err.status === 401) {
          await self.GemFactoryGCS.removeCachedAuthToken(token);
          throw new Error('Authorization expired. Click upload again to re-authorize.');
        } else {
          failures.push({ name: gem.name || gem.id, message: (err && err.message) || String(err) });
        }
      }
    }

    var msgType;
    var summary;
    if (failures.length > 0) {
      msgType = 'error';
      var parts = [];
      if (savedCount > 0) parts.push(pluralize(savedCount, 'gem uploaded', 'gems uploaded'));
      if (duplicateCount > 0) parts.push(pluralize(duplicateCount, 'already in cloud', 'already in cloud'));
      parts.push(pluralize(failures.length, 'failed', 'failed'));
      summary = parts.join(' • ') + ': ' + failures[0].message;
    } else if (savedCount === 0 && duplicateCount > 0) {
      msgType = 'info';
      summary = (duplicateCount === 1 && firstDuplicateName)
        ? '"' + firstDuplicateName + '" was already in the cloud — local copy removed.'
        : 'All ' + duplicateCount + ' pending gems were already in the cloud — local copies removed.';
    } else if (savedCount > 0 && duplicateCount === 0) {
      msgType = 'success';
      summary = (savedCount === 1 && firstSavedName)
        ? 'Uploaded "' + firstSavedName + '" to ' + bucket
        : 'Uploaded ' + pluralize(savedCount, 'gem', 'gems') + ' to ' + bucket;
    } else if (savedCount > 0 && duplicateCount > 0) {
      msgType = 'success';
      summary = pluralize(savedCount, 'new gem uploaded', 'new gems uploaded') +
        ' • ' + pluralize(duplicateCount, 'already in cloud', 'already in cloud');
    } else {
      msgType = 'info';
      summary = 'Nothing to upload.';
    }
    showStatus(summary, msgType);

    // Refresh the cloud list so newly-uploaded gems appear with their badge.
    await refreshCloud();
  } catch (err) {
    showStatus('Error: ' + (err.message || String(err)), 'error');
  } finally {
    render();
  }
}

// ---------- Helpers ----------

function formatDate(iso) {
  try {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' at ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

// ---------- Init ----------

renderBucketInfo();
renderAuthStatus(null);

(async function init() {
  // Best-effort: discover the signed-in profile email without prompting.
  try {
    currentEmail = await self.GemFactoryGCS.getUserEmail();
    renderAuthStatus(currentEmail);
  } catch (e) {
    // No profile signed in; renderAuthStatus stays in signed-out mode.
  }

  await loadPending();
  render(); // paint pending immediately so the popup never feels empty.

  await refreshCloud(); // silent — if no cached token, render() will offer Sign-in.
  render();
})();
