export const ADMIN_IMPORTS_HTML = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Schedule Import Admin</title><link rel="stylesheet" href="/admin/imports/app.css"></head>
<body><main class="shell">
  <header><div><p class="eyebrow">SUBCULTURE SCHEDULE API</p><h1>Import runs</h1><p class="subtitle">Vercel Blob 배치 수집 상태와 임시 파일을 확인합니다.</p></div><button id="logout" class="ghost hidden">로그아웃</button></header>
  <section id="login" class="login card"><h2>관리자 인증</h2><p>Vercel에 등록한 ADMIN_TOKEN을 입력하세요. 토큰은 저장되지 않습니다.</p><form id="login-form"><label for="token">ADMIN_TOKEN</label><div class="login-row"><input id="token" name="token" type="password" autocomplete="current-password" required><button type="submit">접속</button></div><p id="login-error" class="error" role="alert"></p></form></section>
  <section id="dashboard" class="hidden"><div class="toolbar"><button id="refresh">새로고침</button><span id="summary"></span></div><div class="layout">
    <div class="card runs"><table><thead><tr><th>Run ID</th><th>상태</th><th>배치</th><th>갱신</th></tr></thead><tbody id="runs"></tbody></table><p id="empty" class="empty hidden">실행 기록이 없습니다.</p></div>
    <aside class="card detail"><div id="detail-empty" class="empty">실행을 선택하세요.</div><div id="detail" class="hidden"><div class="detail-head"><div><span id="detail-status" class="badge"></span><h2 id="detail-run"></h2></div></div><dl id="metadata"></dl><h3>배치 메타데이터</h3><div id="parts"></div><section id="results-section" class="hidden"><h3>최종 결과 파일</h3><div id="result-files"></div><pre id="result-json" class="hidden"></pre></section></div></aside>
  </div></section>
</main><script src="/admin/imports/app.js" defer></script></body></html>`;

export const ADMIN_IMPORTS_JS = `(() => {
  const $ = (id) => document.getElementById(id);
  const login = $('login'), dashboard = $('dashboard'), logout = $('logout');
  const request = async (url, options = {}) => {
    const response = await fetch(url, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    if (response.status === 401) { showLogin(); throw new Error('인증이 필요합니다.'); }
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || '요청에 실패했습니다.');
    return response.json();
  };
  const showLogin = () => { login.classList.remove('hidden'); dashboard.classList.add('hidden'); logout.classList.add('hidden'); };
  const showDashboard = () => { login.classList.add('hidden'); dashboard.classList.remove('hidden'); logout.classList.remove('hidden'); };
  const formatDate = (value) => value ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '-';
  const statusText = (status) => status === 'completed' ? '성공' : '미완료';
  async function loadRuns() {
    const runs = await request('/api/internal/admin/event-imports'); showDashboard();
    $('runs').replaceChildren(); $('empty').classList.toggle('hidden', runs.length > 0); $('summary').textContent = runs.length + '개 실행';
    runs.forEach((run) => {
      const row = document.createElement('tr'); row.tabIndex = 0;
      const values = [run.runId, statusText(run.status), run.uploadedParts.length + ' / ' + run.totalParts, formatDate(run.updatedAt)];
      values.forEach((value, index) => { const cell = document.createElement('td'); cell.textContent = value; if (index === 1) cell.className = 'status ' + run.status; row.append(cell); });
      row.addEventListener('click', () => loadRun(run.runId)); row.addEventListener('keydown', (event) => { if (event.key === 'Enter') loadRun(run.runId); }); $('runs').append(row);
    });
  }
  async function loadRun(runId) {
    const run = await request('/api/internal/admin/event-imports/' + encodeURIComponent(runId));
    $('detail-empty').classList.add('hidden'); $('detail').classList.remove('hidden');
    $('detail-run').textContent = run.runId; $('detail-status').textContent = statusText(run.status); $('detail-status').className = 'badge ' + run.status;
    const metadata = [['상태', statusText(run.status)], ['전체 배치', String(run.totalParts)], ['업로드 배치', String(run.uploadedParts.length)], ['생성', formatDate(run.createdAt)], ['갱신', formatDate(run.updatedAt)], ['임시 파일 삭제', run.temporaryBatchesDeleted === undefined ? '-' : run.temporaryBatchesDeleted ? '완료' : '실패']];
    $('metadata').replaceChildren(); metadata.forEach(([key, value]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value; $('metadata').append(dt, dd); });
    $('parts').replaceChildren();
    $('results-section').classList.add('hidden'); $('result-files').replaceChildren(); $('result-json').classList.add('hidden');
    if (!run.uploadedParts.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = run.status === 'completed' ? '성공한 임시 배치는 삭제되었습니다.' : '업로드된 배치가 없습니다.'; $('parts').append(p); }
    run.uploadedParts.forEach((part) => { const item = document.createElement('div'); item.className = 'part'; item.textContent = 'Part ' + part.part + ' · ' + part.eventCount + '건 · ' + Math.ceil(part.byteLength / 1024) + 'KB'; $('parts').append(item); });
    if (run.status === 'completed') await loadResults(run.runId);
  }
  async function loadResults(runId) {
    const manifest = await request('/api/internal/admin/event-imports/' + encodeURIComponent(runId) + '/results');
    $('results-section').classList.remove('hidden');
    const manifestButton = document.createElement('button'); manifestButton.className = 'file'; manifestButton.textContent = 'manifest.json · ' + manifest.eventCount + '건'; manifestButton.addEventListener('click', () => showResult(manifest)); $('result-files').append(manifestButton);
    Object.entries(manifest.games).forEach(([gameId, game]) => {
      for (let page = 1; page <= game.pageCount; page += 1) {
        const button = document.createElement('button'); button.className = 'file'; button.textContent = gameId + '/page-' + String(page).padStart(4, '0') + '.json';
        button.addEventListener('click', async () => showResult(await request('/api/internal/admin/event-imports/' + encodeURIComponent(runId) + '/results/' + encodeURIComponent(gameId) + '/pages/' + page)));
        $('result-files').append(button);
      }
    });
  }
  function showResult(value) {
    $('result-json').textContent = JSON.stringify(value, null, 2); $('result-json').classList.remove('hidden');
  }
  $('login-form').addEventListener('submit', async (event) => { event.preventDefault(); $('login-error').textContent = ''; const token = $('token').value; try { await request('/api/internal/admin/session', { method: 'POST', body: JSON.stringify({ token }) }); $('token').value = ''; await loadRuns(); } catch (error) { $('login-error').textContent = error.message; } });
  $('refresh').addEventListener('click', () => loadRuns().catch((error) => alert(error.message)));
  logout.addEventListener('click', async () => { await fetch('/api/internal/admin/session', { method: 'DELETE', credentials: 'same-origin' }); showLogin(); });
  request('/api/internal/admin/session').then(loadRuns).catch(() => showLogin());
})();`;

export const ADMIN_IMPORTS_CSS = `:root{color-scheme:dark;--bg:#09111f;--panel:#101b2d;--line:#24334a;--text:#edf4ff;--muted:#91a3bb;--accent:#5eead4;--good:#34d399;--warn:#fbbf24}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 0,#183150 0,transparent 38%),var(--bg);color:var(--text);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}.shell{max-width:1320px;margin:auto;padding:48px 28px}header{display:flex;justify-content:space-between;align-items:start;margin-bottom:28px}.eyebrow{color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.16em;margin:0 0 5px}h1{font-size:38px;letter-spacing:-.04em;margin:0}.subtitle,.login p{color:var(--muted);margin:7px 0 0}.card{background:color-mix(in srgb,var(--panel) 92%,transparent);border:1px solid var(--line);border-radius:16px;box-shadow:0 18px 60px #0004}.login{max-width:560px;margin:90px auto;padding:28px}.login h2{margin:0}.login label{display:block;margin:24px 0 7px;color:var(--muted);font-size:12px;font-weight:700}.login-row{display:flex;gap:10px}input{flex:1;min-width:0;background:#091321;border:1px solid var(--line);border-radius:9px;color:var(--text);padding:11px 13px}button{border:0;border-radius:9px;background:var(--accent);color:#06221e;font-weight:800;padding:10px 15px;cursor:pointer}button:hover{filter:brightness(1.08)}.ghost{background:transparent;color:var(--muted);border:1px solid var(--line)}.toolbar{display:flex;align-items:center;gap:14px;margin-bottom:14px}.toolbar span{color:var(--muted)}.layout{display:grid;grid-template-columns:minmax(560px,1.35fr) minmax(340px,.65fr);gap:16px}.runs{overflow:hidden}.runs table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:14px 16px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}tbody tr{cursor:pointer}tbody tr:hover,tbody tr:focus{background:#17263c;outline:none}.status.completed,.badge.completed{color:var(--good)}.status.uploading,.badge.uploading{color:var(--warn)}.detail{padding:22px;min-height:380px}.detail h2{font-size:22px;margin:5px 0 20px;overflow-wrap:anywhere}.badge{display:inline-block;font-size:11px;font-weight:900;text-transform:uppercase}.detail dl{display:grid;grid-template-columns:120px 1fr;margin:0 0 26px}.detail dt,.detail dd{padding:7px 0;border-bottom:1px solid var(--line)}.detail dt{color:var(--muted)}.detail dd{margin:0;text-align:right}.detail h3{font-size:13px;color:var(--muted);margin-top:24px}.part{display:block;width:100%;margin:8px 0;padding:10px 12px;border-radius:9px;background:#182940;color:var(--text);font-weight:600}.file{display:block;width:100%;margin:8px 0;text-align:left;background:#172f3e;color:var(--accent);font-weight:700}.empty{color:var(--muted);padding:24px;text-align:center}.error{color:#fb7185;min-height:20px}pre{max-height:520px;overflow:auto;margin-top:12px;padding:12px;border:1px solid var(--line);border-radius:9px;background:#07101d;color:#c8d8ec;font:11px/1.5 ui-monospace,SFMono-Regular,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.hidden{display:none!important}@media(max-width:900px){.shell{padding:28px 16px}.layout{grid-template-columns:1fr}.runs{overflow:auto}h1{font-size:30px}}`;
