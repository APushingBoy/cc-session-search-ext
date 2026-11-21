import { discoverSessionFiles, resolveProjectsDir } from '../session/discovery';
import { parseSessionFile } from '../session/parser';
import { MessageRole, ParsedSession, SessionFileInfo } from '../session/types';

export type RoleFilter = 'all' | MessageRole;

export interface SearchOptions {
  query: string;
  role: RoleFilter;
  /** Max results returned (sorted newest first). */
  limit?: number;
}

export interface Snippet {
  text: string;
  /** [start, end) character ranges in `text` to highlight. */
  highlights: Array<[number, number]>;
}

export interface SearchResult {
  filePath: string;
  sessionId: string;
  projectName: string;
  /** Original working directory of the session, if recorded. */
  cwd?: string;
  title?: string;
  messageKey: string;
  messageIndex: number;
  line: number;
  role: MessageRole;
  time?: number;
  snippet: Snippet;
}

export interface SearchResponse {
  results: SearchResult[];
  /** Total number of matching messages (may exceed results.length). */
  total: number;
}

export const DEFAULT_LIMIT = 1000;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build a snippet around the first match, collapsing whitespace, with all match ranges. */
export function buildSnippet(text: string, query: string, before = 60, after = 160): Snippet {
  const re = new RegExp(escapeRegExp(query), 'giu');
  const first = re.exec(text);
  let start = 0;
  let end = Math.min(text.length, before + after);
  if (first) {
    start = Math.max(0, first.index - before);
    end = Math.min(text.length, first.index + first[0].length + after);
  }
  let body = text.slice(start, end).replace(/\s+/g, ' ');
  if (start > 0) {
    body = '…' + body.replace(/^ /, '');
  }
  if (end < text.length) {
    body = body.replace(/ $/, '') + '…';
  }
  const highlights: Array<[number, number]> = [];
  const normQuery = query.replace(/\s+/g, ' ');
  if (normQuery) {
    const re2 = new RegExp(escapeRegExp(normQuery), 'giu');
    let m: RegExpExecArray | null;
    while ((m = re2.exec(body)) !== null) {
      if (m[0].length === 0) {
        re2.lastIndex++;
        continue;
      }
      highlights.push([m.index, m.index + m[0].length]);
    }
  }
  return { text: body, highlights };
}

/** Case-insensitive substring search over parsed sessions. Pure and synchronous. */
export function searchSessions(sessions: ParsedSession[], options: SearchOptions): SearchResponse {
  const query = options.query.trim();
  if (!query) {
    return { results: [], total: 0 };
  }
  const needle = query.toLowerCase();
  const limit = options.limit ?? DEFAULT_LIMIT;
  const hits: Array<{ session: ParsedSession; index: number }> = [];
  for (const session of sessions) {
    for (const msg of session.messages) {
      if (options.role !== 'all' && msg.role !== options.role) {
        continue;
      }
      if (msg.lower.includes(needle)) {
        hits.push({ session, index: msg.index });
      }
    }
  }
  // Newest first; messages without a timestamp go last.
  hits.sort((a, b) => {
    const ta = a.session.messages[a.index].time ?? -Infinity;
    const tb = b.session.messages[b.index].time ?? -Infinity;
    return tb - ta;
  });
  const results = hits.slice(0, limit).map(({ session, index }): SearchResult => {
    const msg = session.messages[index];
    return {
      filePath: session.filePath,
      sessionId: session.sessionId,
      projectName: session.projectName,
      cwd: session.cwd,
      title: session.title,
      messageKey: msg.key,
      messageIndex: msg.index,
      line: msg.line,
      role: msg.role,
      time: msg.time,
      snippet: buildSnippet(msg.text, query),
    };
  });
  return { results, total: hits.length };
}

/**
 * Locate a message inside a session by its unique key (record uuid) first,
 * then by original line number — never by text content. Returns -1 if not found.
 */
export function findTargetIndex(session: ParsedSession, messageKey: string, line: number): number {
  const byKey = session.messages.findIndex((m) => m.key === messageKey);
  if (byKey >= 0) {
    return byKey;
  }
  return session.messages.findIndex((m) => m.line === line);
}

export interface LoadStatus {
  projectsDir: string;
  exists: boolean;
  sessionCount: number;
  messageCount: number;
  /** Files that could not be listed or read. */
  failedFiles: number;
}

/**
 * In-memory store of parsed sessions. Parsing is async and cached by (mtime, size);
 * `refresh()` re-discovers files and re-parses only those that changed.
 */
export class SessionStore {
  private cache = new Map<string, ParsedSession>();
  private sessions: ParsedSession[] = [];
  private status?: LoadStatus;
  private loading?: Promise<LoadStatus>;

  constructor(private readonly projectsDirProvider: () => string = () => resolveProjectsDir()) {}

  getSessions(): ParsedSession[] {
    return this.sessions;
  }

  getSession(filePath: string): ParsedSession | undefined {
    return this.cache.get(filePath);
  }

  isKnownFile(filePath: string): boolean {
    return this.cache.has(filePath);
  }

  /** Load once; concurrent callers share the same promise. */
  ensureLoaded(onProgress?: (done: number, total: number) => void): Promise<LoadStatus> {
    if (this.status && !this.loading) {
      return Promise.resolve(this.status);
    }
    return this.refresh(onProgress);
  }

  refresh(onProgress?: (done: number, total: number) => void): Promise<LoadStatus> {
    if (this.loading) {
      return this.loading;
    }
    this.loading = this.doLoad(onProgress).finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }

  private async doLoad(onProgress?: (done: number, total: number) => void): Promise<LoadStatus> {
    const projectsDir = this.projectsDirProvider();
    const discovery = await discoverSessionFiles(projectsDir);
    let failed = discovery.errors;
    const next = new Map<string, ParsedSession>();
    const toParse: SessionFileInfo[] = [];
    for (const info of discovery.files) {
      const cached = this.cache.get(info.filePath);
      if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
        next.set(info.filePath, cached);
      } else {
        toParse.push(info);
      }
    }

    let done = 0;
    const total = toParse.length;
    onProgress?.(done, total);
    const concurrency = 8;
    let cursor = 0;
    const worker = async () => {
      while (cursor < toParse.length) {
        const info = toParse[cursor++];
        try {
          next.set(info.filePath, await parseSessionFile(info));
        } catch {
          failed++; // missing, deleted mid-scan, or permission denied
        }
        done++;
        onProgress?.(done, total);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, toParse.length) }, worker));

    this.cache = next;
    this.sessions = [...next.values()].filter((s) => s.messages.length > 0);
    this.status = {
      projectsDir,
      exists: discovery.exists,
      sessionCount: this.sessions.length,
      messageCount: this.sessions.reduce((n, s) => n + s.messages.length, 0),
      failedFiles: failed,
    };
    return this.status;
  }
}
