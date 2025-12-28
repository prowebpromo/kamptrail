/**
 * KampTrail Notes Module
 * Allows users to add custom notes to campsites
 */
(function () {
  'use strict';

  const notes = {};

  /**
   * Load notes from localStorage
   */
  function load() {
    try {
      const data = localStorage.getItem('kt_notes');
      if (data) {
        Object.assign(notes, JSON.parse(data));
      }
    } catch (e) {
      console.error('Failed to load notes:', e);
    }
  }

  /**
   * Save notes to localStorage
   */
  function save() {
    try {
      localStorage.setItem('kt_notes', JSON.stringify(notes));
    } catch (e) {
      console.error('Failed to save notes:', e);
    }
  }

  /**
   * Get note for a campsite
   */
  function getNote(siteId) {
    return notes[siteId] || null;
  }

  /**
   * Set note for a campsite
   */
  function setNote(siteId, text) {
    if (!text || text.trim() === '') {
      delete notes[siteId];
    } else {
      notes[siteId] = {
        text: text.trim(),
        timestamp: Date.now()
      };
    }
    save();
  }

  /**
   * Delete note for a campsite
   */
  function deleteNote(siteId) {
    delete notes[siteId];
    save();
  }

  /**
   * Get notes HTML for popup
   */
  function getNotesHTML(siteId) {
    const note = getNote(siteId);

    return `
      <div style="border-top:1px solid rgba(255,255,255,.1);margin-top:8px;padding-top:8px">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px">📝 Notes</div>
        ${note ? `
          <div id="note-display-${siteId}" style="background:rgba(134,183,255,.1);padding:8px;border-radius:6px;margin-bottom:6px;font-size:12px;white-space:pre-wrap">${escapeHtml(note.text)}</div>
          <div style="display:flex;gap:6px">
            <button onclick="KampTrailNotes.editNote('${siteId}')" style="flex:1;padding:4px 8px;background:#173243;color:#9fd0ff;border:1px solid #284356;border-radius:4px;cursor:pointer;font-size:11px">
              ✏️ Edit
            </button>
            <button onclick="KampTrailNotes.deleteNote('${siteId}')" style="flex:1;padding:4px 8px;background:#3d1a1a;color:#ff6b6b;border:1px solid #ff6b6b;border-radius:4px;cursor:pointer;font-size:11px">
              🗑️ Delete
            </button>
          </div>
        ` : `
          <button onclick="KampTrailNotes.addNote('${siteId}')" style="width:100%;padding:6px 8px;background:#173243;color:#86b7ff;border:1px solid #284356;border-radius:6px;cursor:pointer;font-size:12px">
            + Add Note
          </button>
        `}
      </div>
    `;
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Add note (prompt user)
   */
  function addNote(siteId) {
    const text = prompt('Add a note for this campsite:');
    if (text && text.trim()) {
      setNote(siteId, text);
      refreshPopup(siteId);
      showToast && showToast('Note added', 'success');
    }
  }

  /**
   * Edit note (prompt user)
   */
  function editNote(siteId) {
    const currentNote = getNote(siteId);
    const text = prompt('Edit note:', currentNote ? currentNote.text : '');
    if (text !== null) {
      setNote(siteId, text);
      refreshPopup(siteId);
      showToast && showToast('Note updated', 'success');
    }
  }

  /**
   * Delete note with confirmation
   */
  function deleteNoteWithConfirm(siteId) {
    if (confirm('Delete this note?')) {
      deleteNote(siteId);
      refreshPopup(siteId);
      showToast && showToast('Note deleted', 'success');
    }
  }

  /**
   * Refresh popup content
   */
  function refreshPopup(siteId) {
    // Find the notes container and update it
    const container = document.querySelector(`[id^="note-container-${siteId}"]`);
    if (container) {
      container.outerHTML = getNotesHTML(siteId);
    }
  }

  /**
   * Add notes section to popup
   */
  function addNotesToPopup(siteId, popupElement) {
    const notesHTML = getNotesHTML(siteId);
    const div = document.createElement('div');
    div.id = `note-container-${siteId}`;
    div.innerHTML = notesHTML;

    if (popupElement) {
      // Insert before weather section if it exists, otherwise at the end
      const weatherDiv = popupElement.querySelector('[id^="weather-"]');
      if (weatherDiv) {
        popupElement.insertBefore(div, weatherDiv);
      } else {
        popupElement.appendChild(div);
      }
    }
  }

  /**
   * Initialize notes module
   */
  function init() {
    load();
    console.log('[Notes] Initialized');
  }

  // Export
  window.KampTrailNotes = {
    init,
    getNote,
    setNote,
    deleteNote: deleteNoteWithConfirm,
    addNote,
    editNote,
    getNotesHTML,
    addNotesToPopup
  };
})();
