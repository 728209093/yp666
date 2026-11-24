export const publicSiteUrl = import.meta.env.VITE_PUBLIC_SITE_URL || (import.meta.env.DEV ? 'http://127.0.0.1:5173' : window.location.origin);
export function assetUrl(value: string): string {
  if (value.startsWith('/assets/')) return new URL(value, publicSiteUrl).toString();
  return value;
}
export function dateTime(value: string | null | undefined): string {
  if (!value) return '尚未发布';
  return new Intl.DateTimeFormat('zh-CN', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false}).format(new Date(value));
}
