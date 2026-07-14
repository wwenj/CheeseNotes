export type Panel = 'vault' | 'sync' | 'settings';
export type ArticleMode = 'read' | 'write';

export type Draft = {
  path: string;
  content: string;
  revision?: string;
};

export type ClientSettings = {
  readerFontSize: number;
};

export type PendingNavigation = {
  label: string;
  proceed: () => void;
};
