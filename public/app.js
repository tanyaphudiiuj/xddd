// ---- Animated background grid ----
(function gridBg() {
  const canvas = document.getElementById('grid');
  const ctx = canvas.getContext('2d');
  let w, h;
  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const size = 40;
  let offset = 0;

  function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,255,242,0.06)';
    ctx.lineWidth = 1;
    offset = (offset + 0.15) % size;

    for (let x = -size; x < w + size; x += size) {
      ctx.beginPath();
      ctx.moveTo(x + offset, 0);
      ctx.lineTo(x + offset, h);
      ctx.stroke();
    }
    for (let y = -size; y < h + size; y += size) {
      ctx.beginPath();
      ctx.moveTo(0, y + offset);
      ctx.lineTo(w, y + offset);
      ctx.stroke();
    }
    requestAnimationFrame(draw);
  }
  draw();
})();

// ---- Pairing flow ----
const els = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  formView: document.getElementById('formView'),
  pairingView: document.getElementById('pairingView'),
  connectedView: document.getElementById('connectedView'),
  connectingView: document.getElementById('connectingView'),
  phone: document.getElementById('phone'),
  connectBtn: document.getElementById('connectBtn'),
  cancelBtn: document.getElementById('cancelBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  pairingCode: document.getElementById('pairingCode'),
  timerFill: document.getElementById('timerFill'),
  timerNote: document.getElementById('timerNote'),
  connectedMsg: document.getElementById('connectedMsg'),
  errorMsg: document.getElementById('errorMsg'),
  footerMsg: document.getElementById('footerMsg'),
};

const AUTO_REFRESH_MS = 30000;

function showView(name) {
  ['formView', 'pairingView', 'connectedView', 'connectingView'].forEach((v) => {
    els[v].classList.toggle('hidden', v !== name);
  });
}

function setDot(status) {
  els.statusDot.className = 'dot';
  if (status === 'pairing' || status === 'connecting') els.statusDot.classList.add('pairing');
  if (status === 'connected') els.statusDot.classList.add('connected');
  els.statusText.textContent = status.toUpperCase();
}

// ---- Number sanitization: accept any format, strip everything but digits ----
els.phone.addEventListener('input', () => {
  const cleaned = els.phone.value.replace(/[^\d]/g, '');
  if (els.phone.value !== cleaned) {
    els.phone.value = cleaned;
  }
});

// ---- Tap-to-copy pairing code ----
let currentRawCode = '';

els.pairingCode.addEventListener('click', async () => {
  if (!currentRawCode) return;
  const displayed = els.pairingCode.textContent;
  try {
    await navigator.clipboard.writeText(currentRawCode);
  } catch (e) {
    // Fallback for contexts without Clipboard API access
    const ta = document.createElement('textarea');
    ta.value = currentRawCode;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) { /* best effort */ }
    document.body.removeChild(ta);
  }
  els.pairingCode.classList.add('copied');
  els.pairingCode.textContent = 'COPIED!';
  setTimeout(() => {
    els.pairingCode.textContent = displayed;
    els.pairingCode.classList.remove('copied');
  }, 900);
});

// ---- 30s auto-refresh cycle while a pairing code is showing ----
let lastRenderedCode = null;
let lastPhoneNumber = '';
let autoRefreshTimer = null;
let countdownInterval = null;

function stopAutoRefreshCycle() {
  if (autoRefreshTimer) { clearTimeout(autoRefreshTimer); autoRefreshTimer = null; }
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
}

function restartTimerBar() {
  els.timerFill.style.animation = 'none';
  void els.timerFill.offsetWidth; // force reflow so the animation restarts
  els.timerFill.style.animation = '';
}

function startAutoRefreshCycle() {
  stopAutoRefreshCycle();
  restartTimerBar();

  let remaining = Math.floor(AUTO_REFRESH_MS / 1000);
  els.timerNote.textContent = `refreshing in ${remaining}s…`;
  countdownInterval = setInterval(() => {
    remaining -= 1;
    els.timerNote.textContent = remaining > 0 ? `refreshing in ${remaining}s…` : 'refreshing…';
  }, 1000);

  autoRefreshTimer = setTimeout(async () => {
    if (!lastPhoneNumber) return;
    try {
      const data = await requestPairCode(lastPhoneNumber);
      render(data);
    } catch (e) {
      stopAutoRefreshCycle();
      els.errorMsg.textContent = e.message || 'Failed to refresh pairing code.';
      showView('formView');
    }
  }, AUTO_REFRESH_MS);
}

async function requestPairCode(phoneNumber) {
  const res = await fetch('/api/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to start pairing.');
  }
  return data;
}

function render(state) {
  setDot(state.status);
  els.footerMsg.textContent = state.message || '';

  if (state.status === 'connected') {
    stopAutoRefreshCycle();
    lastRenderedCode = null;
    els.connectedMsg.textContent = state.message || 'Bot is online.';
    showView('connectedView');
  } else if (state.status === 'pairing') {
    if (state.pairingCode) {
      if (state.pairingCode !== lastRenderedCode) {
        lastRenderedCode = state.pairingCode;
        currentRawCode = state.pairingCode;
        els.pairingCode.textContent = state.pairingCode.split('').join(' ');
        startAutoRefreshCycle();
      }
      showView('pairingView');
    } else {
      showView('connectingView');
    }
  } else if (state.status === 'connecting') {
    stopAutoRefreshCycle();
    lastRenderedCode = null;
    showView('connectingView');
  } else {
    stopAutoRefreshCycle();
    lastRenderedCode = null;
    showView('formView');
  }
}

let pollTimer = null;

async function poll() {
  try {
    const res = await fetch('/api/status');
    const state = await res.json();
    render(state);
  } catch (e) {
    els.footerMsg.textContent = 'connection to server lost…';
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(poll, 1500);
  poll();
}

els.connectBtn.addEventListener('click', async () => {
  els.errorMsg.textContent = '';
  const cleaned = els.phone.value.replace(/[^\d]/g, '');
  if (!cleaned) {
    els.errorMsg.textContent = 'Enter a phone number first.';
    return;
  }
  lastPhoneNumber = cleaned;
  showView('connectingView');
  try {
    const data = await requestPairCode(cleaned);
    render(data);
  } catch (e) {
    els.errorMsg.textContent = e.message || 'Could not reach the server.';
    showView('formView');
  }
});

els.cancelBtn.addEventListener('click', async () => {
  // Stop the local refresh cycle immediately so the UI feels responsive...
  stopAutoRefreshCycle();
  lastRenderedCode = null;
  showView('formView');
  // ...then tell the backend to actually drop the in-progress pairing attempt.
  // Without this, the next poll would still see status "pairing" with the same
  // code and silently flip back into pairingView, undoing the cancel.
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch (e) {
    // best effort — the next poll will resync the UI regardless
  }
});

els.logoutBtn.addEventListener('click', async () => {
  stopAutoRefreshCycle();
  lastRenderedCode = null;
  await fetch('/api/logout', { method: 'POST' });
  poll();
});

startPolling();
