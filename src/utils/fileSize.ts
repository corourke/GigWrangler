const KB = 1024;
const MB = 1024 * KB;

/** A file's size for people: "240 KB" below 1 MB (at least 1 KB for any non-empty file), else "2.5 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes <= 0) return '0 KB';
  return `${Math.max(1, Math.round(bytes / KB))} KB`;
}
