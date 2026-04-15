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
   * Extracts name, type label, and mime type (from the icon URL).
   * Each file preview chip is clickable in the native UI — we record the
   * DOM element reference so the overlay can programmatically click it.
   */
  function extractKnowledgeFiles() {
    var files = [];
    // The Gemini edit page renders knowledge files inside a .knowledge-container
    // with <uploader-file-preview> elements for each file.
    var container = document.querySelector('.knowledge-container');
    if (!container) return files;

    var previews = container.querySelectorAll('uploader-file-preview');
    previews.forEach(function (preview) {
      var nameEl = preview.querySelector('[data-test-id="file-name"]');
      var typeEl = preview.querySelector('.file-type');
      if (nameEl) {
        var name = nameEl.textContent.trim();
        if (name) {
          // Parse mime type from the Drive icon URL if available
          var mimeType = '';
          var iconImg = preview.querySelector('[data-test-id="file-icon-img"]');
          if (iconImg && iconImg.src) {
            var mimeMatch = iconImg.src.match(/\/type\/(.+)$/);
            if (mimeMatch) mimeType = decodeURIComponent(mimeMatch[1]);
          }

          // The clickable file-preview div that opens the Drive viewer
          var clickTarget = preview.querySelector('[data-test-id="file-preview"]');

          files.push({
            name: name,
            type: typeEl ? typeEl.textContent.trim() : '',
            mimeType: mimeType,
            _clickTarget: clickTarget || preview,
            _previewEl: preview
          });
        }
      }
    });

    return files;
  }

  /**
   * Look for enabled tools (Google Search, Python, etc.)
   */
  function extractEnabledTools() {
    var tools = [];
    // The Gemini edit page has a <bots-creation-default-tool-section> element
    // containing a dropdown button (.default-tool-trigger) whose label span
    // holds the currently selected tool name.
    var section = document.querySelector('bots-creation-default-tool-section');
    if (section) {
      var trigger = section.querySelector('.default-tool-trigger .logo-pill-label-container span');
      if (trigger) {
        var text = trigger.textContent.trim();
        if (text) tools.push(text);
      }
    }

    return tools;
  }

  /** Map mime types to short emoji icons for the overlay list */
  function getMimeIcon(mimeType) {
    if (!mimeType) return '\uD83D\uDCC4'; // 📄
    if (mimeType.indexOf('spreadsheet') !== -1) return '\uD83D\uDCCA'; // 📊
    if (mimeType.indexOf('document') !== -1) return '\uD83D\uDCC4'; // 📄
    if (mimeType.indexOf('presentation') !== -1) return '\uD83D\uDCCA'; // 📊
    if (mimeType.indexOf('pdf') !== -1) return '\uD83D\uDCC4'; // 📄
    if (mimeType.indexOf('image') !== -1) return '\uD83D\uDDBC'; // 🖼
    if (mimeType.indexOf('text') !== -1) return '\uD83D\uDCDD'; // 📝
    return '\uD83D\uDCC1'; // 📁
  }

  /** Human-friendly mime type label */
  function friendlyMimeType(mimeType) {
    if (!mimeType) return '';
    if (mimeType.indexOf('spreadsheet') !== -1) return 'Google Sheets';
    if (mimeType.indexOf('document') !== -1) return 'Google Docs';
    if (mimeType.indexOf('presentation') !== -1) return 'Google Slides';
    if (mimeType.indexOf('pdf') !== -1) return 'PDF';
    if (mimeType.indexOf('image') !== -1) return 'Image';
    if (mimeType.indexOf('text/plain') !== -1) return 'Text file';
    if (mimeType.indexOf('text/csv') !== -1) return 'CSV';
    return mimeType.split('/').pop().replace('vnd.google-apps.', '');
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

    // Extract description from the dedicated textarea
    var description = '';
    var descInput = document.getElementById('gem-description-input');
    if (descInput) {
      description = descInput.value.trim();
    }

    var knowledgeRaw = extractKnowledgeFiles();

    // Separate DOM refs (for overlay interaction) from serializable data
    var knowledgeForStorage = knowledgeRaw.map(function (f) {
      return { name: f.name, type: f.type, mimeType: f.mimeType };
    });

    return {
      gems: [{
        id: gemId,
        name: name || '(unnamed)',
        description: description,
        instructions: instructions,
        knowledgeFiles: knowledgeForStorage,
        defaultTools: extractEnabledTools(),
        extractedAt: new Date().toISOString(),
        source: 'edit_page'
      }],
      _knowledgeDom: knowledgeRaw
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
        var knowledgeDom = result._knowledgeDom || [];

        // Before storing, merge in any previously captured driveId/driveUrl
        // so re-opening the overlay doesn't wipe out earlier link captures.
        chrome.runtime.sendMessage({ type: 'GET_ALL_GEMS' }, function (stored) {
          if (stored && stored.gems) {
            for (var s = 0; s < stored.gems.length; s++) {
              if (stored.gems[s].id === gem.id) {
                var oldKFiles = stored.gems[s].knowledgeFiles || [];
                for (var n = 0; n < gem.knowledgeFiles.length; n++) {
                  for (var o = 0; o < oldKFiles.length; o++) {
                    if (oldKFiles[o].name === gem.knowledgeFiles[n].name && oldKFiles[o].driveId) {
                      gem.knowledgeFiles[n].driveId = oldKFiles[o].driveId;
                      gem.knowledgeFiles[n].driveUrl = oldKFiles[o].driveUrl;
                      // Also populate the knowledgeDom entry so the overlay shows it
                      for (var d = 0; d < knowledgeDom.length; d++) {
                        if (knowledgeDom[d].name === gem.knowledgeFiles[n].name) {
                          knowledgeDom[d].driveId = oldKFiles[o].driveId;
                          knowledgeDom[d].driveUrl = oldKFiles[o].driveUrl;
                        }
                      }
                      break;
                    }
                  }
                }
                break;
              }
            }
          }

          // Now store with merged data
          chrome.runtime.sendMessage({ type: 'STORE_GEM', gem: gem }, function (resp) {
            if (resp && resp.success) {
              setFabState('success');
              showOverlay({
                gem: gem,
                wasUpdate: resp.wasUpdate,
                totalGems: resp.totalGems,
                allGems: resp.allGems,
                knowledgeDom: knowledgeDom
              });
            } else {
              setFabState('error');
              showOverlay({ error: 'Failed to save gem locally.' });
            }
          });
        });
      } catch (err) {
        setFabState('error');
        showOverlay({ error: err.message || 'An unexpected error occurred.' });
      }
    }, 200);
  }

  // ---------- Overlay ----------

  var capturingLinks = false;

  function handleEscapeKey(e) {
    if (e.key === 'Escape' && !capturingLinks) removeOverlay();
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

      // Knowledge files section
      var kFiles = result.knowledgeDom || [];
      if (kFiles.length > 0) {
        var kLabelRow = document.createElement('div');
        kLabelRow.className = 'gf-knowledge-header';

        var kLabel = document.createElement('div');
        kLabel.className = 'gf-section-label';
        kLabel.textContent = 'Knowledge documents (' + kFiles.length + ')';
        kLabelRow.appendChild(kLabel);

        var captureAllBtn = document.createElement('button');
        captureAllBtn.className = 'gf-knowledge-open';
        captureAllBtn.textContent = 'Capture All Links';
        captureAllBtn.title = 'Silently captures the Google Drive URL for each document';
        kLabelRow.appendChild(captureAllBtn);

        body.appendChild(kLabelRow);

        var kList = document.createElement('ul');
        kList.className = 'gf-knowledge-list';

        // Build the list items and keep references for updating status
        var kItemEls = [];
        for (var k = 0; k < kFiles.length; k++) {
          (function (kf, idx) {
            var kItem = document.createElement('li');
            kItem.className = 'gf-knowledge-item';

            var kIcon = document.createElement('span');
            kIcon.className = 'gf-knowledge-icon';
            kIcon.textContent = getMimeIcon(kf.mimeType);
            kItem.appendChild(kIcon);

            var kInfo = document.createElement('div');
            kInfo.className = 'gf-knowledge-info';

            var kName = document.createElement('span');
            kName.className = 'gf-knowledge-name';
            kName.textContent = kf.name;
            kInfo.appendChild(kName);

            var kMeta = document.createElement('span');
            kMeta.className = 'gf-knowledge-type';
            kMeta.textContent = kf.mimeType ? friendlyMimeType(kf.mimeType) : '';
            kInfo.appendChild(kMeta);

            var kLink = document.createElement('a');
            kLink.className = 'gf-knowledge-link';
            kLink.target = '_blank';
            kLink.rel = 'noopener';
            // Show previously captured link if available
            if (kf.driveUrl) {
              kLink.href = kf.driveUrl;
              kLink.textContent = kf.driveUrl;
              kLink.style.display = '';
            } else {
              kLink.style.display = 'none';
            }
            kInfo.appendChild(kLink);

            kItem.appendChild(kInfo);

            var kStatus = document.createElement('span');
            kStatus.className = 'gf-knowledge-status';
            // Show existing capture status
            if (kf.driveId) {
              kStatus.textContent = '\u2714';
              kStatus.title = 'Previously captured';
              kStatus.className = 'gf-knowledge-status gf-status-ok';
            }
            kItem.appendChild(kStatus);

            kItemEls.push({ item: kItem, meta: kMeta, link: kLink, status: kStatus });
            kList.appendChild(kItem);
          })(kFiles[k], k);
        }

        body.appendChild(kList);

        // Wire up the "Capture All Links" button
        captureAllBtn.addEventListener('click', function () {
          captureAllBtn.disabled = true;
          captureAllBtn.textContent = 'Capturing\u2026';
          capturingLinks = true;

          // Mark all items as pending
          for (var p = 0; p < kItemEls.length; p++) {
            kItemEls[p].status.textContent = '\u23F3'; // ⏳
            kItemEls[p].status.title = 'Waiting\u2026';
          }

          captureAllDriveLinks(kFiles, result.gem.id,
            function onProgress(idx, driveInfo) {
              var el = kItemEls[idx];
              if (driveInfo) {
                el.status.textContent = '\u2714';
                el.status.title = 'Captured';
                el.status.className = 'gf-knowledge-status gf-status-ok';
                el.link.href = driveInfo.driveUrl;
                el.link.textContent = driveInfo.driveUrl;
                el.link.style.display = '';
                el.meta.textContent = friendlyMimeType(kFiles[idx].mimeType);
              } else {
                el.status.textContent = '\u2716';
                el.status.title = 'Could not capture link';
                el.status.className = 'gf-knowledge-status gf-status-fail';
              }
            },
            function onDone() {
              capturingLinks = false;
              captureAllBtn.textContent = '\u2714 All Captured';
              captureAllBtn.className = 'gf-knowledge-open gf-knowledge-captured';
              captureAllBtn.disabled = false;
              captureAllBtn.title = 'All links captured! Click to re-capture.';
            }
          );
        });
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
          // Merge any captured Drive links from knowledgeDom back into the output
          var kFilesOut = (result.gem.knowledgeFiles || []).map(function (f) {
            var copy = { name: f.name, type: f.type, mimeType: f.mimeType };
            if (f.driveId) copy.driveId = f.driveId;
            if (f.driveUrl) copy.driveUrl = f.driveUrl;
            // Also check knowledgeDom for links captured this session
            var kDom = result.knowledgeDom || [];
            for (var d = 0; d < kDom.length; d++) {
              if (kDom[d].name === f.name && kDom[d].driveId) {
                copy.driveId = kDom[d].driveId;
                copy.driveUrl = kDom[d].driveUrl;
                break;
              }
            }
            return copy;
          });
          var payload = {
            name: result.gem.name,
            description: result.gem.description || '',
            instructions: result.gem.instructions,
            knowledgeFiles: kFilesOut,
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

  // ---------- Drive Viewer Link Capture ----------

  /**
   * Build a canonical Google Drive URL from a file ID and mime type.
   */
  function buildDriveUrl(fileId, mimeType) {
    if (!fileId) return '';
    if (mimeType && mimeType.indexOf('spreadsheet') !== -1) {
      return 'https://docs.google.com/spreadsheets/d/' + fileId;
    }
    if (mimeType && mimeType.indexOf('document') !== -1) {
      return 'https://docs.google.com/document/d/' + fileId;
    }
    if (mimeType && mimeType.indexOf('presentation') !== -1) {
      return 'https://docs.google.com/presentation/d/' + fileId;
    }
    return 'https://drive.google.com/file/d/' + fileId;
  }

  /**
   * Hide the Drive viewer visually using only opacity and z-index.
   * NEVER set pointer-events:none — that prevents the close button
   * from working through Closure Library's event system.
   */
  function hideDriveViewer() {
    var viewer = document.querySelector('div.drive-viewer.drive-viewer-overlay');
    if (viewer) {
      viewer.style.setProperty('opacity', '0', 'important');
      viewer.style.setProperty('z-index', '-1', 'important');
    }
  }

  /**
   * Remove our inline hide overrides from the viewer so Angular sees
   * it as "normal" when we ask it to close.
   */
  function unhideDriveViewer() {
    var viewer = document.querySelector('div.drive-viewer.drive-viewer-overlay');
    if (viewer) {
      viewer.style.removeProperty('opacity');
      viewer.style.removeProperty('z-index');
    }
  }

  /**
   * Ask the Drive viewer to close via Escape key dispatch.
   * The viewer declares aria-keyshortcuts="Escape" and listens for it.
   * We dispatch on the viewer element itself, and also try the close button.
   */
  function requestDriveViewerClose() {
    var viewer = document.querySelector('div.drive-viewer.drive-viewer-overlay');

    // First: restore styles so Angular sees the viewer as "normal"
    unhideDriveViewer();

    // Re-hide immediately with opacity so user doesn't see a flash
    // (z-index stays restored so events work normally)
    if (viewer) {
      viewer.style.setProperty('opacity', '0', 'important');
    }

    // Strategy 1: Dispatch Escape key on the viewer
    if (viewer) {
      viewer.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true
      }));
    }

    // Strategy 2: Also click the close button
    var closeBtn = document.querySelector('.drive-viewer-close-button[aria-label="Close"]');
    if (closeBtn) closeBtn.click();

    // Strategy 3: Dispatch Escape on the viewer's parent as fallback
    // (avoid document-level dispatch so our own overlay Escape handler
    // doesn't accidentally fire)
    if (viewer && viewer.parentNode) {
      viewer.parentNode.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, bubbles: false
      }));
    }
  }

  /**
   * Wait until the Drive viewer is fully gone from the DOM, then call onClean.
   * NEVER force-removes DOM — Angular must manage its own lifecycle or
   * subsequent viewer opens will fail.
   */
  function waitForViewerGone(onClean) {
    var cleanAttempts = 0;
    var maxCleanAttempts = 40; // 40 × 100ms = 4 seconds
    var retried = false;
    var cleanTimer = setInterval(function () {
      cleanAttempts++;
      var viewer = document.querySelector('div.drive-viewer.drive-viewer-overlay');

      if (!viewer) {
        clearInterval(cleanTimer);
        onClean();
        return;
      }

      // At the halfway point, try closing again in case the first attempt
      // was swallowed (e.g. by a focus issue)
      if (cleanAttempts === 20 && !retried) {
        retried = true;
        requestDriveViewerClose();
      }

      if (cleanAttempts >= maxCleanAttempts) {
        // Give up waiting — viewer didn't close. DON'T force-remove.
        // Signal done anyway so the sequence can continue; this file
        // was already captured, it's only the close that's stuck.
        clearInterval(cleanTimer);
        // Last resort: hide it and move on. Angular state is intact.
        hideDriveViewer();
        onClean();
      }
    }, 100);
  }

  /**
   * Silently capture a Drive file's ID by briefly opening the Drive viewer
   * invisibly, reading #drive-active-item-info, then closing it.
   *
   * CRITICAL: We never force-remove the viewer DOM. Angular must close it
   * naturally via Escape/close-button, or subsequent opens will break.
   *
   * @param {Element} clickTarget  - the native file-preview element to click
   * @param {function} onCapture   - called with { driveId, driveUrl, title, mimeType } or null
   */
  function silentCaptureDriveLink(clickTarget, onCapture) {
    // 1. Click the chip to trigger the viewer
    clickTarget.click();

    // 2. Poll — hide viewer on sight, then wait for file info
    var attempts = 0;
    var maxAttempts = 80; // 80 × 75ms = 6 seconds max
    var viewerHidden = false;
    var pollTimer = setInterval(function () {
      attempts++;

      // Hide the viewer as soon as it appears
      if (!viewerHidden) {
        var viewer = document.querySelector('div.drive-viewer.drive-viewer-overlay');
        if (viewer) {
          hideDriveViewer();
          viewerHidden = true;
        }
      }

      // Check for the file info element
      var infoEl = document.getElementById('drive-active-item-info');
      if (infoEl) {
        clearInterval(pollTimer);
        var result = null;
        try {
          var info = JSON.parse(infoEl.textContent);
          if (info && info.id) {
            result = {
              driveId: info.id,
              driveUrl: buildDriveUrl(info.id, info.mimeType),
              title: info.title || '',
              mimeType: info.mimeType || ''
            };
          }
        } catch (e) {
          // JSON parse failed
        }

        // Ask Angular to close, wait for it, then signal done
        requestDriveViewerClose();
        waitForViewerGone(function () {
          onCapture(result);
        });
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(pollTimer);
        // Timed out — still try to close whatever's there
        requestDriveViewerClose();
        waitForViewerGone(function () {
          onCapture(null);
        });
      }
    }, 75);
  }

  /**
   * Capture Drive links for multiple knowledge files sequentially.
   * Each file is processed one at a time. The onProgress callback
   * fires after each file with (index, driveInfo).
   * The onDone callback fires when all files are processed.
   */
  function captureAllDriveLinks(knowledgeFiles, gemId, onProgress, onDone) {
    var index = 0;

    function next() {
      if (index >= knowledgeFiles.length) {
        if (onDone) onDone();
        return;
      }

      var kf = knowledgeFiles[index];
      var currentIndex = index;

      // Pause between captures to let Angular fully settle
      setTimeout(function () {
        if (!kf._clickTarget) {
          onProgress(currentIndex, null);
          index++;
          next();
          return;
        }

        silentCaptureDriveLink(kf._clickTarget, function (driveInfo) {
          if (driveInfo) {
            kf.driveId = driveInfo.driveId;
            kf.driveUrl = driveInfo.driveUrl;
            persistKnowledgeLink(gemId, kf.name, driveInfo);
          }
          onProgress(currentIndex, driveInfo);
          index++;
          next();
        });
      }, currentIndex === 0 ? 0 : 600);
    }

    next();
  }

  /**
   * After capturing a Drive link, update the gem's knowledgeFiles in
   * chrome.storage.local so the link persists in the exported JSON.
   */
  function persistKnowledgeLink(gemId, fileName, driveInfo) {
    chrome.runtime.sendMessage({ type: 'GET_ALL_GEMS' }, function (data) {
      if (!data || !data.gems) return;
      var gems = data.gems;
      for (var i = 0; i < gems.length; i++) {
        if (gems[i].id === gemId) {
          var kFiles = gems[i].knowledgeFiles || [];
          for (var j = 0; j < kFiles.length; j++) {
            if (kFiles[j].name === fileName) {
              kFiles[j].driveId = driveInfo.driveId;
              kFiles[j].driveUrl = driveInfo.driveUrl;
              break;
            }
          }
          // Re-store the updated gem
          chrome.runtime.sendMessage({ type: 'STORE_GEM', gem: gems[i] }, function () {});
          break;
        }
      }
    });
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
