// Gem Factory Extractor — Popup (Gem List Viewer + Save to Server)

var CLOSE_ICON = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" fill="currentColor"/></svg>';

var contentEl = document.getElementById('content');
var countEl = document.getElementById('count');
var statusEl = document.getElementById('status');
var apiUrlInput = document.getElementById('api-url');
var userEmailInput = document.getElementById('user-email');

// ---------- Settings persistence ----------

function loadSettings(callback) {
  chrome.storage.local.get('gfSettings', function (data) {
    var settings = data.gfSettings || {};
    apiUrlInput.value = settings.apiUrl || 'http://localhost:9090';
    userEmailInput.value = settings.userEmail || '';
    if (callback) callback();
  });
}

function saveSettings() {
  chrome.storage.local.set({
    gfSettings: {
      apiUrl: apiUrlInput.value.trim(),
      userEmail: userEmailInput.value.trim(),
    }
  });
}

apiUrlInput.addEventListener('change', saveSettings);
userEmailInput.addEventListener('change', saveSettings);

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

// ---------- Render gem list ----------

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
    return;
  }

  // Sort newest first
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

  // Footer with actions
  var footer = document.createElement('div');
  footer.className = 'footer';

  var saveBtn = document.createElement('button');
  saveBtn.className = 'btn-save';
  saveBtn.textContent = 'Save to Gem Factory';
  saveBtn.addEventListener('click', function () {
    saveToServer(gems, saveBtn);
  });
  footer.appendChild(saveBtn);

  var exportBtn = document.createElement('button');
  exportBtn.className = 'btn-export';
  exportBtn.textContent = 'Copy JSON';
  exportBtn.addEventListener('click', function () {
    var payload = gems.map(function (g) {
      return {
        name: g.name,
        description: g.description || '',
        instructions: g.instructions,
        knowledgeFiles: g.knowledgeFiles || [],
        defaultTools: g.defaultTools || [],
        source: g.source || 'edit_page'
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

// ---------- Save to API server ----------

function saveToServer(gems, btn) {
  var apiUrl = apiUrlInput.value.trim();
  var userEmail = userEmailInput.value.trim();

  if (!apiUrl) {
    showStatus('Please enter the API server URL.', 'error');
    apiUrlInput.focus();
    return;
  }
  if (!userEmail) {
    showStatus('Please enter your email address.', 'error');
    userEmailInput.focus();
    return;
  }

  clearStatus();
  btn.disabled = true;
  btn.textContent = 'Saving\u2026';

  // Map extension gem format to API import format
  var payload = {
    gems: gems.map(function (g) {
      return {
        name: g.name,
        description: g.description || '',
        instructions: g.instructions,
        icon: null,
        source: g.source || 'edit_page',
        geminiId: g.id || null,
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
        extractedAt: g.extractedAt || null,
      };
    })
  };

  var url = apiUrl.replace(/\/+$/, '') + '/api/gems/import';

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dev-User-Email': userEmail,
    },
    body: JSON.stringify(payload),
  })
    .then(function (response) {
      if (!response.ok) {
        return response.json().then(function (data) {
          throw new Error(data.error || 'Server returned ' + response.status);
        });
      }
      return response.json();
    })
    .then(function (result) {
      var parts = [];
      if (result.imported > 0) parts.push(result.imported + ' imported');
      if (result.updated > 0) parts.push(result.updated + ' updated');
      if (result.skipped > 0) parts.push(result.skipped + ' skipped');
      showStatus('Saved: ' + (parts.join(', ') || '0 gems'), 'success');
      btn.disabled = false;
      btn.textContent = 'Save to Gem Factory';
      saveSettings();
    })
    .catch(function (err) {
      showStatus('Error: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Save to Gem Factory';
    });
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

loadSettings(function () {
  loadGems();
});
