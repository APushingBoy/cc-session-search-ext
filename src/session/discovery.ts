import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SessionFileInfo } from './types';

/**
 * Resolve the Claude Code config directory.
 * `CLAUDE_CONFIG_DIR` takes precedence; otherwise `~/.claude`.
 */
export function resolveClaudeConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  const raw = (env.CLAUDE_CONFIG_DIR ?? '').trim();
  if (raw) {
    let p = raw.replace(/^["']|["']$/g, '');
    if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
      p = path.join(home, p.slice(1));
    }
    return path.resolve(p);
  }
  return path.join(home, '.claude');
}

export function resolveProjectsDir(env?: NodeJS.ProcessEnv, home?: string): string {
  return path.join(resolveClaudeConfigDir(env, home), 'projects');
}

export interface DiscoveryResult {
  projectsDir: string;
  /** False when the projects directory does not exist or is not readable. */
  exists: boolean;
  files: SessionFileInfo[];
  /** Number of directories/files that could not be read. */
  errors: number;
}

/** Recursively find all `*.jsonl` files under the projects directory. Never throws. */
export async function discoverSessionFiles(projectsDir: string): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { projectsDir, exists: false, files: [], errors: 0 };
  try {
    const st = await fs.promises.stat(projectsDir);
    if (!st.isDirectory()) {
      return result;
    }
  } catch {
    return result;
  }
  result.exists = true;

  const walk = async (dir: string, projectDir: string | undefined, depth: number): Promise<void> => {
    if (depth > 8) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      result.errors++;
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, projectDir ?? entry.name, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) {
        try {
          const st = await fs.promises.stat(full);
          result.files.push({
            filePath: full,
            projectDir: projectDir ?? '',
            mtimeMs: st.mtimeMs,
            size: st.size,
          });
        } catch {
          result.errors++;
        }
      }
    }
  };

  await walk(projectsDir, undefined, 0);
  return result;
}
