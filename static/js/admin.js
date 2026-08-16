/* ============================================================
   LTRIE ADMIN PANEL — JavaScript Logic
   ============================================================ */
(function () {
  'use strict';

  const CSRF = window.CSRF_TOKEN || '';
  const API = {
    SESSIONS: '/api/sessions',
    SETTINGS: '/api/settings',
    STATS: '/api/admin/stats',
    AUDIT: '/api/admin/audit-log',
    CSV_UPLOAD: '/api/upload_csv',
    CSV_EXPORT: '/api/sessions/export/csv',
    UPLOAD_PAPER: '/api/upload_paper',
    DB_BACKUP: '/api/admin/export-db-backup',
    BULK_DELETE: '/api/sessions/bulk-delete',
    BULK_STATUS: '/api/sessions/bulk-status',
    WIPE_ALL: '/api/sessions/wipe-all',
    RESET_LOGO: '/api/settings/reset-logo',
    RESET_BANNER: '/api/settings/reset-banner',
    RESET_CUSTOM_BG: '/api/settings/reset-custom-bg',
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  let allSessions = [];
  let selectedIds = new Set();
  let sortColumn = 'day';
  let sortDir = 'asc';
  let editingSessionId = null;

  // ─── INIT ────────────────────────────────────────────────
  function init() {
    const page = detectPage();
    bindCommonEvents();

    if (page === 'dashboard')     initDashboard();
    else if (page === 'sessions') initSessions();
    else if (page === 'settings') initSettings();
    else if (page === 'import')   initImportExport();
    else if (page === 'audit')    initAuditLog();
  }

  function detectPage() {
    const path = window.location.pathname;
    if (path.includes('dashboard'))     return 'dashboard';
    if (path.includes('sessions'))      return 'sessions';
    if (path.includes('settings'))      return 'settings';
    if (path.includes('import-export')) return 'import';
    if (path.includes('audit-log'))     return 'audit';
    return 'dashboard';
  }

  // ─── COMMON ──────────────────────────────────────────────
  function bindCommonEvents() {
    // Sidebar toggle
    const sidebarToggle = $('#sidebarToggle');
    const sidebar = $('#adminSidebar');
    const sidebarClose = $('#sidebarClose');

    if (sidebarToggle && sidebar) {
      sidebarToggle.addEventListener('click', () => sidebar.classList.add('show'));
    }
    if (sidebarClose && sidebar) {
      sidebarClose.addEventListener('click', () => sidebar.classList.remove('show'));
    }

    // Close sidebar on backdrop click
    document.addEventListener('click', (e) => {
      if (sidebar && sidebar.classList.contains('show') && !sidebar.contains(e.target) && e.target !== sidebarToggle) {
        sidebar.classList.remove('show');
      }
    });
  }

  // ─── API HELPER ──────────────────────────────────────────
  async function apiFetch(url, options) {
    options = options || {};
    options.headers = options.headers || {};

    if (!(options.body instanceof FormData)) {
      options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';
    }
    options.headers['X-CSRF-Token'] = CSRF;
    options.credentials = 'same-origin';

    try {
      const res = await fetch(url, options);

      if (res.status === 401 || res.status === 403) {
        showToast('Session expired. Redirecting to login...', 'warning');
        setTimeout(() => { window.location.href = '/login'; }, 1500);
        return null;
      }

      const data = await res.json();

      if (!res.ok) {
        const err = new Error(data.message || 'Request failed');
        err.data = data;
        err.errors = data.errors || null;
        throw err;
      }

      return data;
    } catch (err) {
      if (err.errors) {
        const detailStr = Object.values(err.errors).join('; ');
        showToast('Validation failed: ' + detailStr, 'error');
      } else {
        showToast(err.message || 'Network error', 'error');
      }
      throw err;
    }
  }

  // ─── DASHBOARD ───────────────────────────────────────────
  async function initDashboard() {
    await loadDashboardStats();
    await loadDashboardAnnouncement();
    await loadRecentActivity();
    bindDashboardEvents();

    // Auto open add session from URL
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'add') {
      window.location.href = '/admin/sessions?action=add';
    }
  }

  async function loadDashboardStats() {
    const data = await apiFetch(API.STATS);
    if (!data) return;

    const totalEl = $('#statTotalSessions');
    const todayEl = $('#statSessionsToday');
    const cancelledEl = $('#statCancelled');
    const presentersEl = $('#statPresenters');

    if (totalEl) totalEl.textContent = data.total_sessions || 0;
    if (cancelledEl) cancelledEl.textContent = data.cancelled_sessions || 0;
    if (presentersEl) presentersEl.textContent = data.total_presenters || 0;

    // Most active day
    if (todayEl && data.by_day) {
      const entries = Object.entries(data.by_day);
      if (entries.length > 0) {
        const max = entries.reduce((a, b) => parseInt(b[1]) > parseInt(a[1]) ? b : a);
        todayEl.textContent = 'Day ' + max[0] + ' (' + max[1] + ')';
      } else {
        todayEl.textContent = '—';
      }
    }
  }

  async function loadDashboardAnnouncement() {
    const data = await apiFetch('/api/settings');
    if (!data) return;

    const announcementInput = $('#dashAnnouncement');
    const typeSelect = $('#dashAnnouncementType');
    if (announcementInput) announcementInput.value = data.announcement || '';
    if (typeSelect) typeSelect.value = data.announcement_type || 'info';
  }

  async function loadRecentActivity() {
    const data = await apiFetch(API.AUDIT + '?per_page=10');
    if (!data || !data.logs) return;

    const feed = $('#activityFeed');
    if (!feed) return;

    if (data.logs.length === 0) {
      feed.innerHTML = '<div class="empty-state"><i class="bx bx-history"></i><p>No recent activity</p></div>';
      return;
    }

    feed.innerHTML = data.logs.map((log) => {
      const iconClass = getActivityIcon(log.action);
      const time = formatRelativeTime(log.timestamp);
      return '<div class="activity-item">' +
        '<div class="activity-icon ' + iconClass + '"><i class="bx bx-' + getActivityBxIcon(log.action) + '"></i></div>' +
        '<div class="activity-text"><strong>' + escapeHtml(log.username) + '</strong> ' + formatAction(log.action) + '</div>' +
        '<span class="activity-time">' + time + '</span></div>';
    }).join('');
  }

  function bindDashboardEvents() {
    const saveBtn = $('#saveAnnouncementBtn');
    const clearBtn = $('#clearAnnouncementBtn');

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const text = ($('#dashAnnouncement') || {}).value || '';
        const type = ($('#dashAnnouncementType') || {}).value || 'info';
        const data = await apiFetch(API.SETTINGS, {
          method: 'POST',
          body: JSON.stringify({ announcement: text, announcement_type: type }),
        });
        if (data) showToast('Announcement saved', 'success');
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        const data = await apiFetch(API.SETTINGS, {
          method: 'POST',
          body: JSON.stringify({ announcement: '', announcement_type: 'info' }),
        });
        if (data) {
          const input = $('#dashAnnouncement');
          if (input) input.value = '';
          showToast('Announcement cleared', 'success');
        }
      });
    }
  }

  // ─── SESSIONS ────────────────────────────────────────────
  async function initSessions() {
    await loadSessions();
    bindSessionEvents();

    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'add') {
      openSessionModal();
    }
  }

  async function loadSessions() {
    const data = await apiFetch(API.SESSIONS);
    if (!data) return;

    allSessions = data;
    populateFilterDropdowns();
    renderSessionTable();
  }

  function populateFilterDropdowns() {
    const dayFilter = $('#filterDay');
    if (dayFilter) {
      const days = new Set(allSessions.map((s) => s.day));
      const current = dayFilter.value;
      dayFilter.innerHTML = '<option value="all">All Days</option>';
      Array.from(days).sort((a, b) => a - b).forEach((d) => {
        dayFilter.innerHTML += '<option value="' + d + '">Day ' + d + '</option>';
      });
      dayFilter.value = current || 'all';
    }
  }

  function getFilteredAdminSessions() {
    let filtered = [...allSessions];

    const dayFilter = ($('#filterDay') || {}).value || 'all';
    const typeFilter = ($('#filterType') || {}).value || 'all';
    const statusFilter = ($('#filterStatus') || {}).value || 'all';
    const search = (($('#tableSearch') || {}).value || '').toLowerCase().trim();

    if (dayFilter !== 'all') filtered = filtered.filter((s) => s.day === parseInt(dayFilter));
    if (typeFilter !== 'all') filtered = filtered.filter((s) => s.type === typeFilter);
    if (statusFilter !== 'all') filtered = filtered.filter((s) => (s.status || '') === statusFilter);
    if (search) {
      filtered = filtered.filter((s) =>
        (s.title || '').toLowerCase().includes(search) ||
        (s.presenter || '').toLowerCase().includes(search)
      );
    }

    // Sort
    filtered.sort((a, b) => {
      let va = a[sortColumn] || '';
      let vb = b[sortColumn] || '';
      if (sortColumn === 'day' || sortColumn === 'display_order') {
        va = parseInt(va) || 0;
        vb = parseInt(vb) || 0;
      }
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }

  function renderSessionTable() {
    const tbody = $('#sessionsTableBody');
    const empty = $('#tableEmptyState');
    const countEl = $('#sessionCount');
    if (!tbody) return;

    const filtered = getFilteredAdminSessions();

    if (countEl) {
      countEl.textContent = 'Showing ' + filtered.length + ' of ' + allSessions.length + ' sessions';
    }

    if (filtered.length === 0) {
      tbody.innerHTML = '';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';

    tbody.innerHTML = filtered.map((s) => {
      const isSelected = selectedIds.has(s.id);
      const typeBadge = '<span class="badge badge-' + (s.type || 'general') + '">' + (s.type || 'general') + '</span>';
      const statusBadge = s.status
        ? '<span class="badge badge-' + s.status + '">' + s.status + '</span>'
        : '<span class="badge badge-active">active</span>';

      return '<tr class="' + (isSelected ? 'selected' : '') + '" data-id="' + s.id + '">' +
        '<td><input type="checkbox" class="row-check" data-id="' + s.id + '" ' + (isSelected ? 'checked' : '') + ' aria-label="Select session"></td>' +
        '<td>' + s.day + '</td>' +
        '<td>' + (s.start_time || '') + (s.end_time ? '–' + s.end_time : '') + '</td>' +
        '<td><strong>' + escapeHtml(truncate(s.title, 50)) + '</strong></td>' +
        '<td>' + escapeHtml(s.presenter || '—') + '</td>' +
        '<td>' + escapeHtml(s.location || '—') + '</td>' +
        '<td>' + escapeHtml(s.track || '—') + '</td>' +
        '<td>' + typeBadge + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td class="th-actions"><div class="table-actions">' +
        '<button class="btn btn-icon edit-btn" data-id="' + s.id + '" aria-label="Edit session"><i class="bx bx-edit"></i></button>' +
        '<button class="btn btn-icon delete-btn" data-id="' + s.id + '" data-title="' + escapeHtml(s.title) + '" aria-label="Delete session"><i class="bx bx-trash"></i></button>' +
        '</div></td></tr>';
    }).join('');

    updateBulkActions();
  }

  function bindSessionEvents() {
    // Filters
    ['#filterDay', '#filterType', '#filterStatus'].forEach((sel) => {
      const el = $(sel);
      if (el) el.addEventListener('change', () => renderSessionTable());
    });

    const search = $('#tableSearch');
    if (search) {
      search.addEventListener('input', debounce(() => renderSessionTable(), 300));
    }

    // Sort headers
    $$('.th-sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (sortColumn === col) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortColumn = col;
          sortDir = 'asc';
        }
        $$('.th-sortable').forEach((t) => t.classList.remove('sort-asc', 'sort-desc'));
        th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
        renderSessionTable();
      });
    });

    // Select all
    const selectAll = $('#selectAll');
    if (selectAll) {
      selectAll.addEventListener('change', () => {
        const checked = selectAll.checked;
        const filtered = getFilteredAdminSessions();
        if (checked) {
          filtered.forEach((s) => selectedIds.add(s.id));
        } else {
          selectedIds.clear();
        }
        renderSessionTable();
      });
    }

    // Row-level events (delegation)
    const tbody = $('#sessionsTableBody');
    if (tbody) {
      tbody.addEventListener('change', (e) => {
        const checkbox = e.target.closest('.row-check');
        if (checkbox) {
          const id = parseInt(checkbox.dataset.id);
          if (checkbox.checked) selectedIds.add(id);
          else selectedIds.delete(id);
          updateBulkActions();
          checkbox.closest('tr').classList.toggle('selected', checkbox.checked);
        }
      });

      tbody.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.edit-btn');
        if (editBtn) {
          openSessionModal(parseInt(editBtn.dataset.id));
          return;
        }

        const deleteBtn = e.target.closest('.delete-btn');
        if (deleteBtn) {
          const id = parseInt(deleteBtn.dataset.id);
          const title = deleteBtn.dataset.title;
          showConfirmModal('Delete Session', 'Are you sure you want to delete "' + title + '"?', 'Delete', async () => {
            const res = await apiFetch(API.SESSIONS + '/' + id, { method: 'DELETE' });
            if (res) {
              showToast('Session deleted', 'success');
              await loadSessions();
            }
          });
        }
      });
    }

    // Add session buttons
    ['#addSessionBtn', '#addSessionBtnMobile', '#emptyAddSessionBtn'].forEach((sel) => {
      const btn = $(sel);
      if (btn) btn.addEventListener('click', () => openSessionModal());
    });

    // Panel close
    const panelClose = $('#sessionPanelClose');
    const panelCancel = $('#sessionCancelBtn');
    if (panelClose) panelClose.addEventListener('click', closeSessionModal);
    if (panelCancel) panelCancel.addEventListener('click', closeSessionModal);

    const panelBackdrop = $('#sessionPanelBackdrop');
    if (panelBackdrop) panelBackdrop.addEventListener('click', closeSessionModal);

    // Save session
    const saveBtn = $('#sessionSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveSession);

    // Type → show/hide menu details
    const typeSelect = $('#sessionType');
    if (typeSelect) {
      typeSelect.addEventListener('change', () => {
        const menuGroup = $('#menuDetailsGroup');
        if (menuGroup) menuGroup.style.display = typeSelect.value === 'break' ? '' : 'none';
      });
    }

    // Status → show/hide moved_to
    const statusSelect = $('#sessionStatus');
    if (statusSelect) {
      statusSelect.addEventListener('change', () => {
        const movedGroup = $('#movedToGroup');
        if (movedGroup) movedGroup.style.display = statusSelect.value === 'moved' ? '' : 'none';
      });
    }

    // Description char count
    const desc = $('#sessionDescription');
    const charCount = $('#descCharCount');
    if (desc && charCount) {
      desc.addEventListener('input', () => { charCount.textContent = desc.value.length; });
    }

    // Paper File Upload Handling
    const paperUploadBtn = $('#sessionPaperUploadBtn');
    const paperFileInput = $('#sessionPaperFileInput');
    const paperFileIndicator = $('#paperFileIndicator');
    const paperClearBtn = $('#sessionPaperClearBtn');
    const paperUrlInput = $('#sessionPaperUrl');

    if (paperUploadBtn && paperFileInput) {
      paperUploadBtn.addEventListener('click', () => {
        paperFileInput.click();
      });

      paperFileInput.addEventListener('change', async () => {
        const file = paperFileInput.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);
        formData.append('csrf_token', CSRF);

        paperUploadBtn.disabled = true;
        paperUploadBtn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Uploading...';

        try {
          const res = await apiFetch(API.UPLOAD_PAPER, {
            method: 'POST',
            body: formData,
          });

          if (res && res.status === 'success') {
            if (paperUrlInput) paperUrlInput.value = res.url;
            if (paperFileIndicator) {
              paperFileIndicator.innerHTML = '<i class="bx bxs-file-pdf"></i> ' + escapeHtml(res.filename) + ' <span class="badge badge-success" style="margin-left:4px;font-size:0.75rem;">Uploaded</span>';
              paperFileIndicator.style.display = 'inline-flex';
            }
            if (paperClearBtn) paperClearBtn.style.display = 'inline-flex';
            showToast('Paper uploaded successfully!', 'success');
          }
        } catch (err) {
          showToast(err.message || 'Failed to upload paper file', 'error');
        } finally {
          paperUploadBtn.disabled = false;
          paperUploadBtn.innerHTML = '<i class="bx bx-cloud-upload"></i> Upload Paper File (PDF, DOCX, PPTX)';
        }
      });
    }

    if (paperClearBtn) {
      paperClearBtn.addEventListener('click', () => {
        if (paperUrlInput) paperUrlInput.value = '';
        if (paperFileInput) paperFileInput.value = '';
        if (paperFileIndicator) {
          paperFileIndicator.textContent = '';
          paperFileIndicator.style.display = 'none';
        }
        paperClearBtn.style.display = 'none';
        showToast('Paper attachment cleared', 'info');
      });
    }

    // Bulk actions
    const bulkDeleteBtn = $('#bulkDeleteBtn');
    if (bulkDeleteBtn) {
      bulkDeleteBtn.addEventListener('click', () => {
        const count = selectedIds.size;
        showConfirmModal('Delete ' + count + ' Sessions', 'Are you sure you want to delete ' + count + ' selected sessions?', 'Delete All', async () => {
          const res = await apiFetch(API.BULK_DELETE, {
            method: 'POST',
            body: JSON.stringify({ ids: Array.from(selectedIds) }),
          });
          if (res) {
            selectedIds.clear();
            showToast(res.deleted + ' sessions deleted', 'success');
            await loadSessions();
          }
        });
      });
    }

    const bulkStatusBtn = $('#bulkStatusBtn');
    const bulkStatusSelect = $('#bulkStatusSelect');
    if (bulkStatusBtn && bulkStatusSelect) {
      bulkStatusBtn.addEventListener('click', () => {
        bulkStatusSelect.style.display = bulkStatusSelect.style.display === 'none' ? '' : 'none';
      });
      bulkStatusSelect.addEventListener('change', async () => {
        const newStatus = bulkStatusSelect.value;
        const res = await apiFetch(API.BULK_STATUS, {
          method: 'POST',
          body: JSON.stringify({ ids: Array.from(selectedIds), status: newStatus }),
        });
        if (res) {
          selectedIds.clear();
          bulkStatusSelect.style.display = 'none';
          showToast(res.updated + ' sessions updated', 'success');
          await loadSessions();
        }
      });
    }

    // Escape to close panel
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSessionModal();
    });
  }

  function openSessionModal(id) {
    const panel = $('#sessionPanel');
    const backdrop = $('#sessionPanelBackdrop');
    const title = $('#sessionPanelTitle');
    const form = $('#sessionForm');

    if (!panel || !form) return;

    editingSessionId = id || null;
    if (title) title.textContent = id ? 'Edit Session' : 'Add Session';

    // Reset form
    form.reset();
    $$('.form-error').forEach((el) => { el.textContent = ''; el.classList.remove('show'); });
    $$('.form-input.error, .form-select.error, .form-textarea.error').forEach((el) => el.classList.remove('error'));
    $('#menuDetailsGroup').style.display = 'none';
    $('#movedToGroup').style.display = 'none';
    $('#sessionId').value = '';
    $('#descCharCount').textContent = '0';

    const paperFileIndicator = $('#paperFileIndicator');
    const paperClearBtn = $('#sessionPaperClearBtn');
    const paperFileInput = $('#sessionPaperFileInput');
    if (paperFileInput) paperFileInput.value = '';
    if (paperFileIndicator) { paperFileIndicator.textContent = ''; paperFileIndicator.style.display = 'none'; }
    if (paperClearBtn) paperClearBtn.style.display = 'none';

    // Populate suggestions
    populateDatalist('#locationSuggestions', allSessions.map((s) => s.location).filter(Boolean));
    populateDatalist('#trackSuggestions', allSessions.map((s) => s.track).filter(Boolean));

    // Pre-fill if editing
    if (id) {
      const session = allSessions.find((s) => s.id === id);
      if (session) {
        $('#sessionId').value = session.id;
        $('#sessionDay').value = session.day;
        $('#sessionType').value = session.type || 'session';
        $('#sessionStartTime').value = session.start_time || '';
        $('#sessionEndTime').value = session.end_time || '';
        $('#sessionTitle').value = session.title || '';
        $('#sessionPresenter').value = session.presenter || '';
        $('#sessionAffiliation').value = session.affiliation || '';
        $('#sessionBio').value = session.bio || '';
        $('#sessionLocation').value = session.location || '';
        $('#sessionTrack').value = session.track || '';
        $('#sessionDescription').value = session.description || '';
        $('#sessionMenuDetails').value = session.menu_details || '';
        $('#sessionMeetingUrl').value = session.meeting_url || '';
        $('#sessionPaperUrl').value = session.paper_url || '';
        $('#sessionEvalUrl').value = session.evaluation_url || '';
        $('#sessionStatus').value = session.status || '';
        $('#sessionMovedTo').value = session.moved_to || '';
        $('#sessionDisplayOrder').value = session.display_order || 0;
        $('#descCharCount').textContent = (session.description || '').length;

        if (session.paper_url && session.paper_url.includes('/static/uploads/paper_')) {
          const fileNameOnly = session.paper_url.split('/').pop().replace(/^paper_\d+_/, '');
          if (paperFileIndicator) {
            paperFileIndicator.innerHTML = '<i class="bx bxs-file-pdf text-primary"></i> Attached: <strong>' + escapeHtml(fileNameOnly) + '</strong>';
            paperFileIndicator.style.display = 'inline-flex';
          }
          if (paperClearBtn) paperClearBtn.style.display = 'inline-flex';
        }

        if (session.type === 'break') $('#menuDetailsGroup').style.display = '';
        if (session.status === 'moved') $('#movedToGroup').style.display = '';
      }
    }

    // Show panel
    panel.style.display = '';
    backdrop.style.display = '';
    requestAnimationFrame(() => {
      panel.classList.add('show');
      backdrop.classList.add('show');
      $('#sessionDay').focus();
    });
  }

  function closeSessionModal() {
    const panel = $('#sessionPanel');
    const backdrop = $('#sessionPanelBackdrop');
    if (panel) {
      panel.classList.remove('show');
      backdrop.classList.remove('show');
      setTimeout(() => {
        panel.style.display = 'none';
        backdrop.style.display = 'none';
      }, 300);
    }
    editingSessionId = null;
  }

  async function saveSession() {
    // Clear errors
    $$('.form-error').forEach((el) => { el.textContent = ''; el.classList.remove('show'); });
    $$('.form-input.error').forEach((el) => el.classList.remove('error'));

    const data = {
      day: parseInt($('#sessionDay').value),
      type: $('#sessionType').value,
      start_time: $('#sessionStartTime').value,
      end_time: $('#sessionEndTime').value || '',
      title: $('#sessionTitle').value.trim(),
      presenter: $('#sessionPresenter').value.trim(),
      affiliation: $('#sessionAffiliation').value.trim(),
      bio: $('#sessionBio').value.trim(),
      location: $('#sessionLocation').value.trim(),
      track: $('#sessionTrack').value.trim(),
      description: $('#sessionDescription').value.trim(),
      menu_details: $('#sessionMenuDetails').value.trim(),
      meeting_url: $('#sessionMeetingUrl').value.trim(),
      paper_url: $('#sessionPaperUrl').value.trim(),
      evaluation_url: $('#sessionEvalUrl').value.trim(),
      status: $('#sessionStatus').value,
      moved_to: $('#sessionMovedTo').value.trim(),
      display_order: parseInt($('#sessionDisplayOrder').value) || 0,
    };

    // Client-side validation
    let hasErrors = false;
    if (!data.day || data.day < 1) { showFieldError('sessionDay', 'Day is required'); hasErrors = true; }
    if (!data.start_time) { showFieldError('sessionStartTime', 'Start time is required'); hasErrors = true; }
    if (!data.title) { showFieldError('sessionTitle', 'Title is required'); hasErrors = true; }
    const id = editingSessionId;
    const url = id ? API.SESSIONS + '/' + id : API.SESSIONS;
    const method = id ? 'PUT' : 'POST';

    try {
      const res = await apiFetch(url, { method, body: JSON.stringify(data) });
      if (res) {
        showToast(id ? 'Session updated successfully' : 'Session created successfully', 'success');
        closeSessionModal();
        await loadSessions();
      }
    } catch (err) {
      if (err.errors) {
        Object.keys(err.errors).forEach((field) => {
          const fieldMap = {
            day: 'sessionDay',
            start_time: 'sessionStartTime',
            end_time: 'sessionEndTime',
            title: 'sessionTitle',
            type: 'sessionType',
            status: 'sessionStatus',
            meeting_url: 'sessionMeetingUrl',
            paper_url: 'sessionPaperUrl',
            evaluation_url: 'sessionEvalUrl',
          };
          const elementId = fieldMap[field] || ('session' + field.charAt(0).toUpperCase() + field.slice(1));
          showFieldError(elementId, err.errors[field]);
        });
      }
    }
  }

  function showFieldError(fieldId, message) {
    const input = $('#' + fieldId);
    const error = $('#' + fieldId + 'Error');
    if (input) input.classList.add('error');
    if (error) { error.textContent = message; error.classList.add('show'); }
  }

  function updateBulkActions() {
    const bulk = $('#bulkActions');
    const count = $('#selectedCount');
    if (bulk) bulk.style.display = selectedIds.size > 0 ? '' : 'none';
    if (count) count.textContent = selectedIds.size;
  }

  function populateDatalist(selector, values) {
    const dl = $(selector);
    if (!dl) return;
    const unique = [...new Set(values)].sort();
    dl.innerHTML = unique.map((v) => '<option value="' + escapeHtml(v) + '">').join('');
  }

  // ─── SETTINGS ────────────────────────────────────────────
  function initSettings() {
    bindSettingsTabs();
    bindSettingsEvents();
  }

  function bindSettingsTabs() {
    $$('.settings-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;

        $$('.settings-tab').forEach((t) => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');

        $$('.settings-panel').forEach((p) => p.style.display = 'none');
        const panel = $('#tab-' + target);
        if (panel) panel.style.display = '';
      });
    });
  }

  function bindSettingsEvents() {
    // General save
    const saveGeneral = $('#saveGeneralBtn');
    if (saveGeneral) {
      saveGeneral.addEventListener('click', async () => {
        const data = {
          event_title: ($('#settingEventTitle') || {}).value || '',
          event_subtitle: ($('#settingEventSubtitle') || {}).value || '',
          event_description: ($('#settingEventDescription') || {}).value || '',
          event_start_date: ($('#settingStartDate') || {}).value || '',
          event_days: ($('#settingDays') || {}).value || '4',
          show_track_filter: ($('#settingShowTrack') || {}).checked ? 'true' : 'false',
          show_evaluation_links: ($('#settingShowEval') || {}).checked ? 'true' : 'false',
          show_calendar_links: ($('#settingShowCalendar') || {}).checked ? 'true' : 'false',
          footer_text: ($('#settingFooterText') || {}).value || '',
          show_top_banner: ($('#settingShowTopBanner') || {}).checked ? 'true' : 'false',
          show_footer_banner: ($('#settingShowFooterBanner') || {}).checked ? 'true' : 'false',
        };
        const res = await apiFetch(API.SETTINGS, { method: 'POST', body: JSON.stringify(data) });
        if (res) showToast('General settings saved', 'success');
      });
    }

    // Appearance save
    const saveAppearance = $('#saveAppearanceBtn');
    if (saveAppearance) {
      saveAppearance.addEventListener('click', async () => {
        const formData = new FormData();

        // Theme
        const selectedTheme = document.querySelector('input[name="theme"]:checked');
        if (selectedTheme) formData.append('theme', selectedTheme.value);

        // Layout
        const selectedLayout = document.querySelector('input[name="layout"]:checked');
        if (selectedLayout) formData.append('layout', selectedLayout.value);

        // UI Style
        const selectedStyle = document.querySelector('input[name="ui_style"]:checked');
        if (selectedStyle) formData.append('ui_style', selectedStyle.value);

        // Branding
        const brandTitleColor = $('#settingBrandTitleColor');
        if (brandTitleColor) formData.append('brand_title_color', brandTitleColor.value);
        const brandHeadingFont = $('#settingBrandHeadingFont');
        if (brandHeadingFont) formData.append('brand_heading_font', brandHeadingFont.value);
        const brandBodyFont = $('#settingBrandBodyFont');
        if (brandBodyFont) formData.append('brand_body_font', brandBodyFont.value);

        // Custom theme colours
        const ctbFields = [
          ['ctbPrimary', 'custom_primary'], ['ctbAccent', 'custom_accent'],
          ['ctbBg', 'custom_bg'], ['ctbSurface', 'custom_surface'],
          ['ctbText', 'custom_text'], ['ctbHeader', 'custom_header_bg'],
        ];
        ctbFields.forEach(([id, key]) => {
          const el = $('#' + id);
          if (el) formData.append(key, el.value);
        });
        const ctbHeading = $('#ctbHeadingFont');
        if (ctbHeading) formData.append('custom_heading_font', ctbHeading.value);
        const ctbBody = $('#ctbBodyFont');
        if (ctbBody) formData.append('custom_body_font', ctbBody.value);

        // Custom background image
        const customBgInput = $('#settingCustomBg');
        if (customBgInput && customBgInput.files.length > 0) {
          formData.append('custom_bg', customBgInput.files[0]);
        }

        // Logo
        const logoInput = $('#settingLogo');
        if (logoInput && logoInput.files.length > 0) {
          formData.append('logo', logoInput.files[0]);
        }

        // Banner
        const bannerInput = $('#settingBanner');
        if (bannerInput && bannerInput.files.length > 0) {
          formData.append('banner', bannerInput.files[0]);
        }

        const res = await apiFetch(API.SETTINGS, {
          method: 'POST',
          body: formData,
          headers: { 'X-CSRF-Token': CSRF },
        });
        if (res) {
          showToast('Appearance settings saved', 'success');
          // Apply theme immediately
          if (selectedTheme) document.body.className = selectedTheme.value;
        }
      });
    }

    // ─── Custom Theme Builder ─────────────────────────────────────────────
    function updateCtbPreview() {
      const preview = $('#ctbMiniPreview');
      const header  = $('#ctbMpHeader');
      const body    = $('#ctbMpBody');
      const card1   = $('#ctbMpCard1');
      const card2   = $('#ctbMpCard2');
      if (!preview) return;

      const primary  = ($('#ctbPrimary')  || {}).value || '#6366f1';
      const accent   = ($('#ctbAccent')   || {}).value || '#8b5cf6';
      const bg       = ($('#ctbBg')       || {}).value || '#0f0f1a';
      const surface  = ($('#ctbSurface')  || {}).value || '#1a1a2e';
      const textCol  = ($('#ctbText')     || {}).value || '#e2e2ff';
      const headerBg = ($('#ctbHeader')   || {}).value || '#0f0f1a';

      preview.style.background = bg;
      if (header) { header.style.background = headerBg; header.style.color = textCol; }
      if (body)   body.style.background = bg;
      if (card1)  { card1.style.background = surface; card1.style.borderColor = primary + '55'; }
      if (card2)  { card2.style.background = surface; card2.style.borderColor = accent + '55'; }
    }

    // Colour picker sync — update hex text labels and live preview
    const ctbMappings = [
      ['ctbPrimary',  'ctbPrimaryVal'],
      ['ctbAccent',   'ctbAccentVal'],
      ['ctbBg',       'ctbBgVal'],
      ['ctbSurface',  'ctbSurfaceVal'],
      ['ctbText',     'ctbTextVal'],
      ['ctbHeader',   'ctbHeaderVal'],
    ];
    ctbMappings.forEach(([inputId, labelId]) => {
      const input = $('#' + inputId);
      const label = $('#' + labelId);
      if (input && label) {
        input.addEventListener('input', () => {
          label.textContent = input.value.toUpperCase();
          updateCtbPreview();
        });
      }
    });

    // Branding colour sync
    const brandTitleEl = $('#settingBrandTitleColor');
    const brandTitleVal = $('#brandTitleColorVal');
    if (brandTitleEl && brandTitleVal) {
      brandTitleEl.addEventListener('input', () => {
        brandTitleVal.textContent = brandTitleEl.value.toUpperCase();
      });
    }

    updateCtbPreview();

    // Show/hide custom theme builder panel based on selected theme
    const allThemeRadios = document.querySelectorAll('input[name="theme"]');
    const ctbPanel = $('#customThemeBuilderPanel');
    allThemeRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        if (ctbPanel) {
          ctbPanel.style.display = radio.value === 'theme-custom' && radio.checked ? '' : 'none';
        }
      });
    });

    // Custom BG image preview
    const customBgInputEl = $('#settingCustomBg');
    if (customBgInputEl) {
      customBgInputEl.addEventListener('change', () => {
        if (customBgInputEl.files.length > 0) {
          const reader = new FileReader();
          reader.onload = (e) => {
            const preview = $('#customBgPreview');
            if (preview) preview.innerHTML = '<img src="' + e.target.result + '" alt="Preview">';
          };
          reader.readAsDataURL(customBgInputEl.files[0]);
        }
      });
    }
    const resetCustomBg = $('#resetCustomBgBtn');
    if (resetCustomBg) {
      resetCustomBg.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const res = await apiFetch(API.RESET_CUSTOM_BG, { method: 'POST' });
        if (res) {
          showToast('Background image removed', 'success');
          const preview = $('#customBgPreview');
          if (preview) preview.innerHTML = '<i class="bx bx-image-add"></i><span>Drop image or click to upload</span>';
          if (customBgInputEl) customBgInputEl.value = '';
        }
      });
    }

    // Reset logo/banner
    const resetLogo = $('#resetLogoBtn');
    if (resetLogo) {
      resetLogo.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const res = await apiFetch(API.RESET_LOGO, { method: 'POST' });
        if (res) {
          showToast('Logo reset', 'success');
          const preview = $('#logoPreview');
          if (preview) preview.innerHTML = '<i class="bx bx-image-add"></i><span>Drop image or click to upload</span>';
        }
      });
    }

    const resetBanner = $('#resetBannerBtn');
    if (resetBanner) {
      resetBanner.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const res = await apiFetch(API.RESET_BANNER, { method: 'POST' });
        if (res) {
          showToast('Banner reset', 'success');
          const preview = $('#bannerPreview');
          if (preview) preview.innerHTML = '<i class="bx bx-image-add"></i><span>Drop image or click to upload</span>';
        }
      });
    }

    // Image preview on select
    ['settingLogo', 'settingBanner'].forEach((id) => {
      const input = $('#' + id);
      if (input) {
        input.addEventListener('change', () => {
          if (input.files.length > 0) {
            const reader = new FileReader();
            reader.onload = (e) => {
              const previewId = id === 'settingLogo' ? 'logoPreview' : 'bannerPreview';
              const preview = $('#' + previewId);
              if (preview) preview.innerHTML = '<img src="' + e.target.result + '" alt="Preview">';
            };
            reader.readAsDataURL(input.files[0]);
          }
        });
      }
    });

    // Advanced save
    const saveAdvanced = $('#saveAdvancedBtn');
    if (saveAdvanced) {
      saveAdvanced.addEventListener('click', async () => {
        const data = {
          announcement: ($('#settingAnnouncement') || {}).value || '',
          announcement_type: ($('#settingAnnouncementType') || {}).value || 'info',
          push_enabled: ($('#settingPushEnabled') || {}).checked ? 'true' : 'false',
          google_analytics_id: ($('#settingGoogleAnalytics') || {}).value || '',
        };
        const res = await apiFetch(API.SETTINGS, { method: 'POST', body: JSON.stringify(data) });
        if (res) showToast('Advanced settings saved', 'success');
      });
    }

    const clearAdv = $('#clearAdvAnnouncementBtn');
    if (clearAdv) {
      clearAdv.addEventListener('click', () => {
        const input = $('#settingAnnouncement');
        if (input) input.value = '';
      });
    }

    // ─── Push Notifications Admin ─────────────────────────────────────────
    // Load subscriber stats
    const subCount = $('#pushSubscriberCount');
    const sentCount = $('#pushSentCount');
    if (subCount) {
      fetch('/api/push/stats', { credentials: 'include' })
        .then(r => r.json())
        .then(d => {
          if (subCount)  subCount.textContent  = d.subscribers  ?? '—';
          if (sentCount) sentCount.textContent = d.sent_total   ?? '—';
          const info = $('#pushRecipientInfo');
          if (info) info.textContent = `${d.subscribers ?? 0} subscriber(s) will receive this notification.`;
        })
        .catch(() => {});
    }

    // Send push modal
    const sendPushBtn    = $('#sendPushBtn');
    const pushModal      = $('#pushModal');
    const pushBackdrop   = $('#pushModalBackdrop');
    const pushClose      = $('#pushModalClose');
    const pushCancel     = $('#pushModalCancel');
    const pushSend       = $('#pushModalSend');
    const pushTitleInput = $('#pushTitle');
    const pushMsgInput   = $('#pushMessage');
    const pushTitleCount = $('#pushTitleCount');
    const pushMsgCount   = $('#pushMsgCount');

    function openPushModal() {
      if (pushModal) { pushModal.style.display = ''; pushModal.style.opacity = '1'; pushModal.style.transform = 'translate(-50%,-50%) scale(1)'; }
      if (pushBackdrop) pushBackdrop.style.display = '';
      if (pushTitleInput) { pushTitleInput.value = ''; pushTitleCount && (pushTitleCount.textContent = '0'); }
      if (pushMsgInput)   { pushMsgInput.value   = ''; pushMsgCount   && (pushMsgCount.textContent   = '0'); }
    }
    function closePushModal() {
      if (pushModal)   { pushModal.style.display = 'none'; }
      if (pushBackdrop) pushBackdrop.style.display = 'none';
    }

    if (sendPushBtn) sendPushBtn.addEventListener('click', openPushModal);
    if (pushClose)   pushClose.addEventListener('click', closePushModal);
    if (pushCancel)  pushCancel.addEventListener('click', closePushModal);
    if (pushBackdrop) pushBackdrop.addEventListener('click', closePushModal);

    // Char counters
    if (pushTitleInput && pushTitleCount) {
      pushTitleInput.addEventListener('input', () => { pushTitleCount.textContent = pushTitleInput.value.length; });
    }
    if (pushMsgInput && pushMsgCount) {
      pushMsgInput.addEventListener('input', () => { pushMsgCount.textContent = pushMsgInput.value.length; });
    }

    if (pushSend) {
      pushSend.addEventListener('click', async () => {
        const title   = (pushTitleInput || {}).value || '';
        const message = (pushMsgInput   || {}).value || '';
        if (!title || !message) {
          showToast('Please enter both a title and message', 'error');
          return;
        }
        pushSend.disabled = true;
        pushSend.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Sending...';
        const res = await apiFetch('/api/push/send', {
          method: 'POST',
          body: JSON.stringify({ title, message }),
        });
        pushSend.disabled = false;
        pushSend.innerHTML = '<i class="bx bx-send"></i> Send to All Subscribers';
        if (res) {
          showToast(`✅ ${res.message || 'Sent!'}`, 'success');
          closePushModal();
          // Refresh stats
          if (subCount) {
            fetch('/api/push/stats', { credentials: 'include' })
              .then(r => r.json())
              .then(d => { if (sentCount) sentCount.textContent = d.sent_total ?? '—'; })
              .catch(() => {});
          }
        }
      });
    }

    // Change password
    const changePwdBtn = $('#changePasswordBtn');
    if (changePwdBtn) {
      changePwdBtn.addEventListener('click', () => {
        window.location.href = '/change-password';
      });
    }
  }

  // ─── IMPORT/EXPORT ───────────────────────────────────────
  function initImportExport() {
    const modeRadios = document.querySelectorAll('input[name="importMode"]');
    const replaceConfirm = $('#replaceConfirm');
    const csvInput = $('#csvFileInput');
    const uploadBtn = $('#uploadCsvBtn');
    const fileNameEl = $('#csvFileName');
    const uploadZone = $('#csvUploadZone');

    // Mode toggle
    modeRadios.forEach((r) => {
      r.addEventListener('change', () => {
        if (replaceConfirm) {
          replaceConfirm.style.display = r.value === 'replace' && r.checked ? '' : 'none';
        }
        updateUploadBtnState();
      });
    });

    // File selection
    if (csvInput) {
      csvInput.addEventListener('change', () => {
        if (csvInput.files.length > 0) {
          if (fileNameEl) fileNameEl.textContent = csvInput.files[0].name;
        } else {
          if (fileNameEl) fileNameEl.textContent = '';
        }
        updateUploadBtnState();
      });
    }

    // Drag and drop
    if (uploadZone) {
      ['dragenter', 'dragover'].forEach((evt) => {
        uploadZone.addEventListener(evt, (e) => {
          e.preventDefault();
          uploadZone.classList.add('dragover');
        });
      });
      ['dragleave', 'drop'].forEach((evt) => {
        uploadZone.addEventListener(evt, (e) => {
          e.preventDefault();
          uploadZone.classList.remove('dragover');
        });
      });
      uploadZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0 && csvInput) {
          csvInput.files = files;
          csvInput.dispatchEvent(new Event('change'));
        }
      });
    }

    // Replace confirm input
    const replaceInput = $('#replaceConfirmInput');
    if (replaceInput) {
      replaceInput.addEventListener('input', updateUploadBtnState);
    }

    function updateUploadBtnState() {
      if (!uploadBtn || !csvInput) return;
      const hasFile = csvInput.files.length > 0;
      const mode = document.querySelector('input[name="importMode"]:checked');
      const isReplace = mode && mode.value === 'replace';
      const confirmed = !isReplace || (replaceInput && replaceInput.value.trim().toUpperCase() === 'REPLACE');
      uploadBtn.disabled = !(hasFile && confirmed);
    }

    // Upload
    if (uploadBtn) {
      uploadBtn.addEventListener('click', async () => {
        if (!csvInput || csvInput.files.length === 0) return;

        const mode = document.querySelector('input[name="importMode"]:checked');
        const delimiterSelect = $('#csvDelimiterSelect');
        const formData = new FormData();
        formData.append('file', csvInput.files[0]);
        formData.append('mode', mode ? mode.value : 'merge');
        if (delimiterSelect) {
          formData.append('delimiter', delimiterSelect.value);
        }

        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Uploading...';

        const res = await apiFetch(API.CSV_UPLOAD, {
          method: 'POST',
          body: formData,
          headers: { 'X-CSRF-Token': CSRF },
        });

        uploadBtn.disabled = false;
        uploadBtn.innerHTML = '<i class="bx bx-upload"></i> Upload CSV';

        if (res && res.report) {
          showImportReport(res.report);
          showToast('CSV imported successfully', 'success');
          // Reset
          csvInput.value = '';
          if (fileNameEl) fileNameEl.textContent = '';
          if (replaceInput) replaceInput.value = '';
        }
      });
    }

    // Wipe all
    const wipeBtn = $('#wipeAllBtn');
    if (wipeBtn) {
      wipeBtn.addEventListener('click', () => {
        showConfirmModal(
          'Delete All Sessions',
          '<p>This will <strong>permanently delete ALL sessions</strong>. Type <strong>DELETE ALL</strong> to confirm:</p>' +
          '<input type="text" id="wipeModalInput" class="form-input" placeholder=\'Type "DELETE ALL"\'>',
          'Delete All',
          async () => {
            const input = document.getElementById('wipeModalInput');
            if (!input || input.value.trim().toUpperCase() !== 'DELETE ALL') {
              showToast('You must type "DELETE ALL" to confirm', 'warning');
              return;
            }
            const res = await apiFetch(API.WIPE_ALL, { method: 'POST' });
            if (res) showToast(res.deleted + ' sessions deleted', 'success');
          }
        );
      });
    }
  }

  function showImportReport(report) {
    const reportEl = $('#importReport');
    if (!reportEl) return;

    reportEl.style.display = '';
    $('#reportInserted').textContent = report.inserted || 0;
    $('#reportUpdated').textContent = report.updated || 0;
    $('#reportSkipped').textContent = report.skipped || 0;

    const skippedSection = $('#skippedRows');
    const skippedBody = $('#skippedRowsBody');
    if (report.skipped_rows && report.skipped_rows.length > 0 && skippedSection && skippedBody) {
      skippedSection.style.display = '';
      skippedBody.innerHTML = report.skipped_rows.map((r) =>
        '<tr><td>' + r.row + '</td><td>' + escapeHtml(r.reason) + '</td></tr>'
      ).join('');
    } else if (skippedSection) {
      skippedSection.style.display = 'none';
    }
  }

  // ─── AUDIT LOG ───────────────────────────────────────────
  let auditPage = 1;

  function initAuditLog() {
    loadAuditLog();
    bindAuditEvents();
  }

  async function loadAuditLog() {
    const data = await apiFetch(API.AUDIT + '?page=' + auditPage + '&per_page=20');
    if (!data) return;

    const tbody = $('#auditTableBody');
    const empty = $('#auditEmptyState');
    const pageInfo = $('#auditPageInfo');
    const prevBtn = $('#auditPrevBtn');
    const nextBtn = $('#auditNextBtn');

    if (!tbody) return;

    if (data.logs.length === 0) {
      tbody.innerHTML = '';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';

    tbody.innerHTML = data.logs.map((log) => {
      let detail = log.detail || '';
      try { detail = JSON.stringify(JSON.parse(detail), null, 2); } catch (e) { /* keep as is */ }
      const truncDetail = truncate(typeof detail === 'string' ? detail : JSON.stringify(detail), 80);

      return '<tr class="audit-row" data-detail="' + escapeHtml(detail) + '">' +
        '<td>' + formatDateTime(log.timestamp) + '</td>' +
        '<td>' + escapeHtml(log.username) + '</td>' +
        '<td><span class="badge badge-' + getAuditBadgeClass(log.action) + '">' + escapeHtml(log.action) + '</span></td>' +
        '<td>' + escapeHtml(truncDetail) + '</td></tr>';
    }).join('');

    if (pageInfo) pageInfo.textContent = 'Page ' + data.current_page + ' of ' + data.pages;
    if (prevBtn) prevBtn.disabled = data.current_page <= 1;
    if (nextBtn) nextBtn.disabled = data.current_page >= data.pages;
  }

  function bindAuditEvents() {
    const prevBtn = $('#auditPrevBtn');
    const nextBtn = $('#auditNextBtn');
    if (prevBtn) prevBtn.addEventListener('click', () => { auditPage--; loadAuditLog(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { auditPage++; loadAuditLog(); });

    // Click row to expand detail
    const tbody = $('#auditTableBody');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const row = e.target.closest('.audit-row');
        if (!row) return;

        const detail = row.dataset.detail;
        const panel = $('#auditDetailPanel');
        const backdrop = $('#auditDetailBackdrop');
        const json = $('#auditDetailJson');

        if (panel && json) {
          json.textContent = detail;
          panel.style.display = '';
          backdrop.style.display = '';
          requestAnimationFrame(() => {
            panel.classList.add('show');
            backdrop.classList.add('show');
          });
        }
      });
    }

    const detailClose = $('#auditDetailClose');
    const detailBackdrop = $('#auditDetailBackdrop');
    const closeDetail = () => {
      const panel = $('#auditDetailPanel');
      const backdrop = $('#auditDetailBackdrop');
      if (panel) {
        panel.classList.remove('show');
        backdrop.classList.remove('show');
        setTimeout(() => {
          panel.style.display = 'none';
          backdrop.style.display = 'none';
        }, 300);
      }
    };
    if (detailClose) detailClose.addEventListener('click', closeDetail);
    if (detailBackdrop) detailBackdrop.addEventListener('click', closeDetail);
  }

  // ─── CONFIRM MODAL ──────────────────────────────────────
  function showConfirmModal(title, message, actionText, onConfirm) {
    const modal = $('#adminConfirmModal');
    const backdrop = $('#adminConfirmBackdrop');
    const titleEl = $('#adminConfirmTitle');
    const bodyEl = $('#adminConfirmBody');
    const actionBtn = $('#adminConfirmAction');
    const cancelBtn = $('#adminConfirmCancel');
    const closeBtn = $('#adminConfirmClose');

    if (!modal) return;

    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.innerHTML = message;
    if (actionBtn) actionBtn.textContent = actionText;

    modal.style.display = '';
    backdrop.style.display = '';
    requestAnimationFrame(() => {
      modal.classList.add('show');
      backdrop.classList.add('show');
    });

    const close = () => {
      modal.classList.remove('show');
      backdrop.classList.remove('show');
      setTimeout(() => {
        modal.style.display = 'none';
        backdrop.style.display = 'none';
      }, 300);
      // Remove listeners
      actionBtn.removeEventListener('click', handleAction);
      cancelBtn.removeEventListener('click', close);
      closeBtn.removeEventListener('click', close);
    };

    const handleAction = () => {
      onConfirm();
      close();
    };

    actionBtn.addEventListener('click', handleAction);
    cancelBtn.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
  }

  // ─── TOAST ───────────────────────────────────────────────
  function showToast(message, type) {
    type = type || 'info';
    const container = $('#admin-toast-container') || $('#toast-container');
    if (!container) return;

    const icons = {
      success: 'bx-check-circle',
      error: 'bx-error-circle',
      warning: 'bx-error',
      info: 'bx-info-circle',
    };

    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.setAttribute('role', 'alert');
    toast.innerHTML =
      '<i class="bx ' + (icons[type] || icons.info) + '"></i>' +
      '<span class="toast-message">' + escapeHtml(message) + '</span>' +
      '<button class="toast-close" aria-label="Dismiss"><i class="bx bx-x"></i></button>';

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));

    const dismiss = () => {
      toast.classList.remove('show');
      toast.classList.add('hide');
      setTimeout(() => toast.remove(), 300);
    };

    toast.querySelector('.toast-close').addEventListener('click', dismiss);
    setTimeout(dismiss, 4000);
  }

  // ─── UTILITIES ───────────────────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.substring(0, max) + '…' : str;
  }

  function debounce(fn, delay) {
    let timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, arguments), delay);
    };
  }

  function formatDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
           d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function formatRelativeTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function formatAction(action) {
    const map = {
      'LOGIN': 'logged in',
      'LOGOUT': 'logged out',
      'CREATE_SESSION': 'created a session',
      'UPDATE_SESSION': 'updated a session',
      'DELETE_SESSION': 'deleted a session',
      'BULK_DELETE_SESSIONS': 'bulk deleted sessions',
      'BULK_STATUS_CHANGE': 'changed session statuses',
      'CSV_UPLOAD': 'uploaded a CSV',
      'CSV_REPLACE_ALL': 'replaced all sessions',
      'UPDATE_SETTINGS': 'updated settings',
      'CHANGE_PASSWORD': 'changed password',
      'RESET_LOGO': 'reset the logo',
      'RESET_BANNER': 'reset the banner',
      'WIPE_ALL_SESSIONS': 'wiped all sessions',
      'EXPORT_DB_BACKUP': 'exported database backup',
      'REORDER_SESSIONS': 'reordered sessions',
    };
    return map[action] || action.toLowerCase().replace(/_/g, ' ');
  }

  function getActivityIcon(action) {
    if (action.includes('CREATE'))  return 'activity-icon-create';
    if (action.includes('UPDATE') || action.includes('CHANGE') || action.includes('REORDER'))  return 'activity-icon-update';
    if (action.includes('DELETE') || action.includes('WIPE'))   return 'activity-icon-delete';
    if (action.includes('LOGIN') || action.includes('LOGOUT'))  return 'activity-icon-login';
    return 'activity-icon-default';
  }

  function getActivityBxIcon(action) {
    if (action.includes('CREATE'))  return 'plus-circle';
    if (action.includes('UPDATE'))  return 'edit';
    if (action.includes('DELETE') || action.includes('WIPE'))  return 'trash';
    if (action.includes('LOGIN'))   return 'log-in';
    if (action.includes('LOGOUT'))  return 'log-out';
    if (action.includes('CSV'))     return 'spreadsheet';
    if (action.includes('SETTING')) return 'cog';
    if (action.includes('PASSWORD'))return 'lock';
    return 'notepad';
  }

  function getAuditBadgeClass(action) {
    if (action.includes('CREATE'))  return 'session';
    if (action.includes('UPDATE') || action.includes('CHANGE'))  return 'delayed';
    if (action.includes('DELETE') || action.includes('WIPE'))    return 'cancelled';
    if (action.includes('LOGIN') || action.includes('LOGOUT'))   return 'keynote';
    return 'general';
  }

  // ─── START ───────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
