/** Client-safe formatting helpers shared by portal panels. */

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

/** GitHub palette tokens (user-requested GitHub/Notion design language). */
export const GH = {
  border: "#d0d7de",
  borderMuted: "#d8dee4",
  canvasSubtle: "#f6f8fa",
  canvasInset: "#f6f8fa",
  fg: "#1f2328",
  muted: "#59636e",
  accent: "#0969da",
  accentSubtle: "#ddf4ff",
  success: "#1a7f37",
  successSubtle: "#dafbe1",
  attention: "#9a6700",
  attentionSubtle: "#fff8c5",
  danger: "#cf222e",
  dangerSubtle: "#ffebe9",
  neutral: "#818b98",
  cellEmpty: "#ebedf0",
} as const;

export const STATUS_META: Record<
  string,
  { label: string; bg: string; fg: string; dot: string }
> = {
  WAITING: { label: "Waiting", bg: GH.canvasSubtle, fg: GH.muted, dot: "#afb8c1" },
  ANALYZING: { label: "Analyzing", bg: GH.attentionSubtle, fg: GH.attention, dot: "#d4a72c" },
  DONE: { label: "Done", bg: GH.successSubtle, fg: GH.success, dot: "#1a7f37" },
};
