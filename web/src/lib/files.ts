import type { NoteSummary } from '../api';

export type TreeNode = { name: string; path: string; folder: boolean; file?: NoteSummary; children: TreeNode[] };

const textExtensions = new Set(['md', 'txt', 'json', 'jsonl', 'yaml', 'yml']);
const imageExtensions = new Set(['png', 'apng', 'jpg', 'jpeg', 'jfif', 'webp', 'gif', 'svg', 'avif', 'bmp', 'ico', 'heic', 'heif']);
const audioExtensions = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac']);
const videoExtensions = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv', '3gp', '3g2']);

export function extension(path: string) { return path.split('.').at(-1)?.toLowerCase() ?? ''; }
export function isMarkdown(path: string) { return extension(path) === 'md'; }
export function isText(path: string) { return textExtensions.has(extension(path)); }
export function fileName(path: string) { return path.split('/').at(-1) || path; }
export function fileKind(path: string) {
  const ext = extension(path);
  if (isMarkdown(path)) return 'markdown';
  if (imageExtensions.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (audioExtensions.has(ext)) return 'audio';
  if (videoExtensions.has(ext)) return 'video';
  if (isText(path)) return 'text';
  return 'file';
}

export function displayName(path: string) {
  const name = fileName(path);
  const extensionStart = name.lastIndexOf('.');
  return extensionStart > 0 ? name.slice(0, extensionStart) : name;
}

export function buildTree(files: NoteSummary[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', folder: true, children: [] };
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let parent = root;
    parts.forEach((name, index) => {
      const leaf = index === parts.length - 1;
      const path = parts.slice(0, index + 1).join('/');
      let node = parent.children.find((item) => item.name === name && item.folder !== leaf);
      if (!node) {
        node = { name, path, folder: !leaf, file: leaf ? file : undefined, children: [] };
        parent.children.push(node);
      }
      parent = node;
    });
  }
  const sort = (nodes: TreeNode[]): TreeNode[] => nodes.sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name, 'zh-CN')).map((node) => ({ ...node, children: sort(node.children) }));
  return sort(root.children);
}

export function resolveVaultPath(reference: string, fromPath: string, paths: string[]) {
  const raw = decodeURIComponent(reference).split('|')[0].split('#')[0].trim();
  if (!raw) return null;
  const normalize = (value: string) => {
    const output: string[] = [];
    for (const part of value.replace(/^\//, '').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') output.pop(); else output.push(part);
    }
    return output.join('/');
  };
  const sourceFolder = fromPath.split('/').slice(0, -1).join('/');
  const candidates = [normalize(raw), normalize(`${sourceFolder}/${raw}`)];
  for (const candidate of candidates) {
    if (paths.includes(candidate)) return candidate;
    if (!extension(candidate) && paths.includes(`${candidate}.md`)) return `${candidate}.md`;
  }
  const basename = raw.split('/').at(-1)?.replace(/\.md$/i, '');
  return paths.find((path) => displayName(path) === basename) ?? null;
}
