import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { SetStateAction } from "react";

const values = new Map<string, any>();
const listeners = new Set<() => void>();
const edited = new Set<string>();
const hydrated = new Set<string>();
const dirtyDrafts = new Map<string, boolean>();
let guardInstalled = false;
let database: Promise<IDBDatabase> | undefined;
function db() {
  return (database ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("isolation-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
export function setDraftValue(key: string, value: any) {
  values.set(key, value);
  edited.add(key);
  hydrated.add(key);
  listeners.forEach((fn) => fn());
  void db()
    .then((database) => {
      database
        .transaction("drafts", "readwrite")
        .objectStore("drafts")
        .put(value, key);
    })
    .catch(() => {
      // The in-memory draft and close guard remain available if storage is unavailable.
    });
}
export function clearDraftValue(key: string) {
  setDraftValue(key, []);
}
export function getDraftValue<T>(key: string): T | undefined {
  return values.get(key);
}
export function useDraftState<T>(
  key: string,
  initial: T,
): [T, (value: SetStateAction<T>) => void, boolean] {
  if (!values.has(key)) values.set(key, initial);
  const value = useSyncExternalStore(
    useCallback((fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    }, []),
    () => values.get(key),
  );
  const ready = useSyncExternalStore(
    useCallback((fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    }, []),
    () => hydrated.has(key),
  );
  useEffect(() => {
    void db()
      .then(
        (database) =>
          new Promise<any>((resolve, reject) => {
            const request = database
              .transaction("drafts")
              .objectStore("drafts")
              .get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          }),
      )
      .then((saved) => {
        if (saved !== undefined && !edited.has(key)) values.set(key, saved);
      })
      .catch(() => {})
      .finally(() => {
        hydrated.add(key);
        listeners.forEach((fn) => fn());
      });
  }, [key]);
  const setValue = useCallback(
    (next: SetStateAction<T>) =>
      setDraftValue(
        key,
        typeof next === "function"
          ? (next as (old: T) => T)(values.get(key))
          : next,
      ),
    [key],
  );
  return [value, setValue, ready];
}
export function useUnsavedChanges(dirty: boolean, key: string) {
  useEffect(() => {
    dirtyDrafts.set(key, dirty);
    if (!guardInstalled) {
      guardInstalled = true;
      window.addEventListener("beforeunload", (event) => {
        if ([...dirtyDrafts.values()].some(Boolean)) {
          event.preventDefault();
          event.returnValue = "";
        }
      });
    }
  }, [dirty, key]);
}
