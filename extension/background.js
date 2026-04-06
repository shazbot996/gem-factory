// ==========================================================================
// Gem Factory Extractor — Background Service Worker
// Handles: gem storage, message routing, future SPA communication
// ==========================================================================

// ---------- Message Handlers ----------

// Internal messages (from content script)
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === 'STORE_GEM') {
    // Store the extracted gem, accumulating across edit pages
    chrome.storage.local.get('extractedGems', function (data) {
      var existing = (data.extractedGems && data.extractedGems.gems) || [];

      // Replace if same gem ID already stored, otherwise append
      var found = false;
      for (var i = 0; i < existing.length; i++) {
        if (existing[i].id === message.gem.id) {
          existing[i] = message.gem;
          found = true;
          break;
        }
      }
      if (!found) {
        existing.push(message.gem);
      }

      var result = {
        gems: existing,
        extractedAt: new Date().toISOString(),
        strategy: 'edit_page'
      };

      chrome.storage.local.set({ extractedGems: result });
      sendResponse({ success: true, totalGems: existing.length });
    });
    return true;
  }
});

// Send gem to API server (routed through background to avoid page CSP issues)
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === 'SEND_TO_API') {
    var DEFAULT_API_HOST = 'http://localhost:9090';
    chrome.storage.sync.get('apiHost', function (data) {
      var host = (data.apiHost || DEFAULT_API_HOST).replace(/\/+$/, '');
      var url = host + '/api/gems/import';
      var payload = { gems: [message.gem] };

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          return res.json().then(function (body) {
            return { status: res.status, ok: res.ok, body: body };
          });
        })
        .then(function (result) {
          if (result.ok) {
            sendResponse({ success: true, data: result.body });
          } else {
            sendResponse({ success: false, error: result.body.error || ('HTTP ' + result.status) });
          }
        })
        .catch(function (err) {
          sendResponse({ success: false, error: err.message || 'Network error' });
        });
    });
    return true; // async sendResponse
  }
});

// External messages (future SPA communication — ARCH.md section 7.2)
chrome.runtime.onMessageExternal.addListener(function (message, sender, sendResponse) {
  if (message.type === 'GET_GEMS') {
    chrome.storage.local.get('extractedGems', function (data) {
      sendResponse(data.extractedGems || { gems: [] });
    });
    return true;
  }

  if (message.type === 'CLEAR_GEMS') {
    chrome.storage.local.remove('extractedGems', function () {
      sendResponse({ success: true });
    });
    return true;
  }
});
