// Gem Factory Extractor — Options Page

var DEFAULT_API_HOST = 'http://localhost:9090';

var input = document.getElementById('apiHost');
var status = document.getElementById('status');

// Load saved value
chrome.storage.sync.get('apiHost', function (data) {
  input.value = data.apiHost || DEFAULT_API_HOST;
});

// Save on change (debounced)
var saveTimeout = null;
input.addEventListener('input', function () {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(function () {
    var value = input.value.trim().replace(/\/+$/, ''); // strip trailing slashes
    chrome.storage.sync.set({ apiHost: value || DEFAULT_API_HOST }, function () {
      status.textContent = 'Saved';
      setTimeout(function () { status.textContent = ''; }, 1500);
    });
  }, 400);
});
