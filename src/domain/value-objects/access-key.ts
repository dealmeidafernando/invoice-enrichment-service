import { InvalidAccessKeyError } from '../errors/domain.error';

/**
 * NF-e access key: 43 digits + 1 check digit (modulo 11).
 * Whitespace is accepted on input (keys are often printed in groups of 4) and stripped.
 */
export class AccessKey {
  static readonly LENGTH = 44;

  private constructor(readonly value: string) {}

  static create(input: unknown): AccessKey {
    if (typeof input !== 'string') {
      throw new InvalidAccessKeyError('Access key must be a string.');
    }
    const digits = input.replace(/\s+/g, '');
    if (!/^\d{44}$/.test(digits)) {
      throw new InvalidAccessKeyError('Access key must have exactly 44 numeric digits.');
    }
    if (Number(digits[43]) !== AccessKey.computeCheckDigit(digits.slice(0, 43))) {
      throw new InvalidAccessKeyError('Access key has an invalid check digit.');
    }
    return new AccessKey(digits);
  }

  /** Modulo 11 with weights 2..9 from right to left. Remainder 0 or 1 yields check digit 0. */
  static computeCheckDigit(base43: string): number {
    if (!/^\d{43}$/.test(base43)) {
      throw new InvalidAccessKeyError('Check digit base must have 43 digits.');
    }
    let sum = 0;
    let weight = 2;
    for (let i = base43.length - 1; i >= 0; i--) {
      sum += Number(base43[i]) * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  }

  equals(other: AccessKey): boolean {
    return this.value === other.value;
  }
}
