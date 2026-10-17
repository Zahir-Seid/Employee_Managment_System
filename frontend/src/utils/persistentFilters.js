import { useCallback, useEffect, useRef, useState } from "react";

// Persistent filters: every page keeps its own filter selections when the
// user navigates away and comes back, instead of resetting to defaults. Each
// piece of state is stored separately under "ems.filters.<page>.<name>",
// so one page's filters never affect another's. Everything is wiped on logout
// (see clearPersistedFilters, called from tokenStorage.clear()).
//
// usePersistentState(key, initial) is a drop-in replacement for
// useState(initial): same value, same setter (including functional updates),
// so the filtering logic that reads/sets it doesn't change at all.
//
// - When the value equals its default, nothing is stored (so a page that was
//   never filtered keeps following its live defaults, e.g. "this month").
// - options.skipRestore: ignore what's stored and start from `initial`
//   (used when a page is opened with explicit filters, e.g. a Saved Report
//   or a deep link; the explicit filters then become the stored ones).
// - options.restore(stored, defaultValue): transform a stored value before
//   it's used (used to recompute "this month" date ranges so they never go
//   stale).
// - setDefault(next): set a value that should count as a default rather than
//   a user choice (e.g. the admin-configured default period), so it isn't
//   stored and later admin changes still apply.

const PREFIX = "ems.filters.";

function storageAvailable() {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

export function readPersistedFilter(key) {
  if (!storageAvailable()) return undefined;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function hasPersistedFilter(key) {
  return readPersistedFilter(key) !== undefined;
}

function writePersistedFilter(key, value) {
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* Non-critical: the selection just won't be remembered. */
  }
}

function removePersistedFilter(key) {
  if (!storageAvailable()) return;
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* Non-critical */
  }
}

// Called on logout (and when a session can no longer be refreshed) so the
// next person to sign in starts with default filters.
export function clearPersistedFilters() {
  if (!storageAvailable()) return;
  try {
    const doomed = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* Non-critical */
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function usePersistentState(key, initial, options = {}) {
  const { skipRestore = false, restore = null } = options;
  const defaultRef = useRef(undefined);

  const [value, setValue] = useState(() => {
    const def = typeof initial === "function" ? initial() : initial;
    defaultRef.current = JSON.stringify(def);
    if (skipRestore) return def;
    let stored = readPersistedFilter(key);
    if (stored === undefined) return def;
    // Ignore anything that no longer matches the shape of the default
    // (e.g. after an update changed what this state holds).
    if (isPlainObject(def)) {
      if (!isPlainObject(stored)) return def;
      stored = { ...def, ...stored };
    } else if (typeof stored !== typeof def) {
      return def;
    }
    return restore ? restore(stored, def) : stored;
  });

  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (JSON.stringify(value) === defaultRef.current) removePersistedFilter(key);
    else writePersistedFilter(key, value);
  }, [key, value]);

  const setDefault = useCallback((next) => {
    const resolved = typeof next === "function" ? next(valueRef.current) : next;
    defaultRef.current = JSON.stringify(resolved);
    setValue(resolved);
  }, []);

  return [value, setValue, setDefault];
}
