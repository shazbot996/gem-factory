// ==========================================================================
// Gem Factory Extractor — Public Gemini Banner Configuration
//
// Administrator-editable settings for the alert banner that displays at the
// top of every page on the public https://gemini.google.com/ application,
// reminding corporate users to switch to the private Gemini Enterprise
// instance.
//
// Loaded as a content script before content-script.js (see manifest.json).
// All values are read from `self.GEM_FACTORY_BANNER_CONFIG`.
//
// Fields:
//   enabled            — master on/off toggle. Set to false to hide the
//                        banner entirely without removing this file.
//   backgroundColor    — CSS color used as the banner background.
//   textColor          — CSS color used for the banner message + link.
//   message            — short alert text shown to the user.
//   linkLabel          — text rendered as the clickable link.
//   enterpriseUrl      — URL the link points to (the private Gemini
//                        Enterprise instance for this organization).
// ==========================================================================

(function (root) {
  root.GEM_FACTORY_BANNER_CONFIG = {
    enabled: true,
    backgroundColor: '#b30000',
    textColor: '#ffffff',
    message: 'You are using the public Gemini application. For company data, please use the private Schnucks Gemini Enterprise instance.',
    linkLabel: 'Open Gemini Enterprise →',
    enterpriseUrl: 'https://geminienterprise.google.com/',
  };
})(typeof self !== 'undefined' ? self : this);
