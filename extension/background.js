// ==========================================================================
// Gem Factory Extractor — Background Service Worker
// Handles: local gem storage, message routing, future SPA communication
// ==========================================================================

// ---------- Internal Messages (from content script and popup) ----------

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

      chrome.storage.local.set({ extractedGems: result }, function () {
        sendResponse({ success: true, totalGems: existing.length, wasUpdate: found, allGems: existing });
      });
    });
    return true;
  }

  if (message.type === 'GET_ALL_GEMS') {
    chrome.storage.local.get('extractedGems', function (data) {
      sendResponse(data.extractedGems || { gems: [] });
    });
    return true;
  }

  if (message.type === 'DELETE_GEM') {
    chrome.storage.local.get('extractedGems', function (data) {
      var existing = (data.extractedGems && data.extractedGems.gems) || [];
      var filtered = existing.filter(function (g) { return g.id !== message.gemId; });

      var result = {
        gems: filtered,
        extractedAt: new Date().toISOString(),
        strategy: 'edit_page'
      };

      chrome.storage.local.set({ extractedGems: result }, function () {
        sendResponse({ success: true, totalGems: filtered.length });
      });
    });
    return true;
  }
});

// ---------- External Messages (future SPA communication — ARCH.md section 7.2) ----------

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
