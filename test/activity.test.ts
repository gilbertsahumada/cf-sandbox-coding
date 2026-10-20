import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser renderer tested with a minimal document transport.
import { createActivity } from '../web/lib/activity.js';
class Node {
  childNodes: Node[] = []; parentNode: Node | null = null; className = ''; value = ''; scrollTop = 0;
  get scrollHeight() { return this.childNodes.length; }
  get textContent(): string { return this.value + this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value: string) { this.value = value; }
  append(node: Node) { node.parentNode = this; this.childNodes.push(node); }
  replaceChildren() { for (const node of this.childNodes) node.parentNode = null; this.childNodes = []; }
  remove() { if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter(node => node !== this); this.parentNode = null; }
}
function fixture(archived: boolean) {
  const previous = (globalThis as any).document;
  (globalThis as any).document = { createElement: () => new Node() };
  const target = new Node();
  return { target, activity: createActivity(target, { agent: 'pi', id: 'pi-test', state: 'succeeded' }, {}, { checked: false }, { archived }), dispose: () => { (globalThis as any).document = previous; } };
}
test('a clipped archived event is explained neutrally while valid following tool output remains visible', () => {
  const f = fixture(true);
  try {
    f.activity.stdout('clipped-json-fragment\n' + JSON.stringify({ type: 'tool_execution_end', toolCallId: '1', result: { content: [{ type: 'text', text: 'NOTES.md exists' }] } }).slice(0, 30));
    f.activity.stdout(JSON.stringify({ type: 'tool_execution_end', toolCallId: '1', result: { content: [{ type: 'text', text: 'NOTES.md exists' }] } }).slice(30) + '\n');
    assert.match(f.target.textContent, /Archived logs.*latest 32 KB/);
    assert.match(f.target.textContent, /incomplete entry at the start of this archived log was skipped/);
    assert.match(f.target.textContent, /NOTES.md exists/);
    assert.ok(!f.target.textContent.includes('Partial output unavailable'));
    assert.ok(!f.target.childNodes.some(node => node.className === 'log-line error'));
  } finally { f.dispose(); }
});
test('a real tool failure remains an error even when its logs are archived', () => {
  const f = fixture(true);
  try {
    f.activity.stdout(JSON.stringify({ type: 'tool_execution_end', toolCallId: '1', isError: true, result: { content: [{ type: 'text', text: 'Command failed' }] } }) + '\n');
    assert.ok(f.target.childNodes.some(node => node.className === 'log-line error' && node.textContent === 'Command failed'));
  } finally { f.dispose(); }
});
