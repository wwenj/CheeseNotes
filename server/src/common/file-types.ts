import { extname } from 'node:path';

export const textExtensions = new Set(['.md', '.txt', '.json', '.jsonl', '.yaml', '.yml']);
export const assetExtensions = new Set([
  '.pdf',
  '.png', '.apng', '.jpg', '.jpeg', '.jfif', '.webp', '.gif', '.svg', '.avif', '.bmp', '.ico', '.heic', '.heif',
  '.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.opus', '.flac',
  '.mp4', '.m4v', '.webm', '.mov', '.ogv', '.3gp', '.3g2',
]);

export const mimeTypes: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.apng': 'image/apng',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
  '.3gp': 'video/3gpp',
  '.3g2': 'video/3gpp2',
};

export const isText = (path: string) => textExtensions.has(extname(path).toLowerCase());
