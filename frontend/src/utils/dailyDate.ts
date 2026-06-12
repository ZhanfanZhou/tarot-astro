/** 日运切日时刻:本地时间 18:00 后抽的签算作明日 */
export const EVENING_CUTOVER_HOUR = 18;

export function isEveningDraw(now: Date = new Date()): boolean {
  return now.getHours() >= EVENING_CUTOVER_HOUR;
}

/** 日运生效日(YYYY-MM-DD,本地时区):18:00 前=今天,之后=明天 */
export function getEffectiveDate(now: Date = new Date()): string {
  const d = new Date(now);
  if (isEveningDraw(d)) d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
