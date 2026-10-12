import { format, isThisYear, isToday, isYesterday } from "date-fns";

/** 2:04 PM */
export function clockTime(iso: string): string {
  return format(new Date(iso), "h:mm a");
}

/** Divider label above the first message of each day. */
export function dayLabel(iso: string): string {
  const date = new Date(iso);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, isThisYear(date) ? "EEEE, MMMM d" : "MMMM d, yyyy");
}

export function dayKey(iso: string): string {
  return format(new Date(iso), "yyyy-MM-dd");
}

/** Full timestamp for tooltips. */
export function fullTime(iso: string): string {
  return format(new Date(iso), "EEE, MMM d yyyy 'at' h:mm a");
}

/** Short relative label for search results and thread summaries. */
export function shortWhen(iso: string): string {
  const date = new Date(iso);
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return "Yesterday";
  return format(date, isThisYear(date) ? "MMM d" : "MMM d, yyyy");
}

const GROUPING_WINDOW_MS = 5 * 60 * 1000;

/**
 * True when a message should render without its own avatar and header because
 * the same person posted a moment earlier.
 */
export function isGrouped(
  previous: { user: { id: string }; createdAt: string } | undefined,
  current: { user: { id: string }; createdAt: string },
): boolean {
  if (!previous) return false;
  if (previous.user.id !== current.user.id) return false;
  if (dayKey(previous.createdAt) !== dayKey(current.createdAt)) return false;
  return (
    new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime() <
    GROUPING_WINDOW_MS
  );
}
