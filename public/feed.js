async function loadFeed() {
  const list = document.getElementById('feed');
  const loading = document.getElementById('feed-loading');
  const empty = document.getElementById('feed-empty');

  try {
    const res = await fetch('/api/feed');
    if (!res.ok) throw new Error('feed failed');
    const data = await res.json();
    loading.remove();

    if (!data.entries || data.entries.length === 0) {
      empty.classList.remove('hidden');
      return;
    }

    list.innerHTML = data.entries.map(renderEntry).join('');
  } catch (e) {
    console.error(e);
    loading.textContent = 'couldn\'t load the feed.';
  }
}

function renderEntry(e) {
  const when = relative(e.createdAt);
  return `
    <article class="feed-item">
      <p class="who"><span class="name">${escapeHtml(e.userDisplay)}</span> · ${when}</p>
      <p class="meta">☕ ${escapeHtml(e.coffeeSummary)}</p>
      <p class="meta">🎵 ${escapeHtml(e.vibeSummary)}</p>
      <div class="embed-wrap">
        <iframe src="https://open.spotify.com/embed/playlist/${encodeURIComponent(e.playlistId)}"
          allowtransparency="true" allow="encrypted-media" loading="lazy"></iframe>
      </div>
    </article>
  `;
}

function relative(unix) {
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  const d = new Date(unix * 1000);
  return d.toLocaleDateString();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

loadFeed();
