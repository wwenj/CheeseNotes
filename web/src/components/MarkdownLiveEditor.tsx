import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, Range } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { notesApi, type NoteSummary } from '../api';
import { fileKind, resolveVaultPath } from '../lib/files';
import { cachedAssetSource } from '../lib/workspace-cache';

type MarkerRange = { from: number; to: number };
type ImagePreview = { alt: string; src: string };
type ImageLine = ImagePreview & { from: number; to: number };
export type LiveListMarker = {
  kind: 'unordered' | 'ordered' | 'task';
  level: number;
  from: number;
  to: number;
  number?: string;
  checked?: boolean;
};

const hiddenMarker = Decoration.replace({});
const visibleMarker = Decoration.mark({ class: 'cm-md-syntax' });
const visibleListMarker = Decoration.mark({ class: 'cm-md-syntax cm-md-list-syntax' });
const visibleStrongMarker = Decoration.mark({ class: 'cm-md-syntax cm-md-strong' });
const visibleEmphasisMarker = Decoration.mark({ class: 'cm-md-syntax cm-md-emphasis' });
const visibleStrikethroughMarker = Decoration.mark({ class: 'cm-md-syntax cm-md-strikethrough' });
const visibleCodeMarker = Decoration.mark({ class: 'cm-md-syntax cm-md-code' });
const visibleHeadingMarkers = Array.from({ length: 6 }, (_, index) => Decoration.mark({ class: `cm-md-syntax cm-md-heading-${index + 1}` }));

class ImagePreviewWidget extends WidgetType {
  private release = () => {};

  constructor(private readonly image: ImagePreview, private readonly position: number) { super(); }

  eq(other: ImagePreviewWidget) { return other.image.src === this.image.src && other.image.alt === this.image.alt && other.position === this.position; }

  ignoreEvent() { return false; }

  toDOM() {
    const wrapper = document.createElement('figure');
    wrapper.className = 'cm-image-preview';
    wrapper.dataset.imageFrom = String(this.position);
    const image = document.createElement('img');
    image.alt = this.image.alt;
    image.loading = 'lazy';
    image.addEventListener('error', () => { wrapper.classList.add('is-broken'); });
    wrapper.append(image);
    if (!this.image.src.startsWith(notesApi.fileUrl(''))) {
      image.src = this.image.src;
      return wrapper;
    }
    void cachedAssetSource(this.image.src).then((result) => {
      this.release = result.release;
      image.src = result.source;
    }).catch(() => {
      image.src = this.image.src;
    });
    return wrapper;
  }

  destroy() { this.release(); }
}

class ListMarkerWidget extends WidgetType {
  constructor(private readonly marker: LiveListMarker) { super(); }

  eq(other: ListMarkerWidget) {
    return other.marker.kind === this.marker.kind
      && other.marker.level === this.marker.level
      && other.marker.number === this.marker.number
      && other.marker.checked === this.marker.checked;
  }

  toDOM() {
    const wrapper = document.createElement('span');
    wrapper.className = `cm-live-list-marker cm-live-${this.marker.kind}-marker cm-live-list-level-${Math.min(this.marker.level, 3)}`;
    wrapper.setAttribute('aria-hidden', 'true');

    if (this.marker.kind === 'ordered') {
      wrapper.textContent = `${this.marker.number}.`;
      return wrapper;
    }

    if (this.marker.kind === 'task') {
      const checkbox = document.createElement('span');
      checkbox.className = this.marker.checked ? 'cm-live-task-checkbox is-checked' : 'cm-live-task-checkbox';
      checkbox.textContent = this.marker.checked ? '✓' : '';
      wrapper.append(checkbox);
      return wrapper;
    }

    const glyph = document.createElement('span');
    glyph.className = 'cm-live-list-glyph';
    wrapper.append(glyph);
    return wrapper;
  }
}

export function imagePreviewForLine(line: string, sourcePath: string, files: NoteSummary[]): ImagePreview | null {
  const value = line.trim();
  let alt = '';
  let rawReference = '';
  const markdownImage = value.match(/^!\[([^\]]*)\]\((.+)\)$/);
  const obsidianImage = value.match(/^!\[\[([^\]]+)\]\]$/);

  if (markdownImage) { alt = markdownImage[1]; rawReference = markdownImage[2].trim().replace(/^<|>$/g, ''); }
  else if (obsidianImage) { rawReference = obsidianImage[1]; alt = rawReference.split('|')[0].split('#')[0].split('/').at(-1) ?? ''; }
  else return null;

  if (/^(https?:|data:)/i.test(rawReference)) return { alt, src: rawReference };
  const path = resolveVaultPath(rawReference, sourcePath, files.map((file) => file.path));
  const file = path ? files.find((item) => item.path === path) : undefined;
  return path && fileKind(path) === 'image' ? { alt, src: notesApi.fileUrl(path, file?.assetVersion) } : null;
}

export function listMarkerForLine(line: string): LiveListMarker | null {
  const match = line.match(/^([ \t]*)(?:([-*+])[ \t]+(\[([ xX])\][ \t]+)?|(\d+)[.)][ \t]+)/);
  if (!match) return null;

  const indentation = match[1].replace(/\t/g, '    ').length;
  const from = match[1].length;
  const to = match[0].length;
  const level = Math.floor(indentation / 4) + 1;

  if (match[5]) return { kind: 'ordered', level, from, to, number: match[5] };
  if (match[3]) return { kind: 'task', level, from, to, checked: match[4]?.toLowerCase() === 'x' };
  return { kind: 'unordered', level, from, to };
}

const markdownHighlighting = HighlightStyle.define([
  { tag: tags.heading1, fontSize: 'var(--article-title-size)', fontFamily: '"PingFang SC", "Hiragino Sans GB", sans-serif', fontWeight: '700', color: '#202124' },
  { tag: tags.heading2, fontSize: 'var(--article-heading-2-size)', fontFamily: '"PingFang SC", "Hiragino Sans GB", sans-serif', fontWeight: '680', color: '#26272a' },
  { tag: tags.heading3, fontSize: '1.14em', fontFamily: '"PingFang SC", "Hiragino Sans GB", sans-serif', fontWeight: '680', color: '#26272a' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontFamily: '"PingFang SC", "Hiragino Sans GB", sans-serif', fontWeight: '680', color: '#26272a' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: '#4775aa' },
  { tag: tags.monospace, color: '#a74d45', fontFamily: 'SFMono-Regular, Menlo, Consolas, monospace', fontSize: '.86em' },
  { tag: tags.quote, color: '#62646a' },
]);

const liveEditorTheme = EditorView.theme({
  '&': { height: '100%', color: '#252629', backgroundColor: 'transparent', fontFamily: '"PingFang SC", "Hiragino Sans GB", serif', fontSize: 'var(--reader-font-size)', fontWeight: '400', fontKerning: 'auto', fontVariantLigatures: 'normal', letterSpacing: 'normal', lineHeight: 'var(--article-body-line-height)' },
  '.cm-scroller': { overflow: 'visible', fontFamily: 'inherit', lineHeight: 'inherit' },
  '.cm-content': { minHeight: '58vh', padding: '0 0 4rem', caretColor: '#222326' },
  '.cm-line': { padding: '0', overflowWrap: 'anywhere' },
  '.cm-line.cm-live-heading': { marginTop: '0', marginBottom: '0', lineHeight: '1.32', letterSpacing: '-.035em' },
  '.cm-line.cm-live-heading-1': { lineHeight: '1.2', letterSpacing: '-.055em' },
  '.cm-line.cm-live-empty-after-heading': { lineHeight: '.61em' },
  '.cm-line.cm-live-empty-paragraph': { lineHeight: '1.06em' },
  '.cm-line.cm-live-list': { paddingLeft: '1.48em', textIndent: '-1.48em' },
  '.cm-line.cm-live-ordered-list': { paddingLeft: '1.73em', textIndent: '-1.73em' },
  '.cm-live-list-marker': { display: 'inline-flex', boxSizing: 'border-box', width: '1.48em', minWidth: '1.48em', height: '1em', marginLeft: '0', alignItems: 'center', justifyContent: 'flex-start', color: '#303135', verticalAlign: '-.03em', textIndent: '0', userSelect: 'none' },
  '.cm-live-unordered-marker': { paddingLeft: '.36em' },
  '.cm-live-list-level-2.cm-live-unordered-marker': { paddingLeft: '.32em' },
  '.cm-live-list-level-3.cm-live-unordered-marker': { paddingLeft: '.37em' },
  '.cm-live-list-glyph': { display: 'block', width: '.36em', height: '.36em', borderRadius: '50%', backgroundColor: '#303135' },
  '.cm-live-list-level-2 .cm-live-list-glyph': { width: '.44em', height: '.44em', border: '1.2px solid #505359', backgroundColor: 'transparent' },
  '.cm-live-list-level-3 .cm-live-list-glyph': { width: '.34em', height: '.34em', borderRadius: '1px', backgroundColor: '#303135' },
  '.cm-live-ordered-marker': { width: '1.73em', minWidth: '1.73em', paddingRight: '.18em', justifyContent: 'flex-end', fontFamily: 'inherit', fontSize: '1em', fontVariantNumeric: 'normal', fontWeight: '400' },
  '.cm-live-task-marker': { justifyContent: 'flex-start' },
  '.cm-live-task-checkbox': { display: 'inline-grid', width: '.92em', height: '.92em', placeItems: 'center', border: '1px solid #74777c', borderRadius: '3px', color: '#fff', fontFamily: 'sans-serif', fontSize: '.7em', fontWeight: '700', lineHeight: '1' },
  '.cm-live-task-checkbox.is-checked': { borderColor: '#505359', backgroundColor: '#505359' },
  '.cm-line.cm-live-quote': { margin: '.35em 0', padding: '.6em .9em', color: '#62646a', background: '#f7f7f7', borderRadius: '0 6px 6px 0', boxShadow: 'inset 3px 0 #b9babd' },
  '.cm-line.cm-live-code': { padding: '.1em .35em', color: '#a74d45', background: '#f5f4f3', borderRadius: '4px', fontFamily: 'SFMono-Regular, Menlo, Consolas, monospace', fontSize: '.86em' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#252629' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgb(71 117 170 / .16)' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': { display: 'none' },
  '.cm-md-syntax, .cm-md-syntax *': { color: '#8b93a1 !important' },
  '.cm-md-list-syntax': { display: 'inline-block', boxSizing: 'border-box', width: '1.48em', minWidth: '1.48em', paddingLeft: '.36em', marginLeft: '0', verticalAlign: '-.03em', textIndent: '0' },
  '.cm-line.cm-live-ordered-list .cm-md-list-syntax': { width: '1.73em', minWidth: '1.73em', paddingRight: '.18em', paddingLeft: '0', marginLeft: '0', textAlign: 'right' },
  '.cm-md-strong': { fontWeight: '700 !important' },
  '.cm-md-emphasis': { fontStyle: 'italic !important' },
  '.cm-md-strikethrough': { textDecoration: 'line-through !important' },
  '.cm-md-code': { fontFamily: 'SFMono-Regular, Menlo, Consolas, monospace !important', fontSize: '.86em !important' },
  '.cm-md-heading-1': { fontSize: 'var(--article-title-size) !important', fontFamily: '"PingFang SC", "Hiragino Sans GB", sans-serif !important', fontWeight: '700 !important' },
  '.cm-md-heading-2': { fontSize: 'var(--article-heading-2-size) !important', fontFamily: '"PingFang SC", "Hiragino Sans GB", sans-serif !important', fontWeight: '680 !important' },
  '.cm-md-heading-3': { fontSize: '1.14em !important', fontFamily: '"PingFang SC", "Hiragino Sans GB", sans-serif !important', fontWeight: '680 !important' },
  '.cm-md-heading-4, .cm-md-heading-5, .cm-md-heading-6': { fontFamily: '"PingFang SC", "Hiragino Sans GB", sans-serif !important', fontWeight: '680 !important' },
});

function lineRange(state: EditorState, position: number) {
  const line = state.doc.lineAt(position);
  const from = line.from;
  const to = line.to;
  const text = line.text;

  if (/^\s*```/.test(text)) {
    let start = line.number;
    let end = line.number;
    while (start > 1 && !/^\s*```/.test(state.doc.line(start - 1).text)) start -= 1;
    while (end < state.doc.lines && !/^\s*```/.test(state.doc.line(end + 1).text)) end += 1;
    return { from: state.doc.line(start).from, to: state.doc.line(end).to };
  }

  if (/^\s*\|/.test(text)) {
    let start = line.number;
    let end = line.number;
    while (start > 1 && /^\s*\|/.test(state.doc.line(start - 1).text)) start -= 1;
    while (end < state.doc.lines && /^\s*\|/.test(state.doc.line(end + 1).text)) end += 1;
    return { from: state.doc.line(start).from, to: state.doc.line(end).to };
  }

  return { from, to };
}

function addRange(ranges: MarkerRange[], from: number, to: number) {
  if (to > from) ranges.push({ from, to });
}

function uniqueRanges(ranges: MarkerRange[]) {
  return ranges.sort((left, right) => left.from - right.from || left.to - right.to).reduce<MarkerRange[]>((unique, range) => {
    const previous = unique.at(-1);
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else unique.push(range);
    return unique;
  }, []);
}

function markdownSyntaxRanges(content: string) {
  const ranges: MarkerRange[] = [];
  const add = (from: number, to: number) => addRange(ranges, from, to);

  // Do not use \s here: it also matches line breaks. ViewPlugin decorations
  // are forbidden from replacing a line break, which made a trailing "- "
  // list item crash the editor.
  const linePattern = /^([ \t]*)(#{1,6}[ \t]+|(?:[-*+][ \t]+(?:\[[ xX]\][ \t]+)?)|(?:\d+[.)][ \t]+)|>[ \t]?)/gm;
  for (const match of content.matchAll(linePattern)) add(match.index! + match[1].length, match.index! + match[0].length);

  for (const match of content.matchAll(/(`{1,3})/g)) add(match.index!, match.index! + match[0].length);
  for (const match of content.matchAll(/(\*\*|__|~~|(?<!\*)\*(?!\*)|(?<!_)_(?!_))/g)) add(match.index!, match.index! + match[0].length);

  for (const match of content.matchAll(/!?\[([^\]\n]+)\]\([^\)\n]*\)/g)) {
    const start = match.index!;
    const closing = match[0].indexOf('](');
    add(start, start + (match[0].startsWith('!') ? 2 : 1));
    add(start + closing, start + match[0].length);
  }

  for (const match of content.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
    const start = match.index!;
    const value = match[1];
    const separator = value.indexOf('|');
    add(start, start + (match[0].startsWith('!') ? 3 : 2));
    if (separator >= 0) add(start + (match[0].startsWith('!') ? 3 : 2), start + (match[0].startsWith('!') ? 3 : 2) + separator + 1);
    add(start + match[0].length - 2, start + match[0].length);
  }

  return uniqueRanges(ranges);
}

export function markdownMarkerRanges(content: string, activeFrom: number, activeTo: number) {
  return markdownSyntaxRanges(content).filter(({ from, to }) => to <= activeFrom || from >= activeTo);
}

function imageLines(state: EditorState, sourcePath: string, files: NoteSummary[]) {
  const images: ImageLine[] = [];
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    const image = imagePreviewForLine(line.text, sourcePath, files);
    if (image) images.push({ ...image, from: line.from, to: line.to });
  }
  return images;
}

function visibleMarkerFor(value: string) {
  const heading = value.match(/^(#{1,6})\s+$/);
  if (heading) return visibleHeadingMarkers[heading[1].length - 1];
  if (/^(?:[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)$/.test(value)) return visibleListMarker;
  if (value === '**' || value === '__') return visibleStrongMarker;
  if (value === '*' || value === '_') return visibleEmphasisMarker;
  if (value === '~~') return visibleStrikethroughMarker;
  if (/^`{1,3}$/.test(value)) return visibleCodeMarker;
  return visibleMarker;
}

function livePreviewExtension(sourcePath: string, files: NoteSummary[]) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) { this.decorations = this.build(view); }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = this.build(update.view);
    }

    build(view: EditorView) {
      const active = lineRange(view.state, view.state.selection.main.head);
      const content = view.state.doc.toString();
      const builder: Range<Decoration>[] = [];
      const images = imageLines(view.state, sourcePath, files);
      for (const range of markdownSyntaxRanges(content)) {
        const isActive = range.to > active.from && range.from < active.to;
        const line = view.state.doc.lineAt(range.from);
        const listMarker = listMarkerForLine(line.text);
        const isListMarker = listMarker !== null && range.from === line.from + listMarker.from && range.to === line.from + listMarker.to;
        if (isActive) builder.push(visibleMarkerFor(content.slice(range.from, range.to)).range(range.from, range.to));
        else if (isListMarker && listMarker) builder.push(Decoration.replace({ widget: new ListMarkerWidget(listMarker), inclusive: false }).range(range.from, range.to));
        else if (!images.some((image) => range.from < image.to && range.to > image.from)) builder.push(hiddenMarker.range(range.from, range.to));
      }
      for (const image of images) {
        const widget = new ImagePreviewWidget(image, image.from);
        const isFocused = image.from >= active.from && image.from <= active.to;
        // Block decorations are not allowed when supplied by a ViewPlugin. The
        // widget itself is styled as a block, so an inline CodeMirror widget is
        // enough here and keeps image lines from crashing the editor.
        if (isFocused) builder.push(Decoration.widget({ widget, side: 1 }).range(image.to));
        else builder.push(Decoration.replace({ widget, inclusive: false }).range(image.from, image.to));
      }
      for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
        const line = view.state.doc.line(lineNumber);
        const heading = line.text.match(/^\s*(#{1,6})\s+/);
        const previous = lineNumber > 1 ? view.state.doc.line(lineNumber - 1).text : '';
        const next = lineNumber < view.state.doc.lines ? view.state.doc.line(lineNumber + 1).text : '';
        const previousHeading = /^\s*#{1,6}\s+/.test(previous);
        const nextHeading = /^\s*#{1,6}\s+/.test(next);
        const listMarker = listMarkerForLine(line.text);
        const listClass = listMarker ? `cm-live-list cm-live-${listMarker.kind}-list` : '';
        const className = heading ? `cm-live-heading cm-live-heading-${heading[1].length}` : !line.text && previousHeading && !nextHeading ? 'cm-live-empty-after-heading' : !line.text && previous && next && !previousHeading && !nextHeading ? 'cm-live-empty-paragraph' : listClass ? listClass : /^>\s?/.test(line.text) ? 'cm-live-quote' : /^\s*```/.test(line.text) ? 'cm-live-code' : '';
        if (className) builder.push(Decoration.line({ class: className }).range(line.from));
      }
      return Decoration.set(builder, true);
    }
  }, {
    decorations: (instance) => instance.decorations,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
    eventHandlers: {
      mousedown(event, view) {
        if (!(event.target instanceof HTMLElement)) return false;
        const preview = event.target.closest<HTMLElement>('.cm-image-preview');
        if (!preview) return false;
        const position = Number(preview.dataset.imageFrom);
        if (!Number.isFinite(position)) return false;
        event.preventDefault();
        view.dispatch({ selection: { anchor: position } });
        view.focus();
        return true;
      },
    },
  });
}

function modeExtensions(sourcePath: string, files: NoteSummary[]) {
  return [liveEditorTheme, syntaxHighlighting(markdownHighlighting), livePreviewExtension(sourcePath, files)];
}

export default function MarkdownLiveEditor({ content, sourcePath, files, onChange, onSave }: { content: string; sourcePath: string; files: NoteSummary[]; onChange: (content: string) => void; onSave: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const modeCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  useEffect(() => {
    if (!host.current) return;
    const modeExtension = modeExtensions(sourcePath, files);
    const state = EditorState.create({
      doc: content,
      extensions: [
        history(),
        markdown(),
        EditorView.contentAttributes.of({ inputmode: 'text' }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab, { key: 'Mod-s', run: () => { onSaveRef.current(); return true; } }]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => { if (update.docChanged) onChangeRef.current(update.state.doc.toString()); }),
        modeCompartment.current.of(modeExtension),
      ],
    });
    editor.current = new EditorView({ state, parent: host.current });
    return () => { editor.current?.destroy(); editor.current = null; };
    // The initial document is intentionally consumed once. Later edits are dispatched below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = editor.current;
    if (!view || content === view.state.doc.toString()) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
  }, [content]);

  useEffect(() => {
    const view = editor.current;
    if (!view) return;
    view.dispatch({ effects: modeCompartment.current.reconfigure(modeExtensions(sourcePath, files)) });
  }, [sourcePath, files]);

  return <div className="markdown-live-editor is-write" ref={host} aria-label="文章写作编辑器" />;
}
