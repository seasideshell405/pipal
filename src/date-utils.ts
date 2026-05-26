/**
 * 将 Date 格式化为 YYYY-MM-DD，使用本地时区（北京时间，此服务器为 Asia/Shanghai）。
 * 不带 4 点日界规则，纯格式化。
 * 新代码获取当前日期时应优先使用此函数或 getBeijingDateStr()，而非 toISOString()。
 */
export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 获取今天的北京日期字符串 YYYY-MM-DD。
 * 凌晨 4 点前算前一天（与 session 轮换时间 CRON_SESSION_ROTATION 对齐），
 * 保证日志、存档、session 文件使用一致的日界。
 * 新代码获取"今天"时应优先使用此函数。
 */
export function formatDate(d: Date): string {
  const adjusted = new Date(d);
  if (adjusted.getHours() < 4) {
    adjusted.setDate(adjusted.getDate() - 1);
  }
  return formatLocalDate(adjusted);
}

/** getBeijingDateStr() 是获取当前北京日期字符串的快捷方式，新代码推荐使用 */
export function getBeijingDateStr(): string {
  return formatDate(new Date());
}

/** 北京时间（UTC+8）格式化，输出 `YYYY-MM-DD HH:mm:ss` */
export function formatTs(d: Date): string {
  const bj = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return bj.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * 应用 4 点日界：凌晨 4 点前算前一天，
 * 返回"有效今天"的日期对象（仅日期部分有意义，时分秒归零到 UTC 00:00）。
 */
export function getEffectiveToday(): Date {
  const now = new Date();
  const bj = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  if (bj.getUTCHours() < 4) {
    bj.setUTCDate(bj.getUTCDate() - 1);
  }
  bj.setUTCHours(0, 0, 0, 0);
  return bj;
}

/**
 * 获取当前北京时间的 Date 对象（调整后使用 UTC getter 读取，即得北京时间成分）。
 * 用于 cron 匹配、lastTriggeredAt 等需要精确到分钟的场景，
 * 保证代码不依赖系统时区。
 */
export function getBeijingNow(): Date {
  const now = new Date();
  return new Date(now.getTime() + 8 * 60 * 60 * 1000);
}
