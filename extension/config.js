// ==========================================================================
// Gem Factory Extractor — Environment configuration
//
// Single source of truth for environment-specific values. Swap these when
// promoting from the test bucket to a production bucket. The OAuth client ID
// MUST also match the "client_id" field in manifest.json — Chrome reads the
// manifest, not this file, when running chrome.identity.getAuthToken.
//
// This file is loaded as the first script in popup.html, imported by
// background.js via importScripts(), and injected into the content script
// world via manifest content_scripts. All three contexts read
// `GEM_FACTORY_CONFIG` from their global scope.
// ==========================================================================

(function (root) {
  root.GEM_FACTORY_CONFIG = {
    bucketName: 'gcs-gem-registry',
    oauthClientId: '424099097598-6nid5rcbprkurdiivu76dhl7m8o82cue.apps.googleusercontent.com',
  };
})(typeof self !== 'undefined' ? self : this);
