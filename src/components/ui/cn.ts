// Мини-склейка классов (как clsx, без зависимости).
export type ClassValue = string | number | null | false | undefined;

export function cn(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(' ');
}
