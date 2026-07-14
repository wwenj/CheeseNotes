export type TreeEntry = { path: string; type: 'blob' | 'tree' | 'commit'; sha: string; size?: number };
export type RepoMeta = { full_name: string; default_branch: string; permissions?: { push?: boolean } };
