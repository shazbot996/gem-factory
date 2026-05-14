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
  // Save is always allowed — first click triggers the interactive OAuth flow.
  saveBtnRef.disabled = false;
  saveBtnRef.title = 'Save these gems to ' +
    ((window.GEM_FACTORY_CONFIG && window.GEM_FACTORY_CONFIG.bucketName) || 'the registry');
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
    var li = document.createElement('li');
    li.className = 'gem-item';

    var info = document.createElement('div');
    info.className = 'gem-info';

    var name = document.createElement('div');
    name.className = 'gem-name';
    name.textContent = gem.name || '(unnamed)';
    info.appendChild(name);

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

function mergeGems(existing, incoming) {
  var byId = {};
  for (var i = 0; i < existing.length; i++) {
    var g = existing[i];
    if (g && g.id) byId[g.id] = g;
  }
  for (var j = 0; j < incoming.length; j++) {
    var n = incoming[j];
    if (n && n.id) byId[n.id] = serializeGem(n);
  }
  var out = [];
  for (var k in byId) {
    if (Object.prototype.hasOwnProperty.call(byId, k)) out.push(byId[k]);
  }
  return out;
}

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
        // Fall through with no email — we have a token but couldn't discover
        // the profile email. This is fatal — the object path requires email.
        throw new Error('Could not determine your Google account email. ' + e.message);
      }
    }

    // Optimistic concurrency: read, merge, write with If-Match.
    var loaded = await window.GemFactoryGCS.loadUserGems(bucket, currentEmail, token);
    var nextDocument = {
      schemaVersion: 1,
      owner: currentEmail,
      updatedAt: new Date().toISOString(),
      gems: mergeGems(loaded.document.gems || [], gems),
    };

    try {
      await window.GemFactoryGCS.saveUserGems(bucket, currentEmail, token, nextDocument, loaded.etag);
    } catch (err) {
      // 412 = etag mismatch (someone else wrote in the gap). Refetch, remerge, retry once.
      if (err && err.status === 412) {
        var second = await window.GemFactoryGCS.loadUserGems(bucket, currentEmail, token);
        var retryDocument = {
          schemaVersion: 1,
          owner: currentEmail,
          updatedAt: new Date().toISOString(),
          gems: mergeGems(second.document.gems || [], gems),
        };
        await window.GemFactoryGCS.saveUserGems(bucket, currentEmail, token, retryDocument, second.etag);
      } else if (err && err.status === 401) {
        // Token rejected — drop the cached token so the next attempt re-prompts.
        await window.GemFactoryGCS.removeCachedAuthToken(token);
        throw new Error('Authorization expired. Click Save again to re-authorize.');
      } else {
        throw err;
      }
    }

    showStatus('Saved ' + gems.length + (gems.length === 1 ? ' gem to ' : ' gems to ') + bucket, 'success');
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
