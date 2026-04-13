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
   * Look for knowledge files uploaded to the gem.
   */
  function extractKnowledgeFiles() {
    var files = [];
    var headings = document.querySelectorAll('h1, h2, h3, [role="heading"], .section-title');
    
    for (var i = 0; i < headings.length; i++) {
      var hText = headings[i].textContent.trim().toLowerCase();
      if (hText === 'knowledge' || hText.includes('your files')) {
        // Look in the parent container for anything that looks like a filename
        var container = headings[i].closest('section') || headings[i].parentElement;
        if (container) {
          // Look for text nodes or aria-labels that match file patterns
          var allElems = container.querySelectorAll('*');
          allElems.forEach(function(el) {
            var text = (el.textContent || '').trim();
            var label = el.getAttribute('aria-label') || '';
            var title = el.getAttribute('title') || '';
            
            [text, label, title].forEach(function(str) {
              if (!str) return;
              // Very loose match for filenames: something.ext
              var matches = str.match(/[a-zA-Z0-9._-]+\.[a-zA-Z0-9]{2,5}/g);
              if (matches) {
                matches.forEach(function(m) {
                  // Filter out common UI strings that aren't files
                  if (m.includes('..') || m.length < 5 || m.length > 100) return;
                  if (!files.includes(m)) files.push(m);
                });
              }
            });
          });
        }
        break;
      }
    }
    return files;
  }

  /**
   * Look for enabled tools (Google Search, Python, etc.)
   */
  function extractEnabledTools() {
    var tools = [];
    // Tool keywords to search for
    var toolSpecs = [
      { name: 'Google Search', keywords: ['search', 'google search', 'web search'] },
      { name: 'Python', keywords: ['python', 'code execution', 'analysis'] },
      { name: 'Image generation', keywords: ['image', 'generate image', 'create image', 'dall-e'] },
      { name: 'YouTube', keywords: ['youtube'] },
      { name: 'Maps', keywords: ['maps', 'google maps'] }
    ];
    
    // 1. Try finding by roles
    var switches = document.querySelectorAll('[role="switch"], [role="checkbox"], button, .mat-slide-toggle, .mat-checkbox');
    switches.forEach(function(el) {
      var isEnabled = el.getAttribute('aria-checked') === 'true' || 
                      el.getAttribute('aria-pressed') === 'true' ||
                      el.classList.contains('checked') ||
                      el.classList.contains('mat-checked') ||
                      el.classList.contains('is-checked');
      
      if (isEnabled) {
        var contextText = (el.getAttribute('aria-label') || el.textContent || el.parentElement.textContent || '').toLowerCase();
        
        toolSpecs.forEach(function(spec) {
          spec.keywords.forEach(function(kw) {
            if (contextText.includes(kw) && !tools.includes(spec.name)) {
              tools.push(spec.name);
            }
          });
        });
      }
    });

    // 2. Fallback: Search for tool labels and find nearest toggles
    if (tools.length === 0) {
      toolSpecs.forEach(function(spec) {
        var labels = document.querySelectorAll('*');
        for (var i = 0; i < labels.length; i++) {
          var labelText = labels[i].textContent.toLowerCase();
          var found = false;
          spec.keywords.forEach(function(kw) {
            if (labelText === kw || (labelText.includes(kw) && labelText.length < 30)) {
              // Found a potential label, look for a switch in its vicinity
              var area = labels[i].closest('div') || labels[i].parentElement;
              var toggle = area ? area.querySelector('[aria-checked="true"], [aria-pressed="true"], .checked, .mat-checked') : null;
              if (toggle) {
                if (!tools.includes(spec.name)) tools.push(spec.name);
                found = true;
              }
            }
          });
          if (found) break;
        }
      });
    }

    return tools;
  }

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
        knowledgeFiles: extractKnowledgeFiles(),
        defaultTools: extractEnabledTools(),
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
          showOverlay({ error: (result && result.error) || 'Extraction failed.' });
          return;
        }

        var gem = result.gems[0];

        // Store locally — callback tells us if new or updated, plus the full list
        chrome.runtime.sendMessage({ type: 'STORE_GEM', gem: gem }, function (resp) {
          if (resp && resp.success) {
            setFabState('success');
            showOverlay({
              gem: gem,
              wasUpdate: resp.wasUpdate,
              totalGems: resp.totalGems,
              allGems: resp.allGems
            });
          } else {
            setFabState('error');
            showOverlay({ error: 'Failed to save gem locally.' });
          }
        });
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

    if (result.error) {
      title.textContent = 'Gem Factory \u2014 Error';
    } else if (result.wasUpdate) {
      title.textContent = 'Gem Factory \u2014 Gem Updated';
    } else {
      title.textContent = 'Gem Factory \u2014 Gem Saved';
    }
    header.appendChild(title);

    if (result.gem) {
      var badge = document.createElement('span');
      badge.className = 'gf-badge';
      badge.textContent = result.gem.name;
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
    } else {
      // Confirmation banner
      var banner = document.createElement('div');
      if (result.wasUpdate) {
        banner.className = 'gf-banner gf-banner-update';
        banner.textContent = '\u2714 "' + result.gem.name + '" was already in your list and has been updated with the latest version.';
      } else {
        banner.className = 'gf-banner gf-banner-success';
        banner.textContent = '\u2714 "' + result.gem.name + '" has been saved to your local gem list.';
      }
      body.appendChild(banner);

      // Instructions preview
      if (result.gem.instructions) {
        var previewLabel = document.createElement('div');
        previewLabel.className = 'gf-section-label';
        previewLabel.textContent = 'Instructions preview';
        body.appendChild(previewLabel);

        var preview = document.createElement('div');
        preview.className = 'gf-instructions-preview';
        var text = result.gem.instructions;
        preview.textContent = text.length > 300 ? text.substring(0, 300) + '\u2026' : text;
        body.appendChild(preview);
      }

      // Running list of all gems
      if (result.allGems && result.allGems.length > 0) {
        var listLabel = document.createElement('div');
        listLabel.className = 'gf-section-label';
        listLabel.textContent = 'Your gem collection (' + result.allGems.length + ')';
        body.appendChild(listLabel);

        var gemList = document.createElement('ul');
        gemList.className = 'gf-gem-list';

        // Show newest first
        var sorted = result.allGems.slice().sort(function (a, b) {
          return (b.extractedAt || '').localeCompare(a.extractedAt || '');
        });

        for (var i = 0; i < sorted.length; i++) {
          var li = document.createElement('li');
          li.className = 'gf-gem-list-item';
          // Highlight the gem we just saved
          if (sorted[i].id === result.gem.id) {
            li.className += ' gf-gem-list-item-active';
          }
          var nameSpan = document.createElement('span');
          nameSpan.className = 'gf-gem-list-name';
          nameSpan.textContent = sorted[i].name || '(unnamed)';
          li.appendChild(nameSpan);

          if (sorted[i].extractedAt) {
            var dateSpan = document.createElement('span');
            dateSpan.className = 'gf-gem-list-date';
            try {
              var d = new Date(sorted[i].extractedAt);
              dateSpan.textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            } catch (e) {
              dateSpan.textContent = '';
            }
            li.appendChild(dateSpan);
          }
          gemList.appendChild(li);
        }

        body.appendChild(gemList);
      }
    }

    // --- Footer ---
    var footer = document.createElement('div');
    footer.className = 'gf-footer';

    if (result.gem) {
      var copyBtn = document.createElement('button');
      copyBtn.className = 'gf-btn gf-btn-primary';
      copyBtn.textContent = 'Copy JSON';
      copyBtn.addEventListener('click', async function () {
        try {
          var payload = { 
            name: result.gem.name, 
            instructions: result.gem.instructions, 
            knowledgeFiles: result.gem.knowledgeFiles || [],
            defaultTools: result.gem.defaultTools || [],
            source: result.gem.source || 'edit_page' 
          };
          await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
          copyBtn.textContent = 'Copied!';
          setTimeout(function () { copyBtn.textContent = 'Copy JSON'; }, 2000);
        } catch (e) {
          copyBtn.textContent = 'Copy failed';
          setTimeout(function () { copyBtn.textContent = 'Copy JSON'; }, 2000);
        }
      });
      footer.appendChild(copyBtn);
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
