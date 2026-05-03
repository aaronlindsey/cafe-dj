const $ = (id) => document.getElementById(id);

const state = {
  signedIn: false,
  user: null,
  pendingImage: null, // { dataUrl, base64, mime }
};

async function init() {
  try {
    const res = await fetch('/api/me', { credentials: 'include' });
    if (res.ok) {
      const me = await res.json();
      state.signedIn = true;
      state.user = me;
      $('signed-in').classList.remove('hidden');
      $('signed-out').classList.add('hidden');
      $('user-area').innerHTML =
        `<span class="display-name">hi, ${escapeHtml(me.displayName)}</span>` +
        `<a href="/auth/logout">sign out</a>`;
    } else {
      $('signed-out').classList.remove('hidden');
      $('signed-in').classList.add('hidden');
      $('user-area').innerHTML = '';
    }
  } catch (e) {
    console.error(e);
    $('signed-out').classList.remove('hidden');
  }

  bindHandlers();
}

function bindHandlers() {
  $('coffee-photo').addEventListener('change', onPhotoPicked);
  $('photo-clear').addEventListener('click', clearPhoto);
  $('generate').addEventListener('click', onGenerate);
  $('regenerate').addEventListener('click', () => {
    $('result').classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('error-dismiss').addEventListener('click', () => {
    $('error').classList.add('hidden');
  });
}

async function onPhotoPicked(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const compressed = await compressToBase64(file, 800, 0.8);
    state.pendingImage = compressed;
    $('photo-preview-img').src = compressed.dataUrl;
    $('photo-preview').classList.remove('hidden');
    $('coffee-text').value = '';
  } catch (err) {
    console.error('photo compress failed', err);
    showError('could not load that photo');
  }
}

function clearPhoto() {
  state.pendingImage = null;
  $('coffee-photo').value = '';
  $('photo-preview').classList.add('hidden');
  $('photo-preview-img').src = '';
}

async function onGenerate() {
  const text = $('coffee-text').value.trim();
  if (!state.pendingImage && !text) {
    showError('add a photo or describe the coffee first');
    return;
  }

  $('error').classList.add('hidden');
  $('result').classList.add('hidden');
  $('loading').classList.remove('hidden');
  $('generate').disabled = true;
  cycleLoadingMessages();

  try {
    const body = state.pendingImage
      ? {
          inputType: 'photo',
          image: state.pendingImage.base64,
          imageMime: state.pendingImage.mime,
        }
      : { inputType: 'text', text };

    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `request failed (${res.status})`);
    }
    const result = await res.json();
    renderResult(result);
  } catch (err) {
    console.error(err);
    showError(err.message || 'something broke. try again?');
  } finally {
    $('loading').classList.add('hidden');
    $('generate').disabled = false;
    stopLoadingMessages();
  }
}

function renderResult(r) {
  $('r-coffee').textContent = r.coffeeSummary;
  $('r-vibe').textContent = r.vibeSummary;
  $('r-name').textContent = r.playlistName;
  $('r-desc').textContent = r.playlistDescription;
  $('r-embed').innerHTML =
    `<iframe src="https://open.spotify.com/embed/playlist/${encodeURIComponent(r.playlistId)}" ` +
    `allowtransparency="true" allow="encrypted-media" loading="lazy"></iframe>`;
  $('result').classList.remove('hidden');
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showError(msg) {
  $('error-msg').textContent = msg;
  $('error').classList.remove('hidden');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

let loadingTimer = null;
function cycleLoadingMessages() {
  const messages = [
    'brewing your playlist…',
    'consulting the music gods…',
    'separating the beans from the chaff…',
    'asking gemini to be funnier…',
    'cross-referencing your taste with the universe…',
    'this part takes a sec — sorry, lots of api calls…',
  ];
  let i = 0;
  $('loading-msg').textContent = messages[0];
  loadingTimer = setInterval(() => {
    i = (i + 1) % messages.length;
    $('loading-msg').textContent = messages[i];
  }, 2500);
}
function stopLoadingMessages() {
  if (loadingTimer) clearInterval(loadingTimer);
  loadingTimer = null;
}

async function compressToBase64(file, maxDim, quality) {
  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const { width, height } = fitInto(img.width, img.height, maxDim);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  const out = canvas.toDataURL('image/jpeg', quality);
  const base64 = out.split(',')[1];
  return { dataUrl: out, base64, mime: 'image/jpeg' };
}
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
function fitInto(w, h, maxDim) {
  if (w <= maxDim && h <= maxDim) return { width: w, height: h };
  if (w >= h) return { width: maxDim, height: Math.round((h / w) * maxDim) };
  return { width: Math.round((w / h) * maxDim), height: maxDim };
}

init();
