import { basename, extname } from 'node:path';

function fallbackTitle(path: string) {
  const name = basename(path);
  const extension = extname(name);
  return extension ? name.slice(0, -extension.length) : name;
}

export function noteTitle(path: string, content: string) {
  if (extname(path).toLowerCase() !== '.md') return fallbackTitle(path);
  const title = content.match(/^\uFEFF?[ \t]*#[ \t]+([^\r\n]+?)[ \t]*(?:\r?\n|$)/)?.[1]?.trim();
  return title || fallbackTitle(path);
}
