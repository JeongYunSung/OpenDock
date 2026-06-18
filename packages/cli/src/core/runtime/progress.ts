type ProgressLevel = "ERR" | "INFO" | "OK" | "RUN" | "WARN";

export interface RuntimeProgressEvent {
  current?: number;
  dockId?: string;
  level?: ProgressLevel;
  message: string;
  percent?: number;
  phase: string;
  stepId?: string;
  total?: number;
  version?: string;
}

export type ProgressReporter = (event: RuntimeProgressEvent) => void;

export function reportProgress(
  reporter: ProgressReporter | undefined,
  event: RuntimeProgressEvent,
): void {
  reporter?.(event);
}
