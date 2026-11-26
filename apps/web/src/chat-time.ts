const shanghaiDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});
const shanghaiTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function dateParts(date: Date) {
  const parts = shanghaiDate.formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

export function formatChatTime(value: string, now = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(now.getTime())) return '';
  const day = dateParts(date);
  const current = dateParts(now);
  const clock = shanghaiTime.format(date);
  if (day.year === current.year && day.month === current.month && day.day === current.day) return clock;
  const yesterday = dateParts(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (day.year === yesterday.year && day.month === yesterday.month && day.day === yesterday.day) return `昨天 ${clock}`;
  const prefix = day.year === current.year ? '' : `${Number(day.year)}年`;
  return `${prefix}${Number(day.month)}月${Number(day.day)}日 ${clock}`;
}

export function needsTimeSeparator(current: string, previous?: string): boolean {
  const date = new Date(current);
  if (!Number.isFinite(date.getTime())) return false;
  const before = previous ? new Date(previous) : undefined;
  if (!before || !Number.isFinite(before.getTime())) return true;
  return shanghaiDate.format(date) !== shanghaiDate.format(before) || date.getTime() - before.getTime() >= 5 * 60 * 1000;
}
