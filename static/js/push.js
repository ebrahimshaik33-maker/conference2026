/* ─── Conference Programme — Push Notification Client ───────────────────────
   Handles service worker registration, push subscription, and the opt-in banner.
   ─────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  // ── Config ───────────────────────────────────────────────────────────────
  const API_BASE = '/api';
  const SW_URL   = '/sw.js';
  const STORAGE_KEY = 'push_dismissed';
  const SUBSCRIBED_KEY = 'push_subscribed';

  // ── Helpers ──────────────────────────────────────────────────────────────
  function urlB64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
  }

  async function getVapidKey() {
    try {
      const res = await fetch(`${API_BASE}/push/vapid-public-key`);
      const data = await res.json();
      return data.public_key || null;
    } catch (_) { return null; }
  }

  async function subscribe(registration, vapidKey) {
    const applicationServerKey = urlB64ToUint8Array(vapidKey);
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
    const sub = subscription.toJSON();
    await fetch(`${API_BASE}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
    return subscription;
  }

  // ── Banner UI ─────────────────────────────────────────────────────────────
  function showPromptBanner(registration, vapidKey) {
    if (sessionStorage.getItem(STORAGE_KEY)) return;
    if (localStorage.getItem(SUBSCRIBED_KEY)) return;

    const bar = document.createElement('div');
    bar.className = 'push-prompt-bar';
    bar.id = 'pushPromptBar';
    bar.setAttribute('role', 'complementary');
    bar.innerHTML = `
      <span class="push-prompt-icon">🔔</span>
      <div class="push-prompt-text">
        <strong>Stay updated</strong>
        <span>Get notified about session changes &amp; announcements</span>
      </div>
      <div class="push-prompt-actions">
        <button class="btn btn-secondary btn-sm" id="pushDismissBtn">Not now</button>
        <button class="btn btn-primary btn-sm" id="pushAllowBtn">Allow</button>
      </div>`;
    document.body.appendChild(bar);

    document.getElementById('pushDismissBtn').addEventListener('click', () => {
      sessionStorage.setItem(STORAGE_KEY, '1');
      bar.remove();
    });

    document.getElementById('pushAllowBtn').addEventListener('click', async () => {
      try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          await subscribe(registration, vapidKey);
          localStorage.setItem(SUBSCRIBED_KEY, '1');
          bar.innerHTML = `
            <span class="push-prompt-icon">✅</span>
            <div class="push-prompt-text">
              <strong>You're subscribed!</strong>
              <span>We'll notify you about schedule changes.</span>
            </div>`;
          setTimeout(() => bar.remove(), 3000);
        } else {
          sessionStorage.setItem(STORAGE_KEY, '1');
          bar.remove();
        }
      } catch (err) {
        console.warn('[Push] Subscription error:', err);
        bar.remove();
      }
    });
  }

  function arrayBufferToBase64Url(buffer) {
    if (!buffer) return '';
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // ── Main Init ─────────────────────────────────────────────────────────────
  async function init() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (Notification.permission === 'denied') return;

    try {
      const registration = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
      const vapidKey = await getVapidKey();
      if (!vapidKey) return;

      // Check if already subscribed
      const existingSub = await registration.pushManager.getSubscription();
      if (existingSub) {
        // Detect if subscription key matches current server VAPID key
        const existingKey = existingSub.options && existingSub.options.applicationServerKey ? arrayBufferToBase64Url(existingSub.options.applicationServerKey) : '';
        if (existingKey && vapidKey && existingKey !== vapidKey) {
          // Server VAPID key changed! Unsubscribe invalid push endpoint and auto-renew
          try { await existingSub.unsubscribe(); } catch (_) {}
          if (Notification.permission === 'granted') {
            await subscribe(registration, vapidKey);
            localStorage.setItem(SUBSCRIBED_KEY, '1');
            return;
          }
        } else {
          localStorage.setItem(SUBSCRIBED_KEY, '1');
          try {
            // Keep database synchronized with active client subscriptions
            const sub = existingSub.toJSON();
            await fetch(`${API_BASE}/push/subscribe`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(sub),
            });
          } catch (_) {}
          return;
        }
      }

      // Show banner after a short delay (avoids immediately bombarding users)
      setTimeout(() => showPromptBanner(registration, vapidKey), 4000);
    } catch (err) {
      console.warn('[Push] SW registration error:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
