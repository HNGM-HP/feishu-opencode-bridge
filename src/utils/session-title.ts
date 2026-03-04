// 生成会话默认标题用的时间戳（MM-DD-HH-MM，使用服务器本地时间）
export function buildSessionTimestamp(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${mm}-${dd}-${hh}-${min}`;
}
