import { useState, useEffect } from 'react';

/**
 * Returns a debounced copy of `value` that only updates after `delay` ms of
 * inactivity. Useful for reducing API calls while the user is typing.
 *
 * @param value - The value to debounce.
 * @param delay - Milliseconds to wait before propagating the latest value.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
