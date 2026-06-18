import type { RuntimeProgressEvent } from "./core/runtime/progress.js";

export interface ChangeCommandOutputMode {
  machine: boolean;
}

interface ChangeEventProgressDetails {
  current?: number;
  dockId?: string;
  level?: "INFO" | "OK" | "RUN" | "WARN" | "ERR";
  stepId?: string;
  total?: number;
  version?: string;
}

export interface ChangeEventReporter {
  enabled: boolean;
  progress: (
    phase: string,
    message: string,
    percent: number,
    details?: ChangeEventProgressDetails,
  ) => void;
  result: (result: { success: boolean }) => void;
}

export function changeCommandOutputMode(options: {
  events?: boolean;
  json?: boolean;
}): ChangeCommandOutputMode {
  return {
    machine: options.events === true || options.json === true,
  };
}

export function createChangeEventReporter(
  operation: string,
  enabled: boolean,
): ChangeEventReporter {
  return {
    enabled,
    progress: (phase, message, percent, details = {}) => {
      if (!enabled) {
        return;
      }
      printJson({
        opendock: 1,
        type: "progress",
        operation,
        phase,
        message,
        percent: clampProgressPercent(percent),
        level: details.level ?? "RUN",
        ...(details.current === undefined ? {} : { current: details.current }),
        ...(details.dockId === undefined ? {} : { dockId: details.dockId }),
        ...(details.stepId === undefined ? {} : { stepId: details.stepId }),
        ...(details.total === undefined ? {} : { total: details.total }),
        ...(details.version === undefined ? {} : { version: details.version }),
      });
    },
    result: (result) => {
      if (!enabled) {
        return;
      }
      printJson({
        opendock: 1,
        type: "result",
        operation,
        success: result.success,
        result,
      });
    },
  };
}

export function runtimeProgressReporter(
  events: ChangeEventReporter,
  mapPercent: (percent: number) => number = (percent) => percent,
): (event: RuntimeProgressEvent) => void {
  return (event) => {
    relayRuntimeProgress(events, event, mapPercent);
  };
}

export function updateProgressPercent(index: number, total: number, phaseOffset: number): number {
  const slotCount = Math.max(total, 1);
  const slotSize = 48 / slotCount;
  return Math.min(90, Math.round(40 + slotSize * index + slotSize * phaseOffset));
}

export function updateNestedProgressPercent(
  index: number,
  total: number,
  innerPercent: number,
): number {
  const slotCount = Math.max(total, 1);
  const slotSize = 48 / slotCount;
  return Math.min(90, Math.round(40 + slotSize * index + (slotSize * innerPercent) / 100));
}

export function optionalDockEventDetails(dockId: string | undefined): ChangeEventProgressDetails {
  return dockId === undefined ? {} : { dockId };
}

export async function runMaybeQuietAsync<T>(quiet: boolean, fn: () => Promise<T>): Promise<T> {
  if (!quiet) {
    return fn();
  }
  const previous = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map((arg) => String(arg)).join(" ");
    if (isOpenDockEventOutputLine(line)) {
      previous(...args);
    }
  };
  try {
    return await fn();
  } finally {
    console.log = previous;
  }
}

export function runMaybeQuiet<T>(quiet: boolean, fn: () => T): T {
  if (!quiet) {
    return fn();
  }
  const previous = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map((arg) => String(arg)).join(" ");
    if (isOpenDockEventOutputLine(line)) {
      previous(...args);
    }
  };
  try {
    return fn();
  } finally {
    console.log = previous;
  }
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value));
}

function relayRuntimeProgress(
  events: ChangeEventReporter,
  event: RuntimeProgressEvent,
  mapPercent: (percent: number) => number,
): void {
  events.progress(event.phase, event.message, mapPercent(event.percent ?? 50), {
    ...(event.current === undefined ? {} : { current: event.current }),
    ...(event.dockId === undefined ? {} : { dockId: event.dockId }),
    ...(event.level === undefined ? {} : { level: event.level }),
    ...(event.stepId === undefined ? {} : { stepId: event.stepId }),
    ...(event.total === undefined ? {} : { total: event.total }),
    ...(event.version === undefined ? {} : { version: event.version }),
  });
}

function clampProgressPercent(percent: number): number {
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function isOpenDockEventOutputLine(line: string): boolean {
  try {
    const value = JSON.parse(line);
    return value?.opendock === 1 && typeof value.type === "string";
  } catch {
    return false;
  }
}
