// ==========================================================================
// Gem Factory Extractor — Background Service Worker
//
// Maintains the local accumulator of extracted gems in chrome.storage.local.
// Saving to GCS happens directly from popup.js — the background script no
// longer brokers anything with an external SPA.
// ==========================================================================

// Make config available to the service worker if needed by future code paths.
try {
  importScripts('config.js');
} catch (e) {
  // Non-fatal — config.js is optional in the service worker for now.
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === 'STORE_GEM') {
    chrome.storage.local.get('extractedGems', function (data) {
      var existing = (data.extractedGems && data.extractedGems.gems) || [];

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
