import { displayName } from './files';

export function splitArticle(content: string, fallbackPath: string) {
  const fallbackTitle = displayName(fallbackPath);
  const match = content.match(/^\uFEFF?\s*#\s+([^\n]+)\s*(?:\n|$)/);
  if (!match) return { title: fallbackTitle, body: content };
  return { title: match[1].trim() || fallbackTitle, body: content.slice(match[0].length).replace(/^\n+/, '') };
}
