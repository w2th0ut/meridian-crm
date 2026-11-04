/**
 * 未接通后把首选改到另一个号码。只提交对象，不提交号码，也不拨号。
 */

export function missedNumberSwitchBody(input: { targetType: string; targetId: string }) {
  return {
    targetType: input.targetType,
    targetId: input.targetId
  };
}

export function showMissedNumberSwitch(input: { phoneCount: number; canWrite: boolean }) {
  return input.canWrite && input.phoneCount > 1;
}
