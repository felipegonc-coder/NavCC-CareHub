import type { SpeechStore, StoredPiece } from './types';

const NAME = 'carehub-speech';
type Name = 'recordings' | 'pieces' | 'sound';

function settled(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new DOMException('Aborted', 'AbortError'));
  });
}

/** The browser's IndexedDB. A piece's sound is kept apart, so listing pieces doesn't load it. */
export function createIdbStore(factory?: IDBFactory): SpeechStore {
  let opening: Promise<IDBDatabase> | null = null;

  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = (factory ?? indexedDB).open(NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('recordings', { keyPath: 'id' });
        db.createObjectStore('pieces', { keyPath: 'id' }).createIndex('recordingId', 'recordingId');
        db.createObjectStore('sound');
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    });

  const db = () =>
    (opening ??= open().catch((error: unknown) => {
      opening = null;
      throw error;
    }));

  async function read<T>(name: Name, get: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const tx = (await db()).transaction(name, 'readonly');
    const request = get(tx.objectStore(name));
    await settled(tx);
    return request.result;
  }

  async function change(names: Name[], work: (tx: IDBTransaction) => void): Promise<void> {
    const tx = (await db()).transaction(names, 'readwrite');
    work(tx);
    await settled(tx);
  }

  return {
    recordings: () => read('recordings', (store) => store.getAll()),
    saveRecording: (recording) =>
      change(['recordings'], (tx) => tx.objectStore('recordings').put(recording)),
    deleteRecording: (id) =>
      change(['recordings', 'pieces', 'sound'], (tx) => {
        tx.objectStore('recordings').delete(id);
        const keys = tx.objectStore('pieces').index('recordingId').getAllKeys(id);
        keys.onsuccess = () => {
          for (const key of keys.result) {
            tx.objectStore('pieces').delete(key);
            tx.objectStore('sound').delete(key);
          }
        };
      }),
    pieces: async (recordingId) => {
      const pieces: StoredPiece[] = await read('pieces', (store) =>
        store.index('recordingId').getAll(recordingId),
      );
      return pieces.sort((a, b) => a.startMs - b.startMs || a.speaker - b.speaker);
    },
    savePiece: (piece, sound) =>
      change(['pieces', 'sound'], (tx) => {
        tx.objectStore('pieces').put(piece);
        if (sound) tx.objectStore('sound').put(sound, piece.id);
      }),
    sound: (pieceId) => read('sound', (store) => store.get(pieceId)),
    deletePiece: (id) =>
      change(['pieces', 'sound'], (tx) => {
        tx.objectStore('pieces').delete(id);
        tx.objectStore('sound').delete(id);
      }),
  };
}
