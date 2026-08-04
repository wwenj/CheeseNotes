// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarkdownLiveEditorHandle } from './MarkdownLiveEditor';
import MarkdownToolbar, { toolbarKeyboardOffset } from './MarkdownToolbar';

const platform = vi.hoisted(() => ({ nativeIOS: false }));
const keyboard = vi.hoisted(() => ({ setAccessoryBarVisible: vi.fn(async () => undefined) }));

vi.mock('../api/platform', () => ({ isNativeIOS: () => platform.nativeIOS }));
vi.mock('@capacitor/keyboard', () => ({ Keyboard: keyboard }));

beforeEach(() => {
  platform.nativeIOS = false;
  keyboard.setAccessoryBarVisible.mockClear();
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'webkit');
});

function editor(): MarkdownLiveEditorHandle {
  return {
    execute: vi.fn(),
    createInsertionAnchor: vi.fn(),
    insertAtAnchor: vi.fn(),
    cancelInsertionAnchor: vi.fn(),
    focus: vi.fn(),
  };
}

describe('Markdown toolbar', () => {
  it('opens the upward heading menu and executes the selected level', () => {
    const handle = editor();
    render(<MarkdownToolbar editor={handle} sourcePath="文章/正文.md" onUpload={vi.fn()} onError={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '选择标题级别' }));
    expect(screen.getByRole('menu', { name: '标题级别' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /三级标题/ }));

    expect(handle.execute).toHaveBeenCalledWith({ type: 'heading', level: 3 });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('uploads a Web-selected image and inserts its relative Markdown path', async () => {
    const handle = editor();
    const upload = vi.fn(async () => ({ id: 'image-id', path: '文章/assets/封面.png', revision: 'sha', assetVersion: 'sha', updated_at: 'now' }));
    const { container } = render(<MarkdownToolbar editor={handle} sourcePath="文章/正文.md" onUpload={upload} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '上传图片' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([new Uint8Array([1, 2, 3])], '封面.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(handle.insertAtAnchor).toHaveBeenCalledWith('![封面](assets/封面.png)'));
    expect(handle.createInsertionAnchor).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledWith(file, '文章/正文.md');
  });

  it('computes only the part of the layout covered by the visual viewport', () => {
    expect(toolbarKeyboardOffset({ height: 500, offsetTop: 0 } as VisualViewport, 820)).toBe(320);
    expect(toolbarKeyboardOffset({ height: 820, offsetTop: 0 } as VisualViewport, 820)).toBe(0);
    expect(toolbarKeyboardOffset(null, 820)).toBe(0);
  });

  it('hides the Web toolbar on iOS and forwards native commands to the editor', async () => {
    platform.nativeIOS = true;
    const postMessage = vi.fn();
    Object.defineProperty(window, 'webkit', {
      configurable: true,
      value: { messageHandlers: { noteaiMarkdownToolbar: { postMessage } } },
    });
    const handle = editor();
    render(<MarkdownToolbar editor={handle} sourcePath="文章/正文.md" onUpload={vi.fn()} onError={vi.fn()} />);

    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(keyboard.setAccessoryBarVisible).toHaveBeenCalledWith({ isVisible: false });
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'state', visible: true, uploading: false }));

    window.dispatchEvent(new CustomEvent('noteai:native-markdown-command', { detail: { type: 'bold' } }));
    expect(handle.execute).toHaveBeenCalledWith({ type: 'bold' });
  });
});
