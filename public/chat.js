const textContent = content => Array.isArray(content) ? content.filter(part => part?.type === 'text').map(part => part.text || '').join('\n') : '';
export function createChat(target) {
  let assistant, buffered = '';
  function bubble(label, text, kind) {
    const article = document.createElement('article'); article.className = `chat-message ${kind}`;
    const title = document.createElement('strong'); title.textContent = label;
    const body = document.createElement('p'); body.textContent = text;
    article.append(title, body); target.append(article); return body;
  }
  function update(text) {
    if (!assistant) return;
    const follows = target.scrollHeight - target.scrollTop - target.clientHeight < 120;
    assistant.textContent = String(text).slice(-16000);
    if (follows) target.scrollTop = target.scrollHeight;
  }
  return {
    render(info, name) {
      target.replaceChildren(); buffered = ''; assistant = null;
      for (const turn of info.turns) {
        bubble(`Tú · mensaje ${turn.number}`, turn.prompt, 'user');
        assistant = bubble(name, turn.response || (turn.state === 'running' ? 'El agente está trabajando…' : 'Sin respuesta guardada.'), 'assistant');
      }
      target.scrollTop = target.scrollHeight;
    },
    reset() { buffered = ''; },
    stdout(text) {
      buffered += text;
      let index;
      while ((index = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, index); buffered = buffered.slice(index + 1);
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'message_start' && event.message?.role === 'assistant') update('');
        else if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') update((assistant?.textContent || '') + (event.assistantMessageEvent.delta || ''));
        else if (event.type === 'message_end' && event.message?.role === 'assistant') { const text = textContent(event.message.content); if (text) update(text); }
        else if (['message_text', 'text'].includes(event.type)) update(event.part?.text || '');
      }
      if (buffered.length > 2_000_000) buffered = '';
    },
    clear() { target.replaceChildren(); assistant = null; buffered = ''; },
  };
}
