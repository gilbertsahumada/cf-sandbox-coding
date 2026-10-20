const textBlocks = value => Array.isArray(value) ? value.filter(block => block?.type === 'text').map(block => block.text || '').join('\n') : '';
export function createActivity(target, run, count, follow, { archived = false } = {}) {
  target.replaceChildren();
  const title = document.createElement('div'); title.className = 'log-line system'; title.textContent = `${run.agent === 'pi' ? 'Pi' : 'OpenCode'} · ${run.id}`; target.append(title);
  const waiting = document.createElement('div'); waiting.className = 'log-line system'; waiting.textContent = run.state === 'cloning' ? 'Preparing the workspace and cloning the repository…' : 'Waiting for the first agent output…'; target.append(waiting);
  let buffered = '', total = 0, stderr = null, dirty = false;
  const nodes = new Map();
  const add = (text, kind = '', key) => {
    waiting.remove();
    let node = key ? nodes.get(key) : null;
    if (!node || node.parentNode !== target) {
      node = document.createElement('div'); node.className = `log-line ${kind}`; target.append(node); total++; count.textContent = String(total);
      if (key) nodes.set(key, node);
    }
    node.textContent = String(text).slice(-64000);
    return node;
  };
  const changed = () => {
    // Keep the view bounded without retaining private output in browser storage.
    while (target.childNodes.length > 350 || (target.textContent.length > 256000 && target.childNodes.length > 2)) target.childNodes[1].remove();
    for (const [key, node] of nodes) if (node.parentNode !== target) nodes.delete(key);
    if (follow.checked) target.scrollTop = target.scrollHeight;
  };
  let firstEntry = true;
  const line = raw => {
    if (!raw.trim()) return;
    let event;
    try { event = JSON.parse(raw); } catch {
      add(archived && firstEntry ? 'One incomplete entry at the start of this archived log was skipped. Task status is shown separately.' : 'A log entry could not be displayed. Check the session status for the task result.', 'system', 'partial');
      firstEntry = false; return;
    }
    firstEntry = false;
    if (!event || typeof event !== 'object') return;
    const toolKey = `tool:${event.toolCallId || event.toolName || 'unknown'}`;
    if (event.type === 'tool_execution_start') add(`${event.toolName || 'tool'}  ${JSON.stringify(event.args || {})}`, 'tool', `${toolKey}:start`);
    else if (event.type === 'tool_execution_update') add(textBlocks(event.partialResult?.content) || 'Running…', '', toolKey);
    else if (event.type === 'tool_execution_end') { add(textBlocks(event.result?.content) || (event.isError ? 'Tool failed.' : 'Tool completed.'), event.isError ? 'error' : '', toolKey); dirty = true; }
    else if (event.type === 'message_end' && event.message?.errorMessage) add(event.message.errorMessage, 'error');
    else if (event.type === 'error') add(event.error?.data?.message || event.error?.name || 'Agent error', 'error');
    // Other agent events can contain internal model state; only render explicit activity.
  };
  count.textContent = '0';
  if (archived) add('Archived logs — latest 32 KB per output channel. Earlier entries may be omitted. This notice does not indicate a task failure.', 'system');
  return {
    stdout(text) {
      dirty = false;
      buffered += text;
      let boundary;
      while ((boundary = buffered.indexOf('\n')) >= 0) { line(buffered.slice(0, boundary)); buffered = buffered.slice(boundary + 1); }
      if (buffered.length > 2_000_000) { buffered = ''; add('An oversized event was skipped.', 'system'); }
      changed();
      return dirty;
    },
    stderr(text) {
      if (!stderr || stderr.parentNode !== target) stderr = add('', 'error');
      stderr.textContent = (stderr.textContent + text).slice(-64000); changed();
    },
    finish() { if (buffered.trim()) line(buffered); buffered = ''; changed(); },
    note(text) { add(text, 'system'); changed(); },
  };
}
