export type Panel = 'vault' | 'sync' | 'settings' | 'manage';
export type ArticleMode = 'read' | 'write';

export type Draft = {
  id?: string;
  path: string;
  content: string;
  revision?: string;
};

export type ClientSettings = {
  readerFontSize: number;
};
