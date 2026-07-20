import type { NoteTreeResult, TreeOperation } from '../api';

const inside = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);
const filename = (path: string) => path.split('/').at(-1) || path;

export function projectTree(tree: NoteTreeResult, operations: TreeOperation[]): NoteTreeResult {
  let files = tree.files.map((file) => ({ ...file }));
  let folders = [...tree.folders];

  for (const operation of operations) {
    if (operation.type === 'move-file') {
      files = files.map((file) => file.id === operation.id && file.path === operation.fromPath
        ? { ...file, path: operation.toFolder ? `${operation.toFolder}/${filename(file.path)}` : filename(file.path) }
        : file);
    }
    if (operation.type === 'move-folder') {
      files = files.map((file) => inside(file.path, operation.fromPath) ? { ...file, path: `${operation.toPath}${file.path.slice(operation.fromPath.length)}` } : file);
      folders = folders.map((folder) => inside(folder, operation.fromPath) ? `${operation.toPath}${folder.slice(operation.fromPath.length)}` : folder);
    }
    if (operation.type === 'delete-file') files = files.filter((file) => file.id !== operation.id || file.path !== operation.path);
    if (operation.type === 'delete-folder') {
      files = files.filter((file) => !inside(file.path, operation.path));
      folders = folders.filter((folder) => !inside(folder, operation.path));
    }
  }
  const implicit = new Set<string>();
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) implicit.add(parts.slice(0, index).join('/'));
  }
  return { files, folders: [...new Set([...folders, ...implicit])].sort((left, right) => left.localeCompare(right, 'zh-CN')) };
}
