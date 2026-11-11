/**
 * 六份工作台名单在从详情返回、或登记通话结果之后，按当前排序定位下一条今日未拨。
 * 今日未拨与 §119 / §120 相同：这一行能看见今日已拨，并且次数是 0。
 * 看不见次数的行不算今日未拨。不打开详情，不拨号，不新增查询参数。
 */

export interface QueueUndialedCandidate {
  targetType: string;
  targetId: string;
  todayCallCount: number | null;
}

export interface QueueUndialedAnchor {
  targetType: string;
  targetId: string;
}

export function queueUndialedKey(row: { targetType: string; targetId: string }) {
  return `${row.targetType}\n${row.targetId}`;
}

export function readQueueTodayCallCount(glanceText: string | null | undefined) {
  if (glanceText == null) return null;
  const match = glanceText.match(/今日已拨\s+(\d+)\s*次/);
  if (!match) return null;
  const count = Number(match[1]);
  if (!Number.isInteger(count) || count < 0) return null;
  return count;
}

function isTodayUndialed(row: QueueUndialedCandidate) {
  return row.todayCallCount === 0;
}

/**
 * 按当前排序选出要滚到的那一行。
 * 当前行还在时，取它后面的第一条今日未拨；没有就停在当前行。
 * 当前行不在时，取仍排在它后面、并且还在名单里的今日未拨；没有就取后面那条仍可见的行。
 * 新出现、原来名单里没有的行，可以当作下一条。原来排在当前行前面的行不回头选。
 * 找不到时返回 -1，调用方不报错、不弹窗。
 */
export function chooseQueueUndialedFocus(
  rows: readonly QueueUndialedCandidate[],
  anchor: QueueUndialedAnchor | null,
  afterKeys: readonly string[] = [],
  knownKeys?: readonly string[]
) {
  if (!rows.length) return -1;
  const anchorType = anchor?.targetType.trim() || "";
  const anchorId = anchor?.targetId.trim() || "";
  if (anchorType && anchorId) {
    const index = rows.findIndex((row) => row.targetType === anchorType && row.targetId === anchorId);
    if (index >= 0) {
      for (let cursor = index + 1; cursor < rows.length; cursor += 1) {
        if (isTodayUndialed(rows[cursor])) return cursor;
      }
      return index;
    }
  }
  const after = new Set(afterKeys);
  const known = new Set(knownKeys ?? rows.map((row) => queueUndialedKey(row)));
  for (const key of afterKeys) known.add(key);
  const pick = (matches: (row: QueueUndialedCandidate, key: string) => boolean) => {
    for (let index = 0; index < rows.length; index += 1) {
      if (matches(rows[index], queueUndialedKey(rows[index]))) return index;
    }
    return -1;
  };
  const laterUndialed = pick((row, key) => after.has(key) && isTodayUndialed(row));
  if (laterUndialed >= 0) return laterUndialed;
  const laterVisible = pick((_row, key) => after.has(key));
  if (laterVisible >= 0) return laterVisible;
  const arrivedUndialed = pick((row, key) => !known.has(key) && isTodayUndialed(row));
  if (arrivedUndialed >= 0) return arrivedUndialed;
  return pick((_row, key) => !known.has(key));
}
