export interface StepReport {
  id: string;
  name: string;
  status: "Ready" | "Ran" | "Failed";
  message?: string;
}

export function stepProgressPercent(current: number, total: number, offset: number): number {
  const slotCount = Math.max(total, 1);
  const slotSize = 100 / slotCount;
  return Math.min(98, Math.round(slotSize * (current - 1 + offset)));
}
