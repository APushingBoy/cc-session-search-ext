export type MessageRole = 'user' | 'assistant';

/** A session JSONL file found on disk. */
export interface SessionFileInfo {
  filePath: string;
  /** Name of the top-level directory under `projects/` (encoded project path). */
  projectDir: string;
  mtimeMs: number;
  size: number;
}

/** One searchable, human-readable chat message. */
export interface SessionMessage {
  /** Stable locator inside the session: record uuid if present, else `L<line>`. */
  key: string;
  uuid?: string;
  role: MessageRole;
  text: string;
  /** Lower-cased text, cached for case-insensitive matching. */
  lower: string;
  /** Raw ISO timestamp from the record, if valid. */
  timestamp?: string;
  /** Epoch ms parsed from timestamp. */
  time?: number;
  /** 1-based line number of the (first) record in the JSONL file. */
  line: number;
  /** Position within ParsedSession.messages. */
  index: number;
}

export interface ParsedSession {
  filePath: string;
  sessionId: string;
  projectDir: string;
  /** Human-friendly project name (basename of cwd when available). */
  projectName: string;
  cwd?: string;
  title?: string;
  startTime?: number;
  endTime?: number;
  messages: SessionMessage[];
  mtimeMs: number;
  size: number;
  /** Count of lines that could not be parsed as JSON. */
  invalidLines: number;
}
