// Vitest global setup. idb-keyval needs an IndexedDB implementation; node
// doesn't ship one. fake-indexeddb polyfills `indexedDB` and `IDBKeyRange` on
// the global so storage tests round-trip without a browser.
import "fake-indexeddb/auto";
