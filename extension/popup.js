// Gem Factory Extractor — Popup
//
// Lists extracted gems held in chrome.storage.local, then saves them directly
// to a Google Cloud Storage bucket via the user's OAuth credentials. The bucket
// and OAuth client ID come from config.js (and must match manifest.json's
// oauth2 block). See docs/decisions/0001-replace-sql-and-api-server-with-direct-gcs-writes.md.

var CLOSE_ICON = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" fill="currentColor"/></svg>';

var contentEl = document.getElementById('content');
var countEl = document.getElementById('count');
var statusEl = document.getElementById('status');
var authStatusEl = document.getElementById('auth-status');
var bucketDisplayEl = document.getElementById('bucket-display');

var currentEmail = null;
var saveBtnRef = null;
// Set of gem ids already saved to GCS for currentEmail. Populated by a
// silent (non-interactive) listing on popup open, refreshed after save.
// null means "not loaded yet"; an empty Set means "loaded, none saved".
var registeredIds = null;
var lastRenderedGems = [];

// ---------- Bucket info ----------

function renderBucketInfo() {
  if (!bucketDisplayEl) return;
  var bucket = (window.GEM_FACTORY_CONFIG && window.GEM_FACTORY_CONFIG.bucketName) || '(not configured)';
  bucketDisplayEl.textContent = bucket;
}

// ---------- Auth display ----------

function renderAuthStatus(email) {
  while (authStatusEl.firstChild) authStatusEl.removeChild(authStatusEl.firstChild);

  if (email) {
    authStatusEl.className = 'auth-status signed-in';
    var left = document.createElement('div');
    var label = document.createElement('div');
    label.className = 'auth-label';
    label.textContent = 'Signed in as';
    var emailEl = document.createElement('div');
    emailEl.className = 'auth-email';
    emailEl.textContent = email;
    left.appendChild(label);
    left.appendChild(emailEl);
    authStatusEl.appendChild(left);
  } else {
    authStatusEl.className = 'auth-status signed-out';
    var msg = document.createElement('div');
    msg.className = 'auth-message';
    msg.textContent = 'Click Save to authorize your Google account.';
    authStatusEl.appendChild(msg);
  }
  updateSaveButtonState();
}

function updateSaveButtonState() {
  if (!saveBtnRef) return;
  var bucket = (window.GEM_FACTORY_CONFIG && window.GEM_FACTORY_CONFIG.bucketName) || 'the registry';
  // If we've loaded registry state and every local gem is already saved,
  // disable Save and relabel — there's nothing new to push.
  if (registeredIds && lastRenderedGems.length > 0 &&
      lastRenderedGems.every(function (g) { return registeredIds.has(g.id); })) {
    saveBtnRef.disabled = true;
    saveBtnRef.textContent = 'All in registry';
    saveBtnRef.title = 'Every gem in this list is already saved to ' + bucket;
  } else {
    saveBtnRef.disabled = false;
    saveBtnRef.textContent = 'Save to Registry';
    saveBtnRef.title = 'Save these gems to ' + bucket;
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

function render(data) {
  var gems = (data && data.gems) || [];
  lastRenderedGems = gems;
  countEl.textContent = gems.length + (gems.length === 1 ? ' gem' : ' gems');

  if (gems.length === 0) {
    contentEl.innerHTML = '';
    var empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No gems extracted yet.';
    var hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Visit a gem edit page on gemini.google.com and click the blue diamond button to extract.';
    empty.appendChild(hint);
    contentEl.appendChild(empty);
    saveBtnRef = null;
    return;
  }

  var sorted = gems.slice().sort(function (a, b) {
    return (b.extractedAt || '').localeCompare(a.extractedAt || '');
  });

  var list = document.createElement('ul');
  list.className = 'gem-list';

  sorted.forEach(function (gem) {
    var isRegistered = registeredIds && registeredIds.has(gem.id);

    var li = document.createElement('li');
    li.className = 'gem-item' + (isRegistered ? ' registered' : '');

    var info = document.createElement('div');
    info.className = 'gem-info';

    var name = document.createElement('div');
    name.className = 'gem-name';
    name.textContent = gem.name || '(unnamed)';
    info.appendChild(name);

    if (isRegistered) {
      var badgeRow = document.createElement('div');
      badgeRow.className = 'gem-badge-row';
      var badge = document.createElement('span');
      badge.className = 'badge-registered';
      badge.textContent = 'In registry';
      badgeRow.appendChild(badge);
      info.appendChild(badgeRow);
    }

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

    var del = document.createElement('button');
    del.className = 'gem-delete';
    del.title = 'Remove gem';
    del.innerHTML = CLOSE_ICON;
    del.addEventListener('click', function () {
      chrome.runtime.sendMessage({ type: 'DELETE_GEM', gemId: gem.id }, function () {
        loadGems();
      });
    });

    li.appendChild(info);
    li.appendChild(del);
    list.appendChild(li);
  });

  contentEl.innerHTML = '';
  contentEl.appendChild(list);

  // ---------- Footer ----------
  var footer = document.createElement('div');
  footer.className = 'footer';

  var saveBtn = document.createElement('button');
  saveBtn.className = 'btn-save';
  saveBtn.textContent = 'Save to Registry';
  saveBtn.addEventListener('click', function () {
    saveToGCS(gems, saveBtn);
  });
  footer.appendChild(saveBtn);
  saveBtnRef = saveBtn;
  updateSaveButtonState();

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
      };
    });
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(function () {
      exportBtn.textContent = 'Copied!';
      setTimeout(function () { exportBtn.textContent = 'Copy JSON'; }, 1500);
    });
  });
  footer.appendChild(exportBtn);

  var clearBtn = document.createElement('button');
  clearBtn.className = 'btn-clear';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', function () {
    chrome.storage.local.remove('extractedGems', function () {
      clearStatus();
      loadGems();
    });
  });
  footer.appendChild(clearBtn);

  contentEl.appendChild(footer);
}

// ---------- Save to GCS ----------

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

async function saveToGCS(gems, btn) {
  var bucket = window.GEM_FACTORY_CONFIG && window.GEM_FACTORY_CONFIG.bucketName;
  if (!bucket) {
    showStatus('Bucket name not configured (check config.js).', 'error');
    return;
  }
  if (!gems || gems.length === 0) {
    showStatus('No gems to save.', 'error');
    return;
  }

  clearStatus();
  btn.disabled = true;
  btn.textContent = 'Saving…';

  var token = null;

  try {
    token = await window.GemFactoryGCS.getAccessToken(true);

    if (!currentEmail) {
      try {
        currentEmail = await window.GemFactoryGCS.getUserEmail(token);
        renderAuthStatus(currentEmail);
      } catch (e) {
        throw new Error('Could not determine your Google account email. ' + e.message);
      }
    }

    // Each gem is its own immutable object. Upload uses ifGenerationMatch=0
    // (create-only), so re-saving a previously-saved gem returns 412 — we
    // count it as "already in registry" rather than failing.
    if (!registeredIds) registeredIds = new Set();
    var savedCount = 0;
    var duplicateCount = 0;
    var firstDuplicateName = null;
    var firstSavedName = null;
    var failures = [];

    for (var i = 0; i < gems.length; i++) {
      var gem = serializeGem(gems[i]);
      try {
        await window.GemFactoryGCS.saveGem(bucket, currentEmail, token, gem);
        savedCount++;
        if (!firstSavedName) firstSavedName = gem.name || gem.id;
        registeredIds.add(gem.id);
      } catch (err) {
        if (err && err.status === 412) {
          duplicateCount++;
          if (!firstDuplicateName) firstDuplicateName = gem.name || gem.id;
          registeredIds.add(gem.id);
        } else if (err && err.status === 401) {
          // Token rejected — drop cached token and ask the user to retry.
          await window.GemFactoryGCS.removeCachedAuthToken(token);
          throw new Error('Authorization expired. Click Save again to re-authorize.');
        } else {
          failures.push({ name: gem.name || gem.id, message: (err && err.message) || String(err) });
        }
      }
    }

    // Compose a status message that distinguishes "saved", "already in
    // registry", and "failed". The all-duplicates case uses the `info`
    // style so it looks distinct from a successful save.
    var msgType;
    var summary;

    if (failures.length > 0) {
      msgType = 'error';
      var parts = [];
      if (savedCount > 0) parts.push(pluralize(savedCount, 'gem saved', 'gems saved'));
      if (duplicateCount > 0) parts.push(pluralize(duplicateCount, 'already in registry', 'already in registry'));
      parts.push(pluralize(failures.length, 'failed', 'failed'));
      summary = parts.join(' • ') + ': ' + failures[0].message;
    } else if (savedCount === 0 && duplicateCount > 0) {
      msgType = 'info';
      summary = (duplicateCount === 1 && firstDuplicateName)
        ? '"' + firstDuplicateName + '" is already in the registry — nothing to save.'
        : 'All ' + duplicateCount + ' gems are already in the registry — nothing to save.';
    } else if (savedCount > 0 && duplicateCount === 0) {
      msgType = 'success';
      summary = (savedCount === 1 && firstSavedName)
        ? 'Saved "' + firstSavedName + '" to ' + bucket
        : 'Saved ' + pluralize(savedCount, 'gem', 'gems') + ' to ' + bucket;
    } else if (savedCount > 0 && duplicateCount > 0) {
      msgType = 'success';
      summary = pluralize(savedCount, 'new gem saved', 'new gems saved') +
        ' • ' + pluralize(duplicateCount, 'already in registry', 'already in registry');
    } else {
      msgType = 'info';
      summary = 'Nothing to save.';
    }

    showStatus(summary, msgType);
    // Re-render so badges + button state reflect the post-save registry.
    loadGems();
  } catch (err) {
    showStatus('Error: ' + (err.message || String(err)), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save to Registry';
    updateSaveButtonState();
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

function loadGems() {
  chrome.runtime.sendMessage({ type: 'GET_ALL_GEMS' }, function (data) {
    render(data);
  });
}

/**
 * Try to populate `registeredIds` by querying GCS for the current user's
 * gem objects. Uses a non-interactive OAuth flow so opening the popup
 * never surprises the user with a consent dialog — if no token is cached
 * we simply skip and the popup falls back to showing local-only state.
 */
async function refreshRegistry(opts) {
  opts = opts || {};
  var bucket = window.GEM_FACTORY_CONFIG && window.GEM_FACTORY_CONFIG.bucketName;
  if (!bucket) return;

  var token;
  try {
    token = await window.GemFactoryGCS.getAccessToken(opts.interactive === true);
  } catch (e) {
    // No cached consent yet (or user dismissed it). Stay silent — Save
    // will trigger the interactive prompt later.
    return;
  }
  if (!currentEmail) {
    try {
      currentEmail = await window.GemFactoryGCS.getUserEmail(token);
      renderAuthStatus(currentEmail);
    } catch (e) {
      return;
    }
  }
  try {
    var ids = await window.GemFactoryGCS.listUserGemIds(bucket, currentEmail, token);
    registeredIds = new Set(ids);
    // Re-render so each gem reflects its registry state.
    loadGems();
  } catch (err) {
    if (err && err.status === 401) {
      // Cached token is no longer valid — drop it; next Save will reprompt.
      await window.GemFactoryGCS.removeCachedAuthToken(token);
    }
    // Soft-fail: keep showing local-only state.
  }
}

// ---------- Init ----------

renderBucketInfo();
renderAuthStatus(null);

// Best-effort: try to discover the signed-in profile email without
// triggering an interactive prompt. Falls back gracefully if no Google
// profile is signed in.
if (window.GemFactoryGCS && window.GemFactoryGCS.getUserEmail) {
  window.GemFactoryGCS.getUserEmail()
    .then(function (email) {
      currentEmail = email;
      renderAuthStatus(email);
    })
    .catch(function () { /* No profile signed in — leave as anonymous. */ });
}

loadGems();
// Silently query GCS so each gem can be tagged "In registry" as soon as the
// popup paints. No-op if the user hasn't granted OAuth consent yet — the
// first Save click will still trigger the interactive prompt.
refreshRegistry();
