import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

export function useStoredState<T>(
  key: string,
  initialValue: T,
  options: { defer?: boolean; normalize?: (value: T) => T } = {},
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      const parsed = stored ? (JSON.parse(stored) as T) : initialValue;
      return options.normalize ? options.normalize(parsed) : parsed;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    const serialized = JSON.stringify(value);
    if (!options.defer) {
      localStorage.setItem(key, serialized);
      return;
    }
    const timeout = window.setTimeout(() => {
      localStorage.setItem(key, serialized);
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [key, value]);

  return [value, setValue];
}
