const pad = (n: number) => String(n).padStart(2, '0');

/** "11/20 17:42", or "2025/11/20 17:42" when not in the current year. Local time. */
export function formatTime(ms: number | undefined, now: Date = new Date()): string {
  if (ms === undefined || !Number.isFinite(ms)) {
    return '未知时间';
  }
  const d = new Date(ms);
  const md = `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}/${md}`;
}

/** Full "2025/11/20 17:42:05". */
export function formatFullTime(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) {
    return '未知时间';
  }
  const d = new Date(ms);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}
