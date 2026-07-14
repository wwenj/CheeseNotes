import { extname } from 'node:path';

export const textExtensions = new Set(['.md', '.txt', '.json', '.jsonl', '.yaml', '.yml']);
export const assetExtensions = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif', '.mp3', '.m4a', '.wav', '.ogg', '.mp4', '.webm', '.mov']);

export const mimeTypes: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

export const isText = (path: string) => textExtensions.has(extname(path).toLowerCase());
