import { AccessKey, InvalidAccessKeyError } from '../../src/domain';
import { generateAccessKey } from '../support/access-keys';

describe('AccessKey', () => {
  it('accepts a 44-digit key with a correct check digit', () => {
    const text = generateAccessKey(1);
    expect(AccessKey.create(text).value).toBe(text);
  });

  it('strips whitespace from a key formatted in groups', () => {
    const text = generateAccessKey(2);
    const formatted = text.replace(/(\d{4})/g, '$1 ').trim();
    expect(AccessKey.create(formatted).value).toBe(text);
  });

  it.each<[string, string]>([
    ['too short', '123'],
    ['with letters', 'A'.repeat(44)],
    ['with 45 digits', '1'.repeat(45)],
    ['empty', ''],
  ])('rejects a key that is %s', (_case, input) => {
    expect(() => AccessKey.create(input)).toThrow(InvalidAccessKeyError);
  });

  it('rejects non-string input', () => {
    expect(() => AccessKey.create(12345)).toThrow(InvalidAccessKeyError);
    expect(() => AccessKey.create(undefined)).toThrow(InvalidAccessKeyError);
  });

  it('rejects a key with the wrong check digit', () => {
    const valid = generateAccessKey(3);
    const wrongDigit = (Number(valid[43]) + 1) % 10;
    expect(() => AccessKey.create(valid.slice(0, 43) + wrongDigit)).toThrow(/check digit/);
  });

  it('yields check digit 0 when the modulo 11 remainder is 0 or 1', () => {
    for (let seq = 0; seq < 50; seq++) {
      const base = generateAccessKey(seq).slice(0, 43);
      const sum = [...base].reverse().reduce((acc, d, i) => acc + Number(d) * ((i % 8) + 2), 0);
      if (sum % 11 < 2) {
        expect(AccessKey.computeCheckDigit(base)).toBe(0);
        return;
      }
    }
    throw new Error('no base with remainder 0/1 found in range; widen the loop');
  });
});
