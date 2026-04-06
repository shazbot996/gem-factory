// ==========================================================================
// Gem Factory Extractor — Content Script
// Runs on gemini.google.com: shows FAB on gem edit pages, extracts gem
// data directly from the edit form's DOM fields.
// ==========================================================================

(function () {
  'use strict';

  // ---------- SVG Icons ----------

  const ICONS = {
    idle: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M6 2l-6 8 12 13L24 10 18 2H6zm1.5 1h9l4 6.5-8.5 9.5-8.5-9.5L7.5 3z" fill="currentColor"/><path d="M7.5 3l-4 6.5 8.5 9.5 8.5-9.5-4-6.5h-9z" fill="currentColor" opacity="0.3"/></svg>',
    loading: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2a10 10 0 0 1 10 10h-2a8 8 0 0 0-8-8V2z" fill="currentColor"/></svg>',
    success: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="currentColor"/></svg>',
    error: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" fill="currentColor"/></svg>'
  };

  // ---------- Page Detection ----------

  // Only show FAB on gem edit pages where full data is available in the DOM
  const EDIT_PAGE_PATTERN = /^https:\/\/gemini\.google\.com\/gems\/edit\/(.+)/;

  function getEditPageGemId() {
    var match = location.href.match(EDIT_PAGE_PATTERN);
    return match ? match[1].split('?')[0].split('#')[0] : null;
  }

  function isEditPage() {
    return EDIT_PAGE_PATTERN.test(location.href);
  }

  // ---------- DOM Extraction ----------

  /**
   * Extract gem data directly from the edit page's form fields.
   * The edit page renders the gem name in an input and the full
   * instructions in a Quill rich-text editor (.ql-editor).
   */
  function extractGemFromEditPage() {
    var gemId = getEditPageGemId();
    if (!gemId) return null;

    // Extract gem name — look for common input/heading patterns
    var name = '';
    // Try: input fields with the gem name
    var nameInputs = document.querySelectorAll('input[type="text"], input:not([type])');
    for (var i = 0; i < nameInputs.length; i++) {
      var val = nameInputs[i].value.trim();
      if (val && val.length > 0 && val.length < 200) {
        name = val;
        break;
      }
    }
    // Fallback: look for a prominent heading or label
    if (!name) {
      var headings = document.querySelectorAll('h1, h2, [role="heading"]');
      for (var h = 0; h < headings.length; h++) {
        var txt = headings[h].textContent.trim();
        if (txt && txt.length > 0 && txt.length < 200 && txt !== 'Gem manager') {
          name = txt;
          break;
        }
      }
    }

    // Extract instructions from the Quill editor
    var instructions = '';
    var editor = document.querySelector('.ql-editor');
    if (editor) {
      instructions = editor.innerText || editor.textContent || '';
      instructions = instructions.trim();
    }
    // Fallback: try textareas
    if (!instructions) {
      var textareas = document.querySelectorAll('textarea');
      for (var t = 0; t < textareas.length; t++) {
        var taVal = textareas[t].value.trim();
        if (taVal && taVal.length > instructions.length) {
          instructions = taVal;
        }
      }
    }

    if (!instructions) {
      return { error: 'Could not find gem instructions on this page. The page may still be loading — wait a moment and try again.' };
    }

    return {
      gems: [{
        id: gemId,
        name: name || '(unnamed)',
        description: '',
        instructions: instructions,
        knowledgeFiles: [],
        extractedAt: new Date().toISOString(),
        source: 'edit_page'
      }]
    };
  }

  // ---------- FAB ----------

  var fab = null;
  var fabStateTimeout = null;

  function createFab() {
    var btn = document.createElement('button');
    btn.id = 'gem-factory-fab';
    btn.title = 'Extract this Gem';
    btn.innerHTML = ICONS.idle;
    btn.addEventListener('click', handleFabClick);
    document.body.appendChild(btn);
    return btn;
  }

  function setFabState(state) {
    if (!fab) return;
    if (fabStateTimeout) {
      clearTimeout(fabStateTimeout);
      fabStateTimeout = null;
    }
    fab.className = state;
    fab.innerHTML = ICONS[state] || ICONS.idle;
    fab.disabled = (state === 'loading');
    if (state === 'success' || state === 'error') {
      fabStateTimeout = setTimeout(function () { setFabState('idle'); }, 1500);
    }
  }

  function updateFabVisibility() {
    if (!fab) return;
    fab.style.display = isEditPage() ? 'flex' : 'none';
  }

  // ---------- FAB Click Handler ----------

  function handleFabClick() {
    if (fab && fab.disabled) return;

    setFabState('loading');

    // Small delay to let any lazy-loaded content settle
    setTimeout(function () {
      try {
        var result = extractGemFromEditPage();

        if (!result || result.error) {
          setFabState('error');
          showOverlay(result || { error: 'Extraction failed.' });
          return;
        }

        // Store in extension storage for future SPA integration
        chrome.runtime.sendMessage({ type: 'STORE_GEM', gem: result.gems[0] });

        setFabState('success');
        showOverlay(result);
      } catch (err) {
        setFabState('error');
        showOverlay({ error: err.message || 'An unexpected error occurred.' });
      }
    }, 200);
  }

  // ---------- Overlay ----------

  function handleEscapeKey(e) {
    if (e.key === 'Escape') removeOverlay();
  }

  function removeOverlay() {
    var existing = document.getElementById('gem-factory-overlay');
    if (existing) existing.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', handleEscapeKey);
  }

  function showOverlay(result) {
    removeOverlay();

    var overlay = document.createElement('div');
    overlay.id = 'gem-factory-overlay';

    var panel = document.createElement('div');
    panel.className = 'gf-panel';

    // --- Header ---
    var header = document.createElement('div');
    header.className = 'gf-header';

    var title = document.createElement('h2');
    title.className = 'gf-title';
    title.textContent = 'Gem Factory \u2014 Extracted Gem';
    header.appendChild(title);

    if (result.gems && result.gems.length > 0) {
      var badge = document.createElement('span');
      badge.className = 'gf-badge';
      badge.textContent = result.gems[0].name;
      header.appendChild(badge);
    }

    var closeBtn = document.createElement('button');
    closeBtn.className = 'gf-close-btn';
    closeBtn.title = 'Close';
    closeBtn.innerHTML = ICONS.close;
    closeBtn.addEventListener('click', removeOverlay);
    header.appendChild(closeBtn);

    // --- Body ---
    var body = document.createElement('div');
    body.className = 'gf-body';

    if (result.error) {
      var msg = document.createElement('div');
      msg.className = 'gf-message gf-error';
      msg.textContent = result.error;
      body.appendChild(msg);
    } else if (!result.gems || result.gems.length === 0) {
      var emptyMsg = document.createElement('div');
      emptyMsg.className = 'gf-message';
      emptyMsg.textContent = 'No gem data found on this page.';
      body.appendChild(emptyMsg);
    } else {
      var pre = document.createElement('pre');
      pre.textContent = JSON.stringify(result.gems, null, 2);
      body.appendChild(pre);
    }

    // --- Footer ---
    var footer = document.createElement('div');
    footer.className = 'gf-footer';

    if (result.gems && result.gems.length > 0) {
      var copyBtn = document.createElement('button');
      copyBtn.className = 'gf-btn gf-btn-primary';
      copyBtn.textContent = 'Copy to Clipboard';
      copyBtn.addEventListener('click', async function () {
        var prEl = overlay.querySelector('pre');
        if (!prEl) return;
        try {
          await navigator.clipboard.writeText(prEl.textContent);
          copyBtn.textContent = 'Copied!';
          setTimeout(function () { copyBtn.textContent = 'Copy to Clipboard'; }, 2000);
        } catch (e) {
          copyBtn.textContent = 'Copy failed';
          setTimeout(function () { copyBtn.textContent = 'Copy to Clipboard'; }, 2000);
        }
      });
      footer.appendChild(copyBtn);

      var sendBtn = document.createElement('button');
      sendBtn.className = 'gf-btn gf-btn-primary gf-btn-send';
      sendBtn.textContent = 'Send to API';
      sendBtn.addEventListener('click', function () {
        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending\u2026';
        var gem = result.gems[0];
        // Build import payload matching /api/gems/import shape
        var importGem = {
          name: gem.name,
          instructions: gem.instructions
        };
        if (gem.source) importGem.source = gem.source;
        chrome.runtime.sendMessage({ type: 'SEND_TO_API', gem: importGem }, function (resp) {
          if (resp && resp.success) {
            sendBtn.textContent = 'Sent!';
            sendBtn.className = 'gf-btn gf-btn-success';
            setTimeout(function () {
              sendBtn.textContent = 'Send to API';
              sendBtn.className = 'gf-btn gf-btn-primary gf-btn-send';
              sendBtn.disabled = false;
            }, 2000);
          } else {
            var errMsg = (resp && resp.error) || 'Send failed';
            sendBtn.textContent = errMsg;
            sendBtn.className = 'gf-btn gf-btn-error';
            setTimeout(function () {
              sendBtn.textContent = 'Send to API';
              sendBtn.className = 'gf-btn gf-btn-primary gf-btn-send';
              sendBtn.disabled = false;
            }, 3000);
          }
        });
      });
      footer.appendChild(sendBtn);
    }

    var closeFooterBtn = document.createElement('button');
    closeFooterBtn.className = 'gf-btn gf-btn-secondary';
    closeFooterBtn.textContent = 'Close';
    closeFooterBtn.addEventListener('click', removeOverlay);
    footer.appendChild(closeFooterBtn);

    // --- Assemble ---
    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    overlay.appendChild(panel);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) removeOverlay();
    });
    document.addEventListener('keydown', handleEscapeKey);
    document.body.style.overflow = 'hidden';
    document.body.appendChild(overlay);
  }

  // ---------- Init ----------

  fab = createFab();
  updateFabVisibility();

  // Poll for SPA navigation
  var lastUrl = location.href;
  setInterval(function () {
    var currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      updateFabVisibility();
    }
  }, 500);

})();
