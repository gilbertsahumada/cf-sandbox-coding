const $ = id => document.getElementById(id);
const names = { pi: 'Pi', opencode: 'OpenCode' };
const labels = { cloning: 'Preparando', running: 'En curso', succeeded: 'Completada', failed: 'Falló', lost: 'Entorno perdido', none: 'Sin tarea' };
let connected = false;
let selected = null;
let generation = 0;
let diff = '';
let busy = false;
let history = [];
try { history = JSON.parse(localStorage.getItem('sandbox-runs') || '[]'); if (!Array.isArray(history)) history = []; history = history.filter(run => typeof run.id === 'string' && /^[a-z0-9-]{1,63}$/.test(run.id) && names[run.agent] && typeof run.repository === 'string').slice(0, 12); } catch { history = []; }
// A closed tab cannot finish submitting a task that was still cloning.
for (const run of history) if (run.state === 'cloning') { run.state = 'failed'; run.finishedAt ||= Date.now(); }
function saveHistory() { try { localStorage.setItem('sandbox-runs', JSON.stringify(history.filter(run => !run.private))); } catch {} renderHistory(); }
function showNotice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
function setConnected(value) {
  connected = value;
  $('connection').classList.toggle('connected', value);
  $('connection-label').textContent = value ? 'Conectado · salir' : 'Conectar';
  updateSubmit();
  if (value) refreshGitHub(); else clearGitHub();
}
function updateSubmit() {
  const running = history.some(run => ['cloning', 'running'].includes(run.state));
  $('submit-task').disabled = busy || running;
  $('submit-task').querySelector('span').textContent = busy || running ? 'Tarea en curso…' : 'Ejecutar tarea';
}
function authDialog() { $('auth-error').hidden = true; if (!$('auth-dialog').open) $('auth-dialog').showModal(); }
async function api(path, body, method, signal) {
  let response;
  try { response = await fetch(path, { method: method || (body ? 'POST' : 'GET'), credentials: 'same-origin', cache: 'no-store', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: signal || AbortSignal.timeout(180000) }); }
  catch (error) { if (error.name === 'AbortError') throw error; throw new Error('No pudimos conectar con el runner. Revisa tu conexión e inténtalo de nuevo.'); }
  if (response.status === 401) { setConnected(false); authDialog(); throw new Error('Tu sesión terminó. Conecta de nuevo para continuar.'); }
  if (!response.ok) {
    const text = await response.text();
    let detail = '';
    try { const data = JSON.parse(text); detail = data.message || data.stderr || data.error?.[0]?.message || ''; } catch {}
    throw new Error(detail || ({ 403: 'La solicitud fue rechazada. Recarga la página y vuelve a conectar.', 409: 'Este entorno ya tiene una tarea. Crea una nueva.', 410: 'El entorno ya no está disponible y no tiene cambios guardados.', 413: 'La instrucción es demasiado larga.', 500: 'La operación falló en el servidor. Puedes intentar con una tarea nueva.', 503: 'El proveedor de modelos no está configurado.' }[response.status]) || `La solicitud falló (${response.status}).`);
  }
  return response;
}
$('auth-form').addEventListener('submit', async event => {
  event.preventDefault(); $('auth-submit').disabled = true; $('auth-error').hidden = true;
  try {
    const response = await fetch('/session', { method: 'POST', credentials: 'same-origin', headers: { authorization: `Bearer ${$('access-token').value.trim()}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(response.status === 401 ? 'El token no es correcto. Usa RUNNER_API_TOKEN, no la clave de Qwen.' : 'No pudimos conectar. Vuelve a intentarlo.');
    $('access-token').value = ''; $('auth-dialog').close(); setConnected(true); showNotice('');
    if (selected) selectRun(selected);
  } catch (error) { $('auth-error').textContent = error.message; $('auth-error').hidden = false; }
  finally { $('auth-submit').disabled = false; }
});
$('auth-cancel').addEventListener('click', () => { $('access-token').value = ''; $('auth-dialog').close(); });
$('auth-dialog').addEventListener('close', () => { $('access-token').value = ''; });
$('connection').addEventListener('click', async () => {
  if (!connected) return authDialog();
  try { await api('/session', undefined, 'DELETE'); generation++; selected = null; history = history.filter(run => !run.private); saveHistory(); setConnected(false); $('result').hidden = true; $('result-text').textContent = ''; $('activity-output').replaceChildren(); $('activity-output').hidden = true; $('empty-state').hidden = false; $('progress').hidden = true; $('run-meta').hidden = true; $('workspace-title').textContent = 'Conecta para continuar'; $('task-state').className = 'state neutral'; $('task-state').textContent = 'Sin conexión'; $('activity-count').textContent = '0'; renderDiff(''); selectTab('activity'); renderHistory(); showNotice('Sesión cerrada. Las tareas en ejecución continúan en su sandbox.'); }
  catch (error) { showNotice(error.message); }
});
function renderHistory() {
  $('history').replaceChildren(); $('no-history').hidden = history.length > 0;
  for (const run of history) {
    const li = document.createElement('li'); const button = document.createElement('button'); button.type = 'button';
    if (selected?.id === run.id) { button.classList.add('selected'); button.setAttribute('aria-current', 'true'); }
    const dot = document.createElement('span'); dot.className = `dot ${run.state}`;
    const label = document.createElement('span'); label.className = 'history-label';
    const title = document.createElement('strong'); title.textContent = run.repository.replace('https://github.com/', '');
    const small = document.createElement('small'); small.textContent = `${names[run.agent]} · ${labels[run.state] || 'Pendiente'}`;
    label.append(title, small); button.append(dot, label); button.addEventListener('click', () => { selectRun(run); $('workspace-title').scrollIntoView({ block: 'start' }); }); li.append(button); $('history').append(li);
  }
}
function state(run) {
  $('task-state').className = `state ${run.state}`; $('task-state').textContent = labels[run.state] || run.state;
  for (const [index, item] of [...$('progress').children].entries()) {
    const current = run.state === 'cloning' ? 0 : run.state === 'running' ? 1 : 2;
    item.className = index < current ? 'complete' : index === current ? 'active' : '';
    item.querySelector('span').textContent = index < current ? '✓' : String(index + 1);
  }
  saveHistory(); updateSubmit();
}
function elapsed(run) {
  const seconds = Math.max(0, Math.floor(((run.finishedAt || Date.now()) - run.startedAt) / 1000));
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
}
setInterval(() => { if (selected) $('run-time').textContent = elapsed(selected); }, 1000);
function addLine(container, text, kind = '') {
  const line = document.createElement('div'); line.className = `log-line ${kind}`; line.textContent = text; container.append(line);
}
function activity(stdout = '', stderr = '', run = selected) {
  const target = $('activity-output'); const previous = target.scrollTop;
  target.replaceChildren(); $('empty-state').hidden = true; target.hidden = false;
  addLine(target, `${names[run.agent]} · ${labels[run.state] || run.state} · ${run.id}`, 'system');
  let count = 0;
  for (const [index, raw] of stdout.split('\n').entries()) {
    if (!raw.trim()) continue;
    let event; try { event = JSON.parse(raw); } catch { if (index === 0 && !raw.startsWith('{')) { addLine(target, 'Mostrando la salida más reciente…', 'system'); continue; } addLine(target, raw); count++; continue; }
    if (!event || typeof event !== 'object') { addLine(target, raw); count++; continue; }
    const message = event.message;
    if (event.type === 'tool_execution_start') { addLine(target, `${event.toolName || 'herramienta'}  ${JSON.stringify(event.args || {})}`, 'tool'); count++; }
    else if (event.type === 'tool_execution_end') { const content = Array.isArray(event.result?.content) ? event.result.content.filter(block => block?.type === 'text').map(block => block.text).join('\n') : ''; addLine(target, content || (event.isError ? 'La herramienta falló.' : 'Herramienta completada.'), event.isError ? 'error' : ''); count++; }
    else if (event.type === 'message_end' && message?.role === 'assistant') { const text = Array.isArray(message.content) ? message.content.filter(block => block?.type === 'text').map(block => block.text).join('\n') : ''; if (text) { addLine(target, text, 'result'); count++; } if (message.errorMessage) addLine(target, message.errorMessage, 'error'); }
    else if (event.type === 'text') { addLine(target, event.part?.text || '', 'result'); count++; }
    else if (event.type === 'error') { addLine(target, event.error?.data?.message || event.error?.name || 'Error del agente', 'error'); count++; }
    else if (event.type === 'tool_use') { addLine(target, `${event.part?.tool || 'herramienta'}  ${JSON.stringify(event.part?.state?.input || {})}`, 'tool'); count++; }
  }
  if (stderr.trim()) { addLine(target, 'Salida del proceso', 'system'); addLine(target, stderr); }
  if (!stdout.trim() && !stderr.trim()) addLine(target, run.state === 'cloning' ? 'Preparando el entorno y clonando el repositorio…' : 'Esperando la primera salida del agente…', 'system');
  $('activity-count').textContent = String(count);
  if ($('follow').checked) target.scrollTop = target.scrollHeight; else target.scrollTop = previous;
}
function renderDiff(text) {
  diff = text; const target = $('diff-output'); const previous = target.scrollTop;
  target.replaceChildren(); target.hidden = !text; $('diff-empty').hidden = Boolean(text); $('download-diff').hidden = !text || $('tab-changes').getAttribute('aria-selected') !== 'true';
  $('changes-count').textContent = String((text.match(/^diff --git /gm) || []).length);
  const fragment = document.createDocumentFragment();
  for (const raw of text.split('\n')) {
    const line = document.createElement('div'); line.textContent = raw || ' ';
    line.className = 'diff-line' + (raw.startsWith('diff --git') ? ' file' : raw.startsWith('@@') ? ' hunk' : raw.startsWith('+') && !raw.startsWith('+++') ? ' add' : raw.startsWith('-') && !raw.startsWith('---') ? ' remove' : ''); fragment.append(line);
  }
  target.append(fragment); target.scrollTop = previous;
}
function selectTab(name, focus = false) {
  for (const key of ['activity', 'changes']) { const active = key === name; $(`tab-${key}`).setAttribute('aria-selected', String(active)); $(`tab-${key}`).tabIndex = active ? 0 : -1; $(`panel-${key}`).hidden = !active; }
  $('follow-control').hidden = name !== 'activity'; $('download-diff').hidden = name !== 'changes' || !diff;
  if (focus) $(`tab-${name}`).focus();
}
for (const name of ['activity', 'changes']) {
  $(`tab-${name}`).addEventListener('click', () => selectTab(name));
  $(`tab-${name}`).addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); selectTab(event.key === 'Home' ? 'activity' : event.key === 'End' ? 'changes' : name === 'activity' ? 'changes' : 'activity', true); } });
}
$('download-diff').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([diff], { type: 'text/plain;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `${selected?.id || 'changes'}.patch`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
async function selectRun(run) {
  selected = run; const ticket = ++generation;
  $('workspace-title').textContent = run.repository.replace('https://github.com/', ''); $('run-meta').hidden = false; $('run-agent').textContent = names[run.agent]; $('run-repository').textContent = run.ref || 'Rama predeterminada'; $('run-time').textContent = elapsed(run); $('progress').hidden = false; $('result').hidden = true;
  showNotice(''); state(run); renderDiff(''); activity('', '', run);
  if (!connected || run.state === 'cloning') return;
  while (ticket === generation && connected) {
    try {
      const status = await (await api(`/sandboxes/${run.id}/task`)).json();
      if (status.state === 'none') { status.state = 'lost'; status.error = 'La tarea no llegó a iniciarse. Crea una nueva para volver a intentarlo.'; }
      const logs = await (await api(`/sandboxes/${run.id}/logs`)).json();
      if (ticket !== generation) return;
      if (status.state !== 'none') run.state = status.state;
      if (!['running', 'none'].includes(status.state)) run.finishedAt ||= Date.now();
      state(run); activity(logs.stdout, logs.stderr, run); showNotice('');
      if (status.result || status.error) { $('result').hidden = false; $('result-text').textContent = status.result || status.error; }
      try { const text = await (await api(`/sandboxes/${run.id}/diff`)).text(); if (ticket === generation) renderDiff(text); } catch (error) { if (['succeeded', 'failed', 'lost'].includes(run.state)) showNotice(error.message); }
      if (!['running', 'none'].includes(status.state)) { if (status.state === 'lost') showNotice('El entorno se detuvo antes de guardar el resultado. Crea una nueva tarea para intentarlo de nuevo.'); return; }
    } catch (error) { if (ticket !== generation) return; showNotice(error.message + (connected ? ' Volveremos a consultar automáticamente.' : '')); if (!connected) return; }
    await new Promise(resolve => setTimeout(resolve, 3500));
  }
}
$('task-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!connected) return authDialog(); if (busy || history.some(run => ['cloning', 'running'].includes(run.state))) return;
  let repository; try { repository = new URL($('repository').value); } catch { return showNotice('Conecta GitHub y elige un repositorio.'); }
  if (repository.protocol !== 'https:' || repository.hostname !== 'github.com' || repository.username || repository.password || repository.port || repository.search || repository.hash || !/^\/[\w.-]+\/[\w.-]+\/?$/.test(repository.pathname)) return showNotice('Usa https://github.com/usuario/repositorio, sin credenciales ni parámetros.');
  const prompt = $('prompt').value.trim(); if (!prompt) return showNotice('Describe la tarea antes de ejecutarla.');
  const agent = new FormData($('task-form')).get('agent');
  const run = { id: `${agent}-${crypto.randomUUID()}`, agent, private: repositories.find(repo => repo.url === repository.href)?.private || false, repository: repository.href, ref: $('ref').value.trim(), startedAt: Date.now(), state: 'cloning' };
  busy = true; history.unshift(run); history = history.slice(0, 12); selectTab('activity'); selectRun(run); updateSubmit(); $('workspace-title').scrollIntoView({ block: 'start' });
  try {
    const chosen = repositories.find(repo => repo.url === run.repository);
    await api(`/sandboxes/${run.id}/repository`, { ...(chosen ? { installationId: chosen.installationId, repositoryId: chosen.repositoryId } : { url: run.repository }), ...(run.ref ? { ref: run.ref } : {}) });
    await api(`/sandboxes/${run.id}/task`, { agent, prompt });
    run.state = 'running'; busy = false; saveHistory(); updateSubmit(); selectRun(run);
  } catch (error) { run.state = 'failed'; run.finishedAt = Date.now(); busy = false; state(run); showNotice(error.message); activity('', error.message, run); }
});
$('new-task').addEventListener('click', () => { generation++; selected = null; renderHistory(); $('workspace-title').textContent = 'Todo listo para empezar'; $('task-state').className = 'state neutral'; $('task-state').textContent = 'Sin tarea'; $('run-meta').hidden = true; $('progress').hidden = true; $('result').hidden = true; $('activity-output').hidden = true; $('empty-state').hidden = false; $('activity-count').textContent = '0'; renderDiff(''); showNotice(''); selectTab('activity'); $('prompt').focus(); const pending = history.find(run => ['cloning', 'running'].includes(run.state)); if (pending) { showNotice('Hay una tarea en curso. Selecciónala en Tareas recientes para seguirla.'); selectRun(pending); } });
$('example').addEventListener('click', () => { if (![...$('repository').options].some(option => option.value === 'https://github.com/octocat/Hello-World')) { const option = document.createElement('option'); option.value = 'https://github.com/octocat/Hello-World'; option.textContent = 'Público · octocat/Hello-World (ejemplo)'; $('repository').append(option); } $('repository').disabled = false; $('repository').value = 'https://github.com/octocat/Hello-World'; $('prompt').value = 'Crea un archivo NOTES.md con un breve resumen del repositorio. Comprueba que el archivo existe. No hagas commit.'; $('prompt').focus(); });

let repositories = [];
let repositoryPage = 1;
let githubGeneration = 0;
function githubError(message) { $('github-error').textContent = message; $('github-error').hidden = !message; }
function clearGitHub() {
  githubGeneration++; repositories = []; $('github-status').textContent = 'Sin conectar';
  $('github-description').textContent = 'Elige repositorios públicos y privados de tu cuenta.';
  $('github-connect').hidden = false; $('github-actions').hidden = true;
  $('repository').replaceChildren(new Option('Conecta GitHub para elegir', ''));
  $('repository').disabled = true; $('repository-search').disabled = true; $('repository-search').value = '';
  $('github-load-more').hidden = true; $('repository-hint').textContent = 'Solo los repositorios que autorices en GitHub.';
}
function renderRepositories() {
  const selectedUrl = $('repository').value;
  const query = $('repository-search').value.toLocaleLowerCase().trim();
  const matches = repositories.filter(repo => repo.fullName.toLocaleLowerCase().includes(query));
  $('repository').replaceChildren(new Option(matches.length ? 'Elige un repositorio…' : query ? 'No hay coincidencias' : 'No hay repositorios autorizados', ''));
  for (const repo of matches.sort((a, b) => a.fullName.localeCompare(b.fullName))) $('repository').append(new Option(`${repo.private ? 'Privado' : 'Público'} · ${repo.fullName}`, repo.url));
  if (matches.some(repo => repo.url === selectedUrl)) $('repository').value = selectedUrl;
  $('repository').disabled = matches.length === 0;
  $('repository-hint').textContent = `${matches.length} repositorio${matches.length === 1 ? '' : 's'} disponible${matches.length === 1 ? '' : 's'}. El agente trabajará con Qwen.`;
}
async function loadRepositories(append = false, ticket = githubGeneration) {
  $('github-load-more').disabled = true;
  const page = append ? repositoryPage + 1 : 1;
  try {
    const data = await (await api(`/github/repositories?page=${page}`)).json();
    if (ticket !== githubGeneration || !connected) return;
    repositoryPage = page;
    const items = append ? [...repositories, ...data.repositories] : data.repositories;
    repositories = [...new Map(items.map(repo => [repo.url, repo])).values()];
    $('repository-search').disabled = false; $('github-load-more').hidden = !data.hasMore;
    renderRepositories(); githubError('');
  } catch (error) { if (ticket === githubGeneration) githubError(error.message); }
  finally { $('github-load-more').disabled = false; }
}
async function refreshGitHub() {
  const ticket = ++githubGeneration;
  try {
    const response = await (await api('/github/status')).json();
    if (ticket !== githubGeneration || !connected) return;
    if (!response.connected) { clearGitHub(); return; }
    $('github-status').textContent = response.accounts.join(', ');
    $('github-description').textContent = 'Acceso de lectura a los repositorios autorizados.';
    $('github-connect').hidden = true; $('github-actions').hidden = false;
    await loadRepositories(false, ticket);
  } catch (error) { if (ticket === githubGeneration) githubError(error.message); }
}
async function connectGitHub() {
  if (!connected) return authDialog();
  $('github-connect').disabled = true; $('github-manage').disabled = true; githubError('');
  try {
    const data = await (await api('/github/connect', {})).json();
    if (data.url) { window.location.assign(data.url); return; }
    const form = document.createElement('form'); form.method = 'POST'; form.action = data.action;
    const manifest = document.createElement('input'); manifest.type = 'hidden'; manifest.name = 'manifest'; manifest.value = JSON.stringify(data.manifest);
    form.append(manifest); document.body.append(form); form.submit();
  } catch (error) { githubError(error.message); }
  finally { $('github-connect').disabled = false; $('github-manage').disabled = false; }
}
$('github-connect').addEventListener('click', connectGitHub);
$('github-manage').addEventListener('click', connectGitHub);
$('github-disconnect').addEventListener('click', async () => {
  $('github-disconnect').disabled = true;
  try {
    const data = await (await api('/github/connection', undefined, 'DELETE')).json();
    clearGitHub();
    if (data.warning) githubError(data.warning);
  } catch (error) { githubError(error.message); }
  finally { $('github-disconnect').disabled = false; }
});
$('repository-search').addEventListener('input', renderRepositories);
$('github-load-more').addEventListener('click', () => loadRepositories(true));
$('repository').addEventListener('change', () => { const repo = repositories.find(item => item.url === $('repository').value); if (repo) $('ref').placeholder = repo.defaultBranch || 'Rama predeterminada'; });
renderHistory();
(async () => {
  try { const response = await fetch('/session', { cache: 'no-store', credentials: 'same-origin' }); setConnected(response.ok); } catch { setConnected(false); showNotice('No pudimos comprobar la conexión con el runner.'); }
  if (history.length) selectRun(history[0]);
})();
