import type { WorkspaceVaultSnapshot } from "../types.ts";

const DB_NAME = "clauseguard_hybrid_vault_v1";
const STORE_NAME = "workspaces";
const PBKDF2_ITERATIONS = 600_000;

interface EncryptedVaultRecord {
  workspaceId: string;
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
  updatedAtUtc: string;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Derive a non-extractable AES-GCM-256 CryptoKey using PBKDF2-SHA256 (600,000 iterations). */
export async function deriveWorkspaceKey(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false, // non-extractable key material
    ["encrypt", "decrypt"]
  );
}

export async function encryptWorkspaceSnapshot(
  snapshot: WorkspaceVaultSnapshot,
  passphrase: string,
  existingSalt?: Uint8Array
): Promise<EncryptedVaultRecord> {
  const salt = existingSalt ?? crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12)); // fresh 96-bit IV per encryption
  const key = await deriveWorkspaceKey(passphrase, salt);
  const plainBytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const aad = new TextEncoder().encode(snapshot.workspaceId);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource },
    key,
    plainBytes
  );
  return {
    workspaceId: snapshot.workspaceId,
    saltB64: toBase64(salt),
    ivB64: toBase64(iv),
    ciphertextB64: toBase64(new Uint8Array(cipherBuf)),
    updatedAtUtc: new Date().toISOString(),
  };
}

export async function decryptWorkspaceSnapshot(
  record: EncryptedVaultRecord,
  passphrase: string
): Promise<WorkspaceVaultSnapshot> {
  const salt = fromBase64(record.saltB64);
  const iv = fromBase64(record.ivB64);
  const cipher = fromBase64(record.ciphertextB64);
  const key = await deriveWorkspaceKey(passphrase, salt);
  const aad = new TextEncoder().encode(record.workspaceId);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource },
    key,
    cipher as BufferSource
  );
  const parsed = JSON.parse(new TextDecoder().decode(plainBuf)) as WorkspaceVaultSnapshot;
  if (parsed.workspaceId !== record.workspaceId) {
    throw new Error("Workspace ID binding mismatch in decrypted vault snapshot.");
  }
  return parsed;
}

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "workspaceId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveEncryptedWorkspaceToIdb(
  snapshot: WorkspaceVaultSnapshot,
  passphrase: string
): Promise<void> {
  const record = await encryptWorkspaceSnapshot(snapshot, passphrase);
  const db = await openVaultDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadEncryptedWorkspaceFromIdb(
  workspaceId: string,
  passphrase: string
): Promise<WorkspaceVaultSnapshot | null> {
  const db = await openVaultDb();
  let rec: EncryptedVaultRecord | undefined;
  try {
    rec = await new Promise<EncryptedVaultRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(workspaceId);
      req.onsuccess = () => resolve(req.result as EncryptedVaultRecord | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
  if (!rec) return null;
  return decryptWorkspaceSnapshot(rec, passphrase);
}

export async function purgeAllWorkspaceStorage(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
