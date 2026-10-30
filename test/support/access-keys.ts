import { AccessKey } from '../../src/domain';

/** State 35 (SP), YYMM 2610, issuer CNPJ, model 55, series 001 — the rest is sequential. */
const PREFIX = '3526101234567800019055001';

export function generateAccessKey(seq: number): string {
  const base = PREFIX + String(seq).padStart(43 - PREFIX.length, '0');
  return base + AccessKey.computeCheckDigit(base);
}

let counter = Date.now() % 1_000_000;
/** A fresh key on every call, for tests that must not collide with each other. */
export function newAccessKey(): string {
  return generateAccessKey(++counter);
}
