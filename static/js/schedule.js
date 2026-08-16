/* ============================================================
   LTRIE CONFERENCE PROGRAMME — Public Schedule Logic
   ============================================================ */
(function () {
  'use strict';

  // ─── CONFIG ──────────────────────────────────────────────
  const API = {
    SESSIONS: '/api/sessions',
    SETTINGS: '/api/settings',
  };
  const REFRESH_INTERVAL_MS = 60000;
  const SEARCH_DEBOUNCE_MS = 300;

  const TYPE_CONFIG = {
    keynote:  { color: '#E8A838', icon: '<i class="bx bx-microphone"></i>', label: 'KEYNOTE' },
    session:  { color: '#4A9EFF', icon: '<i class="bx bx-slideshow"></i>', label: 'SESSION' },
    break:    { color: '#4CAF50', icon: '<i class="bx bx-coffee"></i>', label: 'BREAK' },
    panel:    { color: '#9B59B6', icon: '<i class="bx bx-group"></i>', label: 'PANEL' },
    workshop: { color: '#FF7043', icon: '<i class="bx bx-wrench"></i>', label: 'WORKSHOP' },
    general:  { color: '#8896A7', icon: '<i class="bx bx-calendar"></i>', label: 'EVENT' },
  };

  // ─── STATE ───────────────────────────────────────────────
  let state = {
    sessions: [],
    settings: {},
    currentDay: 1,
    currentVenue: 'all',
    currentTrack: 'all',
    search: '',
    showBookmarked: false,
    bookmarks: [],
    lastDataHash: '',
    refreshTimer: null,
  };

  // ─── DOM REFS ────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ─── INIT ────────────────────────────────────────────────
  async function init() {
    loadBookmarks();
    await fetchData();
    bindEvents();
    startAutoRefresh();
  }

  // ─── DATA FETCHING ───────────────────────────────────────
  async function fetchData() {
    try {
      const [sessionsRes, settingsRes] = await Promise.all([
        fetch(API.SESSIONS),
        fetch(API.SETTINGS),
      ]);

      if (!sessionsRes.ok || !settingsRes.ok) throw new Error('Failed to fetch data');

      state.sessions = await sessionsRes.json();
      state.settings = await settingsRes.json();

      const newHash = JSON.stringify(state.sessions) + JSON.stringify(state.settings);
      const changed = state.lastDataHash && state.lastDataHash !== newHash;
      state.lastDataHash = newHash;

      // Apply theme
      document.body.className = state.settings.theme || 'theme-adv-dark';

      // Hide skeleton
      const skeleton = $('#loadingSkeleton');
      if (skeleton) skeleton.style.display = 'none';

      // Setup UI
      setupAnnouncement();
      populateDayTabs();
      populateFilters();
      renderSchedule();
      updateBookmarkUI();
      updatePrintBtn();

      // Track filter visibility
      const trackGroup = $('#trackFilterGroup');
      const mobileTrackGroup = $('#mobileTrackFilterGroup');
      if (state.settings.show_track_filter === 'false') {
        if (trackGroup) trackGroup.style.display = 'none';
        if (mobileTrackGroup) mobileTrackGroup.style.display = 'none';
      } else {
        if (trackGroup) trackGroup.style.display = '';
        if (mobileTrackGroup) mobileTrackGroup.style.display = '';
      }

      // Sync UI style & layout classes on body
      if (state.settings.ui_style) {
        document.body.classList.forEach(c => { if (c.startsWith('style-')) document.body.classList.remove(c); });
        document.body.classList.add('style-' + state.settings.ui_style);
      }
      if (state.settings.layout) {
        document.body.classList.forEach(c => { if (c.startsWith('layout-')) document.body.classList.remove(c); });
        document.body.classList.add('layout-' + state.settings.layout);
      }

      if (changed) showToast('Programme updated', 'info');

    } catch (err) {
      showToast('Failed to load programme data. Please refresh.', 'error');
    }
  }

  function startAutoRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(() => {
      fetchData();
    }, REFRESH_INTERVAL_MS);
  }

  // ─── ANNOUNCEMENT ───────────────────────────────────────
  function setupAnnouncement() {
    const banner = $('#announcementBanner');
    if (!banner) return;

    const text = state.settings.announcement;
    const type = state.settings.announcement_type || 'info';

    if (!text) {
      banner.style.display = 'none';
      return;
    }

    // Check if dismissed
    const dismissed = sessionStorage.getItem('announcement_dismissed');
    if (dismissed === text) {
      banner.style.display = 'none';
      return;
    }

    banner.className = 'announcement-banner announce-' + type;
    banner.style.display = '';
    banner.querySelector('.announcement-text').textContent = text;

    const iconEl = banner.querySelector('.announcement-icon');
    if (iconEl) {
      iconEl.className = 'bx announcement-icon';
      if (type === 'info') iconEl.classList.add('bx-info-circle');
      else if (type === 'warning') iconEl.classList.add('bx-error');
      else if (type === 'danger') iconEl.classList.add('bx-error-triangle');
    }
  }

  // ─── DAY TABS ────────────────────────────────────────────
  function populateDayTabs() {
    const nav = $('#dayNav');
    const days = parseInt(state.settings.event_days) || 4;
    const startDate = state.settings.event_start_date ? new Date(state.settings.event_start_date) : null;

    if (nav) {
      nav.innerHTML = '';
      for (let i = 1; i <= days; i++) {
        const btn = document.createElement('button');
        btn.className = 'day-tab' + (i === state.currentDay ? ' active' : '');
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', i === state.currentDay ? 'true' : 'false');
        btn.setAttribute('data-day', i);
        btn.setAttribute('tabindex', i === state.currentDay ? '0' : '-1');

        let label = 'Day ' + i;
        if (startDate) {
          const d = new Date(startDate);
          d.setDate(d.getDate() + i - 1);
          const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
          label += '<span class="day-tab-date">' + dateStr + '</span>';
        }
        btn.innerHTML = label;
        nav.appendChild(btn);
      }
    }

    // Update Mobile Quick Switcher Bar
    const mobileLabel = $('#mobileDaySelectLabel');
    const prevBtn = $('#mobilePrevDay');
    const nextBtn = $('#mobileNextDay');
    const dropdown = $('#mobileDayDropdown');

    if (mobileLabel) {
      let labelText = `Day ${state.currentDay} of ${days}`;
      if (startDate) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + state.currentDay - 1);
        const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        labelText += ` (${dateStr})`;
      }
      mobileLabel.textContent = labelText;
    }

    if (prevBtn) prevBtn.disabled = state.currentDay <= 1;
    if (nextBtn) nextBtn.disabled = state.currentDay >= days;

    if (dropdown) {
      dropdown.innerHTML = '';
      for (let i = 1; i <= days; i++) {
        const item = document.createElement('div');
        item.className = 'mobile-day-option' + (i === state.currentDay ? ' active' : '');
        item.setAttribute('data-day', i);
        let optText = `Day ${i}`;
        if (startDate) {
          const d = new Date(startDate);
          d.setDate(d.getDate() + i - 1);
          optText += ` (${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})`;
        }
        item.innerHTML = `<span>${optText}</span><i class='bx bx-check' style="${i === state.currentDay ? '' : 'display:none;'}"></i>`;
        dropdown.appendChild(item);
      }
    }
  }

  // ─── FILTERS ─────────────────────────────────────────────
  function populateFilters() {
    const venues = new Set();
    const tracks = new Set();

    state.sessions.forEach((s) => {
      if (s.location) venues.add(s.location);
      if (s.track) tracks.add(s.track);
    });

    populateSelect('#venueFilter', venues, 'All Venues');
    populateSelect('#mobileVenueFilter', venues, 'All Venues');
    populateSelect('#trackFilter', tracks, 'All Tracks');
    populateSelect('#mobileTrackFilter', tracks, 'All Tracks');
  }

  function populateSelect(selector, values, defaultText) {
    const select = $(selector);
    if (!select) return;

    const current = select.value;
    select.innerHTML = '<option value="all">' + defaultText + '</option>';
    Array.from(values).sort().forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    });
    select.value = current || 'all';
  }

  // ─── FILTERING ───────────────────────────────────────────
  function getFilteredSessions() {
    let filtered = state.sessions.filter((s) => s.day === state.currentDay);

    if (state.currentVenue !== 'all') {
      filtered = filtered.filter((s) => s.location === state.currentVenue);
    }

    if (state.currentTrack !== 'all') {
      filtered = filtered.filter((s) => s.track === state.currentTrack);
    }

    if (state.search) {
      const q = state.search.toLowerCase();
      filtered = filtered.filter((s) =>
        (s.title && s.title.toLowerCase().includes(q)) ||
        (s.presenter && s.presenter.toLowerCase().includes(q)) ||
        (s.description && s.description.toLowerCase().includes(q)) ||
        (s.track && s.track.toLowerCase().includes(q)) ||
        (s.location && s.location.toLowerCase().includes(q))
      );
    }

    if (state.showBookmarked) {
      const ids = state.bookmarks.map((b) => b.id);
      filtered = filtered.filter((s) => ids.includes(s.id));
    }

    return filtered;
  }

  // ─── RENDERING ───────────────────────────────────────────
  function renderSchedule() {
    const container = $('#scheduleContainer');
    if (!container) return;

    const filtered = getFilteredSessions();

    if (state.settings.layout === 'grid' && window.innerWidth >= 768) {
      renderTrackGridSchedule(container, filtered);
      return;
    }

    // Group by start_time
    const groups = {};
    filtered.forEach((s) => {
      const key = s.start_time || '00:00';
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    });

    // Sort within groups by display_order
    Object.values(groups).forEach((g) => g.sort((a, b) => (a.display_order || 0) - (b.display_order || 0)));

    // Remove old content (but keep skeleton if visible)
    const existing = container.querySelector('.schedule-content');
    if (existing) existing.remove();

    const content = document.createElement('div');
    content.className = 'schedule-content';

    if (Object.keys(groups).length === 0) {
      content.innerHTML = renderEmptyState();
    } else {
      const sortedTimes = Object.keys(groups).sort();
      sortedTimes.forEach((time) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'time-slot-group';

        const endTime = groups[time][0].end_time;
        const timeDisplay = endTime ? time + ' – ' + endTime : time;

        groupEl.innerHTML = '<div class="time-label">' + timeDisplay + '</div>';

        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'time-slot-cards';

        groups[time].forEach((session, idx) => {
          const card = renderSessionCard(session);
          card.style.transitionDelay = (idx * 30) + 'ms';
          card.classList.add('card-enter');
          cardsContainer.appendChild(card);
        });

        groupEl.appendChild(cardsContainer);
        content.appendChild(groupEl);
      });
    }

    container.appendChild(content);

    // Stagger animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        content.querySelectorAll('.card-enter').forEach((card) => {
          card.classList.add('card-enter-active');
        });
      });
    });

    // Update print header
    updatePrintHeader();
  }

  function parseTimeToMins(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.trim().split(':');
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    return h * 60 + m;
  }

  function renderTrackGridSchedule(container, filtered) {
    const existing = container.querySelector('.schedule-content');
    if (existing) existing.remove();

    if (filtered.length === 0) {
      const content = document.createElement('div');
      content.className = 'schedule-content';
      content.innerHTML = renderEmptyState();
      container.appendChild(content);
      return;
    }

    // 1. Group by Track (or Venue)
    const tracksMap = {};
    let globalMinMins = 24 * 60;
    let globalMaxMins = 0;

    filtered.forEach((s) => {
      const trackName = s.track || s.venue || 'General Sessions';
      if (!tracksMap[trackName]) tracksMap[trackName] = [];
      tracksMap[trackName].push(s);

      const startMins = parseTimeToMins(s.start_time);
      let endMins = parseTimeToMins(s.end_time);
      if (!endMins || endMins <= startMins) endMins = startMins + 45;

      if (startMins < globalMinMins) globalMinMins = startMins;
      if (endMins > globalMaxMins) globalMaxMins = endMins;
    });

    if (globalMinMins >= globalMaxMins) {
      globalMinMins = 8 * 60;
      globalMaxMins = 17 * 60;
    }

    const startHour = Math.floor(globalMinMins / 60);
    const endHour = Math.ceil(globalMaxMins / 60);
    const totalHours = Math.max(endHour - startHour, 3);

    const HOUR_WIDTH = 280; // px per hour for spacious cards
    const totalWidth = totalHours * HOUR_WIDTH;

    const content = document.createElement('div');
    content.className = 'schedule-content epg-matrix-container';

    let html = '';
    html += '<div class="epg-matrix-wrapper">';

    // EPG Header Row with Hours
    html += '<div class="epg-header-row">';
    html += '  <div class="epg-track-header-cell"><i class="bx bx-slider-alt"></i> Agenda Tracks</div>';
    html += '  <div class="epg-time-axis" style="width: ' + totalWidth + 'px;">';
    for (let h = startHour; h <= endHour; h++) {
      const offset = (h - startHour) * HOUR_WIDTH;
      const hourStr = (h < 10 ? '0' + h : '' + h) + ':00';
      html += '    <div class="epg-time-tick" style="left: ' + offset + 'px;">';
      html += '      <span>' + hourStr + '</span>';
      html += '      <div class="epg-tick-line"></div>';
      html += '    </div>';
    }
    html += '  </div>';
    html += '</div>';

    // EPG Track Rows
    html += '<div class="epg-rows-container">';
    Object.keys(tracksMap).forEach((trackName) => {
      const sessions = tracksMap[trackName];
      html += '<div class="epg-track-row">';
      html += '  <div class="epg-track-label">';
      html += '    <div class="epg-track-indicator"></div>';
      html += '    <span>' + escapeHtml(trackName) + '</span>';
      html += '  </div>';
      html += '  <div class="epg-track-timeline" style="width: ' + totalWidth + 'px;">';

      // Vertical background grid lines
      for (let h = startHour; h <= endHour; h++) {
        const offset = (h - startHour) * HOUR_WIDTH;
        html += '    <div class="epg-grid-line" style="left: ' + offset + 'px;"></div>';
      }

      // Sessions in this track
      sessions.forEach((s) => {
        const sMins = parseTimeToMins(s.start_time);
        let eMins = parseTimeToMins(s.end_time);
        if (!eMins || eMins <= sMins) eMins = sMins + 45;

        const left = ((sMins - (startHour * 60)) / 60) * HOUR_WIDTH;
        const durationMins = Math.max(eMins - sMins, 25);
        const width = Math.max((durationMins / 60) * HOUR_WIDTH - 12, 175);

        const isBookmarked = state.bookmarks.some((b) => b.id === s.id);
        const typeLabel = (TYPE_CONFIG[s.type] || TYPE_CONFIG.general).label;

        html += '    <div class="epg-card-item" style="left: ' + left.toFixed(1) + 'px; width: ' + width.toFixed(1) + 'px;" data-session-id="' + s.id + '" title="' + escapeHtml(s.title) + '">';
        html += '      <div class="epg-card-content">';
        html += '        <div class="epg-card-top">';
        if (s.speaker) {
          html += '          <span class="epg-card-speaker"><i class="bx bx-user"></i> ' + escapeHtml(s.speaker.split('—')[0].split(',')[0]) + '</span>';
        } else {
          html += '          <span class="epg-card-type">' + escapeHtml(typeLabel) + '</span>';
        }
        html += '          <button class="bookmark-btn epg-bookmark' + (isBookmarked ? ' bookmarked' : '') + '" data-id="' + s.id + '"><i class="bx ' + (isBookmarked ? 'bxs-star' : 'bx-star') + '"></i></button>';
        html += '        </div>';
        html += '        <h4 class="epg-card-title" title="' + escapeHtml(s.title) + '">' + escapeHtml(s.title) + '</h4>';
        html += '        <div class="epg-card-time">';
        html += '          <i class="bx bx-time-five"></i> ' + escapeHtml(s.start_time || '') + (s.end_time ? ' – ' + escapeHtml(s.end_time) : '');
        if (s.venue) html += ' • <i class="bx bx-map-pin"></i> ' + escapeHtml(s.venue);
        html += '        </div>';
        html += '      </div>';
        html += '    </div>';
      });

      html += '  </div>';
      html += '</div>';
    });
    html += '</div>';
    html += '</div>';

    content.innerHTML = html;
    container.appendChild(content);

    // Bind card click & bookmark handlers
    content.querySelectorAll('.epg-card-item').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.bookmark-btn')) return;
        const id = card.getAttribute('data-session-id');
        if (id) openSessionModal(id);
      });
    });

    updatePrintHeader();
  }

  // ─── PLANBY-STYLE SESSION DETAIL MODAL POPUP ─────────────────
  function openSessionModal(sessionId) {
    const session = state.sessions.find((s) => s.id == sessionId);
    if (!session) return;

    let modal = document.getElementById('publicSessionModal');
    let backdrop = document.getElementById('publicSessionBackdrop');

    if (!modal) {
      backdrop = document.createElement('div');
      backdrop.id = 'publicSessionBackdrop';
      backdrop.className = 'planby-modal-backdrop';

      modal = document.createElement('div');
      modal.id = 'publicSessionModal';
      modal.className = 'planby-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');

      document.body.appendChild(backdrop);
      document.body.appendChild(modal);

      backdrop.addEventListener('click', closeSessionModal);
    }

    const tc = TYPE_CONFIG[session.type] || TYPE_CONFIG.general;
    const isBookmarked = state.bookmarks.some((b) => b.id === session.id);
    const showEval = state.settings.show_evaluation_links !== 'false';

    let timeRange = session.start_time || '';
    if (session.end_time) timeRange += ' – ' + session.end_time;

    const presenterName = session.presenter || session.speaker || '';

    let html = '';
    html += '<button class="planby-modal-close" id="planbyModalCloseBtn" aria-label="Close modal"><i class="bx bx-x"></i></button>';
    html += '<div class="planby-modal-body">';

    // Left Column: Speaker Avatar / Image
    html += '  <div class="planby-modal-avatar-col">';
    if (session.image_path) {
      html += '    <img src="/static/uploads/' + escapeHtml(session.image_path) + '" alt="' + escapeHtml(presenterName || session.title) + '" class="planby-avatar-img">';
    } else {
      let iconClass = 'bx-user-voice';
      if (session.type === 'keynote') iconClass = 'bx-microphone';
      else if (session.type === 'break') iconClass = 'bx-coffee';
      else if (session.type === 'panel') iconClass = 'bx-group';
      else if (session.type === 'workshop') iconClass = 'bx-wrench';
      else if (session.type === 'session') iconClass = 'bx-slideshow';

      const initials = presenterName ? presenterName.split(' ').map(n=>n[0]).slice(0,2).join('') : (tc.label || 'EVENT');

      html += '    <div class="planby-avatar-placeholder type-' + (session.type || 'general') + '">';
      html += '      <div class="planby-avatar-icon-wrap"><i class="bx ' + iconClass + '"></i></div>';
      html += '      <span class="planby-avatar-initials">' + escapeHtml(initials) + '</span>';
      html += '    </div>';
    }
    html += '  </div>';

    // Right Column: Session Details
    html += '  <div class="planby-modal-info-col">';

    // Badges Row
    html += '    <div class="planby-badges-row">';
    html += '      <span class="planby-pill-badge"><i class="bx bx-time-five"></i> ' + escapeHtml(timeRange) + '</span>';
    if (session.location || session.venue) {
      html += '    <span class="planby-pill-badge planby-pill-location"><i class="bx bx-map-pin"></i> ' + escapeHtml(session.location || session.venue) + '</span>';
    }
    if (session.track) {
      html += '    <span class="planby-pill-badge planby-pill-track"><i class="bx bx-purchase-tag-alt"></i> ' + escapeHtml(session.track) + '</span>';
    }
    if (tc.label) {
      html += '    <span class="planby-pill-badge planby-pill-type">' + tc.icon + ' ' + escapeHtml(tc.label) + '</span>';
    }
    html += '    </div>';

    // Title
    html += '    <h2 class="planby-modal-title">' + escapeHtml(session.title) + '</h2>';

    // Presenter & Affiliation
    if (presenterName) {
      let speakerText = escapeHtml(presenterName);
      if (session.affiliation) speakerText += ' — ' + escapeHtml(session.affiliation);
      html += '    <div class="planby-modal-speaker"><i class="bx bx-user-voice"></i> ' + speakerText + '</div>';
    }

    // Speaker Bio Section
    if (session.bio) {
      html += '    <div class="planby-modal-section">';
      html += '      <h4 class="planby-section-heading"><i class="bx bx-id-card"></i> Speaker Bio</h4>';
      html += '      <p class="planby-description-text">' + escapeHtml(session.bio) + '</p>';
      html += '    </div>';
    }

    // Description / Abstract Section
    if (session.description) {
      html += '    <div class="planby-modal-section">';
      html += '      <h4 class="planby-section-heading"><i class="bx bx-file-blank"></i> Abstract / Description</h4>';
      html += '      <p class="planby-description-text">' + escapeHtml(session.description) + '</p>';
      html += '    </div>';
    }

    // Menu Details (for breaks / meals)
    if (session.menu_details) {
      html += '    <div class="planby-modal-section">';
      html += '      <h4 class="planby-section-heading"><i class="bx bx-restaurant"></i> Catering & Menu Details</h4>';
      html += '      <p class="planby-description-text">' + escapeHtml(session.menu_details) + '</p>';
      html += '    </div>';
    }

    // Moved To indicator
    if (session.status === 'moved' && session.moved_to) {
      html += '    <div class="planby-moved-notice"><i class="bx bx-repost"></i> <strong>Session Moved To:</strong> ' + escapeHtml(session.moved_to) + '</div>';
    }

    // Modal Footer Actions
    html += '    <div class="planby-modal-actions">';
    html += '      <button class="btn btn-primary planby-bookmark-btn' + (isBookmarked ? ' bookmarked' : '') + '" data-id="' + session.id + '">';
    html += '        <i class="bx ' + (isBookmarked ? 'bxs-star' : 'bx-star') + '"></i> ';
    html += '        <span>' + (isBookmarked ? 'Bookmarked' : 'Add to Bookmarks') + '</span>';
    html += '      </button>';

    if (session.meeting_url) {
      html += '      <a href="' + escapeHtml(session.meeting_url) + '" target="_blank" rel="noopener" class="btn btn-primary modal-btn-join"><i class="bx bx-video"></i> Join Online (Teams/Zoom)</a>';
    }
    const paperLink = session.paper_url || session.presentation_url;
    if (paperLink) {
      html += '      <a href="' + escapeHtml(paperLink) + '" target="_blank" rel="noopener" class="btn btn-secondary"><i class="bx bx-link-external"></i> View Paper / Slides</a>';
    }
    if (showEval && session.evaluation_url) {
      html += '      <a href="' + escapeHtml(session.evaluation_url) + '" target="_blank" rel="noopener" class="btn btn-secondary"><i class="bx bx-edit-alt"></i> Feedback Form</a>';
    }

    html += '    </div>';
    html += '  </div>';
    html += '</div>';

    modal.innerHTML = html;

    backdrop.style.display = 'block';
    modal.style.display = 'block';
    requestAnimationFrame(() => {
      backdrop.classList.add('show');
      modal.classList.add('show');
    });

    document.getElementById('planbyModalCloseBtn').addEventListener('click', closeSessionModal);

    const modalBookmark = modal.querySelector('.planby-bookmark-btn');
    if (modalBookmark) {
      modalBookmark.addEventListener('click', () => {
        toggleBookmark(session.id);
        const nowBookmarked = state.bookmarks.some((b) => b.id === session.id);
        modalBookmark.classList.toggle('bookmarked', nowBookmarked);
        modalBookmark.querySelector('span').textContent = nowBookmarked ? 'Bookmarked' : 'Add to Bookmarks';
        modalBookmark.querySelector('i').className = 'bx ' + (nowBookmarked ? 'bxs-star' : 'bx-star');
      });
    }
  }

  function closeSessionModal() {
    const modal = document.getElementById('publicSessionModal');
    const backdrop = document.getElementById('publicSessionBackdrop');
    if (modal) {
      modal.classList.remove('show');
      if (backdrop) backdrop.classList.remove('show');
      setTimeout(() => {
        if (modal) modal.style.display = 'none';
        if (backdrop) backdrop.style.display = 'none';
      }, 200);
    }
  }

  function renderSessionCard(session) {
    const card = document.createElement('article');
    card.className = 'session-card';
    card.setAttribute('data-session-id', session.id);
    card.setAttribute('data-type', session.type || 'session');
    if (session.status) card.setAttribute('data-status', session.status);

    const tc = TYPE_CONFIG[session.type] || TYPE_CONFIG.general;
    const isBookmarked = state.bookmarks.some((b) => b.id === session.id);
    const showEval = state.settings.show_evaluation_links !== 'false';

    let timeStr = session.start_time || '';
    if (session.end_time) timeStr += ' – ' + session.end_time;

    let html = '';

    // Main Row containing 3 distinct columns: [Time & Venue] [Title & Speaker] [Actions & Links]
    html += '<div class="session-main-row">';

    // ── Column 1: Time & Location ──
    html += '  <div class="session-col-time">';
    if (timeStr) {
      html += '    <div class="session-time-pill"><i class="bx bx-time-five"></i> ' + timeStr + '</div>';
    }
    if (session.location) {
      html += '    <div class="session-venue-pill"><i class="bx bx-map"></i> ' + escapeHtml(session.location) + '</div>';
    }
    html += '  </div>';

    // ── Column 2: Badge, Title & Speaker ──
    html += '  <div class="session-col-content">';
    html += '    <div class="session-title-line">';
    if (tc.label) {
      html += '      <span class="type-badge type-badge-' + session.type + '">' +
              (tc.icon ? tc.icon + ' ' : '') + tc.label + '</span>';
    }
    html += '      <h3 class="card-title" title="Click to view details">' + escapeHtml(session.title) + '</h3>';
    html += '    </div>';

    if (session.presenter || session.track) {
      html += '    <div class="session-meta-line">';
      if (session.presenter) {
        let presenterText = escapeHtml(session.presenter);
        if (session.affiliation) presenterText += ' — ' + escapeHtml(session.affiliation);
        html += '      <span class="session-meta-speaker"><i class="bx bx-user"></i> ' + presenterText + '</span>';
      }
      if (session.track) {
        html += '      <span class="session-meta-track"><i class="bx bx-purchase-tag"></i> ' + escapeHtml(session.track) + '</span>';
      }
      html += '    </div>';
    }
    html += '  </div>';

    // ── Column 3: Action Buttons, Links & Bookmark ──
    html += '  <div class="session-col-actions">';
    html += '    <div class="session-btns-row">';
    if (session.description) {
      html += '<button class="card-expand-btn" aria-expanded="false" data-target="desc-' + session.id + '" aria-label="Show abstract">' +
              'Abstract <span class="chevron"><i class="bx bx-chevron-down"></i></span></button>';
    }
    if (session.bio) {
      html += '<button class="card-expand-btn" aria-expanded="false" data-target="bio-' + session.id + '" aria-label="Show speaker biography">' +
              'Bio <span class="chevron"><i class="bx bx-chevron-down"></i></span></button>';
    }
    if (session.menu_details) {
      html += '<button class="card-expand-btn" aria-expanded="false" data-target="menu-' + session.id + '" aria-label="Show menu">' +
              'Menu <span class="chevron"><i class="bx bx-chevron-down"></i></span></button>';
    }
    html += '      <button class="bookmark-btn' + (isBookmarked ? ' bookmarked' : '') + '" ' +
            'aria-label="' + (isBookmarked ? 'Remove bookmark' : 'Bookmark session') + '" ' +
            'data-id="' + session.id + '">' +
            '<i class="bx ' + (isBookmarked ? 'bxs-star' : 'bx-star') + '"></i></button>';
    html += '    </div>';

    if (session.meeting_url || session.paper_url || (session.evaluation_url && showEval)) {
      html += '    <div class="session-links-row">';
      if (session.meeting_url) {
        html += '<a href="' + escapeHtml(session.meeting_url) + '" target="_blank" rel="noopener" class="card-link card-link-meeting" title="Join online video stream (Teams / Zoom)">' +
                '<i class="bx bx-video"></i> Join Online</a>';
      }
      if (session.paper_url) {
        html += '<a href="' + escapeHtml(session.paper_url) + '" target="_blank" rel="noopener" class="card-link">' +
                '<i class="bx bx-link-external"></i> Paper</a>';
      }
      if (session.evaluation_url && showEval) {
        html += '<a href="' + escapeHtml(session.evaluation_url) + '" target="_blank" rel="noopener" class="card-link">' +
                '<i class="bx bx-edit"></i> Evaluate</a>';
      }
      html += '    </div>';
    }
    html += '  </div>';

    html += '</div>'; // End .session-main-row

    // Expandable Drawers (Full Width Below Main Row)
    if (session.description) {
      html += '<div class="card-expandable" id="desc-' + session.id + '">' +
              '<div class="card-description"><strong style="display:block;margin-bottom:6px;color:var(--color-primary);"><i class="bx bx-file"></i> Abstract:</strong>' + escapeHtml(session.description) + '</div></div>';
    }
    if (session.bio) {
      html += '<div class="card-expandable" id="bio-' + session.id + '">' +
              '<div class="card-description"><strong style="display:block;margin-bottom:6px;color:var(--color-primary);"><i class="bx bx-id-card"></i> Presenter Biography:</strong>' + escapeHtml(session.bio) + '</div></div>';
    }
    if (session.menu_details) {
      html += '<div class="card-expandable" id="menu-' + session.id + '">' +
              '<div class="card-description"><strong style="display:block;margin-bottom:6px;color:var(--color-primary);"><i class="bx bx-restaurant"></i> Catering Menu:</strong>' + escapeHtml(session.menu_details) + '</div></div>';
    }

    // Status
    if (session.status === 'cancelled') {
      html += '<div class="status-stamp status-stamp-cancelled"><i class="bx bx-x-circle"></i> CANCELLED</div>';
    } else if (session.status === 'delayed') {
      html += '<div class="status-stamp status-stamp-delayed"><i class="bx bx-time"></i> DELAYED</div>';
    } else if (session.status === 'moved') {
      html += '<div class="status-stamp status-stamp-moved"><i class="bx bx-transfer"></i> MOVED</div>';
      if (session.moved_to) {
        html += '<div class="moved-to-banner"><i class="bx bx-right-arrow-alt"></i> Moved to: ' +
                escapeHtml(session.moved_to) + '</div>';
      }
    }

    card.innerHTML = html;
    return card;
  }

  function renderEmptyState() {
    let reason = 'No sessions scheduled for this day yet.';
    let action = '';

    if (state.search) {
      reason = 'No sessions match your search.';
      action = '<button class="btn btn-secondary" onclick="document.getElementById(\'searchInput\').value=\'\';document.getElementById(\'searchInput\').dispatchEvent(new Event(\'input\'))">Clear Search</button>';
    } else if (state.showBookmarked) {
      reason = 'No bookmarked sessions for this day.';
      action = '';
    } else if (state.currentVenue !== 'all' || state.currentTrack !== 'all') {
      reason = 'No sessions match your filters.';
      action = '<button class="btn btn-secondary" id="emptyStateClearBtn">Clear Filters</button>';
    }

    return '<div class="empty-state">' +
      '<i class="bx bx-calendar"></i>' +
      '<h3>Nothing here yet</h3>' +
      '<p>' + reason + '</p>' + action +
      '</div>';
  }

  // ─── BOOKMARKS ───────────────────────────────────────────
  function loadBookmarks() {
    try {
      const stored = localStorage.getItem('ltrie_bookmarks');
      state.bookmarks = stored ? JSON.parse(stored) : [];
    } catch (e) {
      state.bookmarks = [];
    }
  }

  function saveBookmarks() {
    localStorage.setItem('ltrie_bookmarks', JSON.stringify(state.bookmarks));
    updateBookmarkUI();
  }

  function toggleBookmark(sessionId) {
    const idx = state.bookmarks.findIndex((b) => b.id === sessionId);
    if (idx >= 0) {
      state.bookmarks.splice(idx, 1);
    } else {
      const session = state.sessions.find((s) => s.id === sessionId);
      if (session) {
        state.bookmarks.push({
          id: session.id,
          title: session.title,
          day: session.day,
          startTime: session.start_time,
        });
      }
    }
    saveBookmarks();
  }

  function updateBookmarkUI() {
    const count = state.bookmarks.length;
    const countEl = $('#bookmarkCount');
    if (countEl) {
      countEl.textContent = count;
      countEl.style.display = count > 0 ? '' : 'none';
    }
    updatePrintBtn();
  }

  function updatePrintBtn() {
    const btn = $('#printScheduleBtn');
    if (btn) {
      btn.style.display = state.showBookmarked && state.bookmarks.length > 0 ? '' : 'none';
    }
  }

  function updatePrintHeader() {
    const titleEl = $('#printTitle');
    const dateEl = $('#printDate');
    if (titleEl) {
      titleEl.textContent = (state.settings.event_title || 'Programme') + ' — Day ' + state.currentDay;
    }
    if (dateEl && state.settings.event_start_date) {
      const d = new Date(state.settings.event_start_date);
      d.setDate(d.getDate() + state.currentDay - 1);
      dateEl.textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
  }

  // ─── EVENT HANDLERS ──────────────────────────────────────
  function bindEvents() {
    // Day tabs (delegation)
    const dayNav = $('#dayNav');
    if (dayNav) {
      dayNav.addEventListener('click', (e) => {
        const tab = e.target.closest('.day-tab');
        if (!tab) return;
        switchDay(parseInt(tab.dataset.day));
      });

      // Arrow key navigation for day tabs
      dayNav.addEventListener('keydown', (e) => {
        const tabs = Array.from(dayNav.querySelectorAll('.day-tab'));
        const current = tabs.findIndex((t) => t.classList.contains('active'));
        let next = current;

        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          next = (current + 1) % tabs.length;
          e.preventDefault();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          next = (current - 1 + tabs.length) % tabs.length;
          e.preventDefault();
        }

        if (next !== current) {
          tabs[next].focus();
          tabs[next].click();
        }
      });
    }

    // Venue filter
    const venueFilter = $('#venueFilter');
    if (venueFilter) {
      venueFilter.addEventListener('change', () => {
        state.currentVenue = venueFilter.value;
        syncMobileFilters();
        renderSchedule();
      });
    }

    // Track filter
    const trackFilter = $('#trackFilter');
    if (trackFilter) {
      trackFilter.addEventListener('change', () => {
        state.currentTrack = trackFilter.value;
        syncMobileFilters();
        renderSchedule();
      });
    }

    // Search
    const searchInput = $('#searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', debounce(() => {
        state.search = searchInput.value.trim();
        syncMobileFilters();
        renderSchedule();
      }, SEARCH_DEBOUNCE_MS));
    }

    // Bookmark toggle
    const bookmarkToggle = $('#bookmarkToggle');
    if (bookmarkToggle) {
      bookmarkToggle.addEventListener('click', () => {
        state.showBookmarked = !state.showBookmarked;
        bookmarkToggle.setAttribute('aria-pressed', state.showBookmarked);
        updatePrintBtn();
        renderSchedule();
      });
    }

    // Bookmark button clicks (delegation)
    const scheduleContainer = $('#scheduleContainer');
    // ── Mobile Day Bar Switcher ──
    const mobilePrev = $('#mobilePrevDay');
    if (mobilePrev) {
      mobilePrev.addEventListener('click', () => {
        if (state.currentDay > 1) {
          switchDay(state.currentDay - 1);
          populateDayTabs();
        }
      });
    }

    const mobileNext = $('#mobileNextDay');
    if (mobileNext) {
      mobileNext.addEventListener('click', () => {
        const days = parseInt(state.settings.event_days) || 4;
        if (state.currentDay < days) {
          switchDay(state.currentDay + 1);
          populateDayTabs();
        }
      });
    }

    const mobileSelectBtn = $('#mobileDaySelectBtn');
    const mobileDropdown  = $('#mobileDayDropdown');
    if (mobileSelectBtn && mobileDropdown) {
      mobileSelectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = mobileDropdown.hasAttribute('hidden');
        if (isHidden) {
          mobileDropdown.removeAttribute('hidden');
          mobileSelectBtn.setAttribute('aria-expanded', 'true');
        } else {
          mobileDropdown.setAttribute('hidden', '');
          mobileSelectBtn.setAttribute('aria-expanded', 'false');
        }
      });

      document.addEventListener('click', (e) => {
        if (!mobileDropdown.contains(e.target) && e.target !== mobileSelectBtn) {
          mobileDropdown.setAttribute('hidden', '');
          mobileSelectBtn && mobileSelectBtn.setAttribute('aria-expanded', 'false');
        }
      });

      mobileDropdown.addEventListener('click', (e) => {
        const opt = e.target.closest('.mobile-day-option');
        if (opt) {
          const day = parseInt(opt.getAttribute('data-day'));
          if (day) {
            switchDay(day);
            populateDayTabs();
            mobileDropdown.setAttribute('hidden', '');
            mobileSelectBtn && mobileSelectBtn.setAttribute('aria-expanded', 'false');
          }
        }
      });
    }

    if (scheduleContainer) {
      scheduleContainer.addEventListener('click', (e) => {
        // Bookmark
        const bookmarkBtn = e.target.closest('.bookmark-btn');
        if (bookmarkBtn) {
          const id = parseInt(bookmarkBtn.dataset.id);
          toggleBookmark(id);
          renderSchedule();
          return;
        }

        // Expand/collapse abstract/bio/menu
        const expandBtn = e.target.closest('.card-expand-btn');
        if (expandBtn) {
          const targetId = expandBtn.dataset.target;
          const target = document.getElementById(targetId);
          if (!target) return;

          const isExpanded = expandBtn.getAttribute('aria-expanded') === 'true';
          expandBtn.setAttribute('aria-expanded', !isExpanded);

          if (isExpanded) {
            target.style.maxHeight = '0';
            target.classList.remove('expanded');
          } else {
            target.classList.add('expanded');
            target.style.maxHeight = target.scrollHeight + 'px';
          }
          return;
        }

        // Title click -> Open Rich Session Modal
        const cardTitle = e.target.closest('.card-title');
        if (cardTitle) {
          const card = cardTitle.closest('.session-card');
          if (card) {
            const sid = parseInt(card.dataset.sessionId);
            const session = state.sessions.find((s) => s.id === sid);
            if (session) {
              renderSessionModal(session);
              return;
            }
          }
        }

        // Empty state clear filters
        const clearBtn = e.target.closest('#emptyStateClearBtn');
        if (clearBtn) {
          clearAllFilters();
          return;
        }
      });
    }

    // Announcement close
    const announcementClose = $('#announcementClose');
    if (announcementClose) {
      announcementClose.addEventListener('click', () => {
        const banner = $('#announcementBanner');
        if (banner) banner.style.display = 'none';
        sessionStorage.setItem('announcement_dismissed', state.settings.announcement || '');
      });
    }

    // Print button
    const printBtn = $('#printScheduleBtn');
    if (printBtn) {
      printBtn.addEventListener('click', () => window.print());
    }

    // ── Mobile filter sheet ──
    const mobileFilterBtn = $('#mobileFilterBtn');
    const filterSheet = $('#filterSheet');
    const filterBackdrop = $('#filterSheetBackdrop');
    const filterClose = $('#filterSheetClose');
    const applyBtn = $('#applyFiltersBtn');
    const clearBtn = $('#clearFiltersBtn');

    if (mobileFilterBtn && filterSheet) {
      mobileFilterBtn.addEventListener('click', () => openFilterSheet());

      if (filterBackdrop) filterBackdrop.addEventListener('click', () => closeFilterSheet());
      if (filterClose) filterClose.addEventListener('click', () => closeFilterSheet());

      if (applyBtn) {
        applyBtn.addEventListener('click', () => {
          applyMobileFilters();
          closeFilterSheet();
        });
      }
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          clearAllFilters();
          closeFilterSheet();
        });
      }

      // Mobile bookmark toggle
      const mobileBookmarkToggle = $('#mobileBookmarkToggle');
      if (mobileBookmarkToggle) {
        mobileBookmarkToggle.addEventListener('click', () => {
          const pressed = mobileBookmarkToggle.getAttribute('aria-pressed') === 'true';
          mobileBookmarkToggle.setAttribute('aria-pressed', !pressed);
        });
      }
    }

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeFilterSheet();
      }
    });
  }

  function switchDay(day) {
    if (day === state.currentDay) return;

    const container = $('#scheduleContainer');
    const content = container ? container.querySelector('.schedule-content') : null;

    // Fade out
    if (content) {
      content.classList.add('fade-out');
    }

    setTimeout(() => {
      state.currentDay = day;
      state.search = '';
      const searchInput = $('#searchInput');
      if (searchInput) searchInput.value = '';

      // Update active tab
      $$('.day-tab').forEach((tab) => {
        const isActive = parseInt(tab.dataset.day) === day;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', isActive);
        tab.setAttribute('tabindex', isActive ? '0' : '-1');
      });

      renderSchedule();

      // Scroll to top
      const scheduleMain = $('#main-content');
      if (scheduleMain) {
        scheduleMain.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 200);
  }

  // ─── FILTER SHEET ────────────────────────────────────────
  function openFilterSheet() {
    const sheet = $('#filterSheet');
    const backdrop = $('#filterSheetBackdrop');
    if (sheet) {
      sheet.style.display = '';
      backdrop.style.display = '';
      requestAnimationFrame(() => {
        sheet.classList.add('show');
        backdrop.classList.add('show');
      });
      // Trap focus
      const firstFocusable = sheet.querySelector('select, input, button');
      if (firstFocusable) firstFocusable.focus();
    }
  }

  function closeFilterSheet() {
    const sheet = $('#filterSheet');
    const backdrop = $('#filterSheetBackdrop');
    if (sheet) {
      sheet.classList.remove('show');
      backdrop.classList.remove('show');
      setTimeout(() => {
        sheet.style.display = 'none';
        backdrop.style.display = 'none';
      }, 350);
    }
  }

  function syncMobileFilters() {
    const mv = $('#mobileVenueFilter');
    const mt = $('#mobileTrackFilter');
    const ms = $('#mobileSearchInput');
    if (mv) mv.value = state.currentVenue;
    if (mt) mt.value = state.currentTrack;
    if (ms) ms.value = state.search;
  }

  function applyMobileFilters() {
    const mv = $('#mobileVenueFilter');
    const mt = $('#mobileTrackFilter');
    const ms = $('#mobileSearchInput');
    const mb = $('#mobileBookmarkToggle');

    if (mv) {
      state.currentVenue = mv.value;
      const dv = $('#venueFilter');
      if (dv) dv.value = mv.value;
    }
    if (mt) {
      state.currentTrack = mt.value;
      const dt = $('#trackFilter');
      if (dt) dt.value = mt.value;
    }
    if (ms) {
      state.search = ms.value.trim();
      const ds = $('#searchInput');
      if (ds) ds.value = ms.value;
    }
    if (mb) {
      state.showBookmarked = mb.getAttribute('aria-pressed') === 'true';
      const db = $('#bookmarkToggle');
      if (db) db.setAttribute('aria-pressed', state.showBookmarked);
    }

    updatePrintBtn();
    renderSchedule();
  }

  function clearAllFilters() {
    state.currentVenue = 'all';
    state.currentTrack = 'all';
    state.search = '';
    state.showBookmarked = false;

    ['#venueFilter', '#mobileVenueFilter'].forEach((s) => { const el = $(s); if (el) el.value = 'all'; });
    ['#trackFilter', '#mobileTrackFilter'].forEach((s) => { const el = $(s); if (el) el.value = 'all'; });
    ['#searchInput', '#mobileSearchInput'].forEach((s) => { const el = $(s); if (el) el.value = ''; });
    ['#bookmarkToggle', '#mobileBookmarkToggle'].forEach((s) => {
      const el = $(s);
      if (el) el.setAttribute('aria-pressed', 'false');
    });

    updatePrintBtn();
    renderSchedule();
  }

  // ─── TOAST ───────────────────────────────────────────────
  function showToast(message, type) {
    type = type || 'info';
    const container = $('#toast-container');
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

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    const dismiss = () => {
      toast.classList.remove('show');
      toast.classList.add('hide');
      setTimeout(() => toast.remove(), 300);
    };

    toast.querySelector('.toast-close').addEventListener('click', dismiss);
    setTimeout(dismiss, 4000);
  }

  // ─── UTILITIES ───────────────────────────────────────────
  function debounce(fn, delay) {
    let timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, arguments), delay);
    };
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── START ───────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
