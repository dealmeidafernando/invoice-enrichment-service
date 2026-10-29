import { InvalidMoneyError, Money } from '../../src/domain';

describe('Money', () => {
  it.each<[string, bigint, string]>([
    ['1520.75', 152075n, '1520.75'],
    ['1520.7', 152070n, '1520.70'],
    ['1520', 152000n, '1520.00'],
    ['0.01', 1n, '0.01'],
  ])('converts "%s" to cents without loss', (text, cents, normalized) => {
    const amount = Money.fromDecimal(text);
    expect(amount.cents).toBe(cents);
    expect(amount.toDecimal()).toBe(normalized);
  });

  it.each(['-1.00', '1,50', '1.999', 'abc', ''])('rejects "%s"', (text) => {
    expect(() => Money.fromDecimal(text)).toThrow(InvalidMoneyError);
  });
});
