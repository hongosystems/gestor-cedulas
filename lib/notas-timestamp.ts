const TRAILING_TIMESTAMP_REGEX = /\s\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatNotasTimestamp(date = new Date()): string {
  const day = pad2(date.getDate());
  const month = pad2(date.getMonth() + 1);
  const year = date.getFullYear();
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

export function withAutoNotasTimestamp(rawValue: string): string | null {
  const cleanValue = stripAutoNotasTimestamp(rawValue);
  if (!cleanValue) return null;
  return `${cleanValue} ${formatNotasTimestamp()}`;
}

export function stripAutoNotasTimestamp(rawValue: string): string {
  return rawValue.trim().replace(TRAILING_TIMESTAMP_REGEX, "").trim();
}
