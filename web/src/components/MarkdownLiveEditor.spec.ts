// @vitest-environment jsdom
import { history, undo } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { executeMarkdownCommand } from './MarkdownLiveEditor';

const views: EditorView[] = [];

function editor(doc: string, anchor = 0, head = anchor) {
  const view = new EditorView({
    state: EditorState.create({ doc, selection: EditorSelection.range(anchor, head), extensions: [history()] }),
  });
  views.push(view);
  return view;
}

afterEach(() => {
  while (views.length) views.pop()!.destroy();
});

describe('Markdown writing commands', () => {
  it('inserts bold markers around an empty selection and remains undoable', () => {
    const view = editor('');
    executeMarkdownCommand(view, { type: 'bold' });
    expect(view.state.doc.toString()).toBe('****');
    expect(view.state.selection.main.head).toBe(2);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('');
  });

  it('wraps selected text and keeps the original text selected', () => {
    const view = editor('重点内容', 0, 4);
    executeMarkdownCommand(view, { type: 'bold' });
    expect(view.state.doc.toString()).toBe('**重点内容**');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('重点内容');
  });

  it('places the link cursor in the label or URL according to the selection', () => {
    const empty = editor('');
    executeMarkdownCommand(empty, { type: 'link' });
    expect(empty.state.doc.toString()).toBe('[]()');
    expect(empty.state.selection.main.head).toBe(1);

    const selected = editor('官网', 0, 2);
    executeMarkdownCommand(selected, { type: 'link' });
    expect(selected.state.doc.toString()).toBe('[官网]()');
    expect(selected.state.selection.main.head).toBe(5);
  });

  it('replaces an existing heading and toggles quote/list prefixes across lines', () => {
    const heading = editor('### 标题\n正文', 3);
    executeMarkdownCommand(heading, { type: 'heading', level: 2 });
    expect(heading.state.doc.toString()).toBe('## 标题\n正文');

    const quote = editor('第一行\n第二行', 0, 7);
    executeMarkdownCommand(quote, { type: 'quote' });
    expect(quote.state.doc.toString()).toBe('> 第一行\n> 第二行');
    executeMarkdownCommand(quote, { type: 'quote' });
    expect(quote.state.doc.toString()).toBe('第一行\n第二行');

    const list = editor('甲\n乙', 0, 3);
    executeMarkdownCommand(list, { type: 'unordered-list' });
    expect(list.state.doc.toString()).toBe('- 甲\n- 乙');
  });

  it('wraps every selected line as inline code', () => {
    const content = 'const a = 1\nconst b = 2';
    const view = editor(content, 0, content.length);
    executeMarkdownCommand(view, { type: 'inline-code' });
    expect(view.state.doc.toString()).toBe('`const a = 1`\n`const b = 2`');
  });
});
