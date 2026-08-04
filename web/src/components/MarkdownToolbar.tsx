import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Camera, CameraErrorCode, MediaTypeSelection } from '@capacitor/camera';
import { Keyboard } from '@capacitor/keyboard';
import { Bold, ChevronDown, Code2, Heading, ImagePlus, Link2, List, LoaderCircle, Quote } from 'lucide-react';
import type { NoteSummary } from '../api';
import { isNativeIOS } from '../api/platform';
import type { MarkdownCommand, MarkdownLiveEditorHandle } from './MarkdownLiveEditor';

type MarkdownToolbarProps = {
  editor: MarkdownLiveEditorHandle | null;
  sourcePath: string;
  onUpload: (file: File, sourcePath: string) => Promise<NoteSummary | null>;
  onError: (message: string) => void;
};

const NATIVE_COMMAND_EVENT = 'noteai:native-markdown-command';

type NativeMarkdownCommand = MarkdownCommand | { type: 'image' };

type NativeToolbarWindow = Window & {
  webkit?: {
    messageHandlers?: {
      noteaiMarkdownToolbar?: { postMessage: (message: unknown) => void };
    };
  };
};

function postNativeToolbarState(visible: boolean, uploading: boolean) {
  const handler = (window as NativeToolbarWindow).webkit?.messageHandlers?.noteaiMarkdownToolbar;
  handler?.postMessage({ type: 'state', visible, uploading });
}

function timestampName(format = 'jpg') {
  const date = new Date();
  const part = (value: number) => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`;
  const extension = format.toLowerCase().replace(/^jpeg$/, 'jpg').replace(/[^a-z0-9]/g, '') || 'jpg';
  return `image-${stamp}.${extension}`;
}

function isPickerCancellation(reason: unknown) {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === CameraErrorCode.ChooseMediaCancelled;
}

async function chooseIOSImage() {
  const { results } = await Camera.chooseFromGallery({
    mediaType: MediaTypeSelection.Photo,
    allowMultipleSelection: false,
    limit: 1,
    includeMetadata: true,
    editable: 'no',
  });
  const image = results[0];
  if (!image?.webPath) return null;
  const response = await fetch(image.webPath);
  if (!response.ok) throw new Error('无法读取所选图片。');
  const blob = await response.blob();
  const format = image.metadata?.format || blob.type.replace(/^image\//, '') || 'jpeg';
  const type = blob.type.startsWith('image/') ? blob.type : `image/${format}`;
  return new File([blob], timestampName(format), { type });
}

export function toolbarKeyboardOffset(viewport: Pick<VisualViewport, 'height' | 'offsetTop'> | null, innerHeight: number) {
  if (!viewport) return 0;
  return Math.max(0, Math.round(innerHeight - viewport.height - viewport.offsetTop));
}

export default function MarkdownToolbar({ editor, sourcePath, onUpload, onError }: MarkdownToolbarProps) {
  const [headingOpen, setHeadingOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const toolbar = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isNativeIOS()) return;
    const viewport = window.visualViewport;
    const sync = () => setKeyboardOffset(toolbarKeyboardOffset(viewport, window.innerHeight));
    sync();
    viewport?.addEventListener('resize', sync);
    viewport?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    return () => {
      viewport?.removeEventListener('resize', sync);
      viewport?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  useEffect(() => {
    if (!headingOpen) return;
    const close = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !toolbar.current?.contains(event.target)) setHeadingOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setHeadingOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [headingOpen]);

  useEffect(() => {
    const input = fileInput.current;
    const cancel = () => editor?.cancelInsertionAnchor();
    input?.addEventListener('cancel', cancel);
    return () => input?.removeEventListener('cancel', cancel);
  }, [editor]);

  const keepEditorFocused = (event: PointerEvent) => event.preventDefault();
  const execute = (command: MarkdownCommand) => {
    editor?.execute(command);
    setHeadingOpen(false);
  };
  const upload = useCallback(async (file: File | null) => {
    if (!editor || uploading) return;
    if (!file) return editor.cancelInsertionAnchor();
    setUploading(true);
    try {
      const uploaded = await onUpload(file, sourcePath);
      if (!uploaded) return editor.cancelInsertionAnchor();
      const name = uploaded.path.split('/').at(-1) ?? 'image';
      const alt = name.replace(/\.[^.]+$/, '');
      editor.insertAtAnchor(`![${alt}](assets/${name})`);
    } catch {
      editor.cancelInsertionAnchor();
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }, [editor, onUpload, sourcePath, uploading]);
  const chooseImage = useCallback(async () => {
    if (uploading || !editor) return;
    editor.createInsertionAnchor();
    if (!isNativeIOS()) return fileInput.current?.click();
    try {
      await upload(await chooseIOSImage());
    } catch (reason) {
      editor.cancelInsertionAnchor();
      if (!isPickerCancellation(reason)) onError(reason instanceof Error ? reason.message : '无法读取所选图片。');
    }
  }, [editor, onError, upload, uploading]);

  useEffect(() => {
    if (!isNativeIOS()) return;
    void Keyboard.setAccessoryBarVisible({ isVisible: false });
    return () => { void Keyboard.setAccessoryBarVisible({ isVisible: true }); };
  }, []);

  useEffect(() => {
    if (!isNativeIOS()) return;
    postNativeToolbarState(Boolean(editor), uploading);
  }, [editor, uploading]);

  useEffect(() => {
    if (!isNativeIOS()) return;
    const handleCommand = (event: Event) => {
      const command = (event as CustomEvent<NativeMarkdownCommand>).detail;
      if (!command || !editor) return;
      if (command.type === 'image') {
        void chooseImage();
        return;
      }
      editor.execute(command);
    };
    window.addEventListener(NATIVE_COMMAND_EVENT, handleCommand);
    return () => window.removeEventListener(NATIVE_COMMAND_EVENT, handleCommand);
  }, [chooseImage, editor]);

  useEffect(() => () => {
    if (isNativeIOS()) postNativeToolbarState(false, false);
  }, []);

  if (isNativeIOS()) return null;

  const style = { '--markdown-toolbar-keyboard-offset': `${keyboardOffset}px` } as CSSProperties;
  return <div className="markdown-toolbar-layer" style={style}>
    <div className="markdown-toolbar" ref={toolbar} role="toolbar" aria-label="Markdown 快捷工具" onPointerDown={keepEditorFocused}>
      <div className="markdown-heading-control">
        <button type="button" className={headingOpen ? 'markdown-tool is-active' : 'markdown-tool'} aria-label="选择标题级别" aria-haspopup="menu" aria-expanded={headingOpen} onClick={() => setHeadingOpen((open) => !open)}><Heading size={20} /><ChevronDown size={12} /></button>
        {headingOpen && <div className="markdown-heading-menu" role="menu" aria-label="标题级别">
          {([1, 2, 3, 4] as const).map((level) => <button type="button" role="menuitem" key={level} onClick={() => execute({ type: 'heading', level })}><span>H{level}</span><small>{['一级标题', '二级标题', '三级标题', '四级标题'][level - 1]}</small></button>)}
        </div>}
      </div>
      <button type="button" className="markdown-tool" aria-label="加粗" title="加粗" onClick={() => execute({ type: 'bold' })}><Bold size={20} /></button>
      <button type="button" className="markdown-tool" aria-label="插入链接" title="插入链接" onClick={() => execute({ type: 'link' })}><Link2 size={20} /></button>
      <button type="button" className="markdown-tool" aria-label="引用" title="引用" onClick={() => execute({ type: 'quote' })}><Quote size={20} /></button>
      <button type="button" className="markdown-tool" aria-label="无序列表" title="无序列表" onClick={() => execute({ type: 'unordered-list' })}><List size={21} /></button>
      <button type="button" className="markdown-tool" aria-label="行内代码" title="行内代码" onClick={() => execute({ type: 'inline-code' })}><Code2 size={21} /></button>
      <button type="button" className="markdown-tool" aria-label={uploading ? '正在上传图片' : '上传图片'} title="上传图片" disabled={uploading} onClick={() => void chooseImage()}>{uploading ? <LoaderCircle className="spin" size={20} /> : <ImagePlus size={21} />}</button>
      <input ref={fileInput} className="markdown-image-input" type="file" accept="image/*" tabIndex={-1} aria-hidden="true" onChange={(event) => void upload(event.currentTarget.files?.[0] ?? null)} />
    </div>
  </div>;
}
