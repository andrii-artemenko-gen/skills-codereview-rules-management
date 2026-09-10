export interface MarkdownSource {
  path: string;
  content: string;
}

export interface SyncOptions {
  pattern: string;
  output: string;
  cwd?: string;
  render?: (sources: MarkdownSource[]) => string;
  staged?: boolean;
  check?: boolean;
}

export interface SyncResult {
  changed: boolean;
  sourceCount: number;
}

export function syncMarkdown(options: SyncOptions): SyncResult;
