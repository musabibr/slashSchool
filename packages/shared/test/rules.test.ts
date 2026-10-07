import { describe, expect, it } from 'vitest';
import {
  computeFeeAccount,
  computeResultSheet,
  dateRangeBounds,
  formatDate,
  formatMoney,
  gradeFor,
  isIsoDate,
  normalizePhone,
  todayIn,
  weekBounds,
  whatsappLink,
} from '../src';

describe('dates', () => {
  it('computes today in the school timezone', () => {
    // 23:30 UTC on 9 May is already 10 May in Khartoum (UTC+2)
    expect(todayIn('Africa/Khartoum', new Date('2025-05-09T23:30:00Z'))).toBe('2025-05-10');
  });
  it('week starts on the configured weekday', () => {
    // 2025-05-14 is a Wednesday
    expect(weekBounds('2025-05-14', 0)).toEqual({ from: '2025-05-11', to: '2025-05-17' });
    expect(weekBounds('2025-05-14', 6)).toEqual({ from: '2025-05-10', to: '2025-05-16' });
  });
  it('range filters', () => {
    expect(dateRangeBounds('today', '2025-05-14', 0)).toEqual({ from: '2025-05-14', to: '2025-05-14' });
    expect(dateRangeBounds('month', '2025-02-14', 0)).toEqual({ from: '2025-02-01', to: '2025-02-28' });
    expect(dateRangeBounds('all', '2025-02-14', 0)).toEqual({ from: null, to: null });
  });
  it('validates ISO dates', () => {
    expect(isIsoDate('2025-02-29')).toBe(false);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('9/5/2025')).toBe(false);
  });
});

describe('results', () => {
  it('fixes the sketch: 140/230 is 60.9%, not 55%', () => {
    const sheet = computeResultSheet([
      { subjectId: 'm', subjectName: 'الرياضيات', score: 47, maxScore: 50 },
      { subjectId: 'a', subjectName: 'اللغة العربية', score: 20, maxScore: 50 },
      { subjectId: 'c', subjectName: 'الكيمياء', score: 35, maxScore: 50 },
      { subjectId: 'p', subjectName: 'الفيزياء', score: 16, maxScore: 50 },
      { subjectId: 'q', subjectName: 'القرآن الكريم', score: 22, maxScore: 30 },
    ]);
    expect(sheet.total).toBe(140);
    expect(sheet.max).toBe(230);
    expect(sheet.percentage).toBe(60.9);
    expect(sheet.grade).toBe('جيد');
    expect(sheet.incomplete).toBe(false);
  });
  it('leaves missing scores out of the totals and flags the sheet', () => {
    const sheet = computeResultSheet([
      { subjectId: 'm', subjectName: 'م', score: 40, maxScore: 50 },
      { subjectId: 'a', subjectName: 'ع', score: null, maxScore: 50 },
    ]);
    expect(sheet.max).toBe(50);
    expect(sheet.percentage).toBe(80);
    expect(sheet.incomplete).toBe(true);
  });
  it('grade bands', () => {
    expect(gradeFor(95)).toBe('ممتاز');
    expect(gradeFor(75)).toBe('جيد جداً');
    expect(gradeFor(49.9)).toBe('ضعيف');
  });
});

describe('fees', () => {
  const installments = [
    { id: '1', seq: 1, amount: 300_000, dueDate: '2025-01-01' },
    { id: '2', seq: 2, amount: 150_000, dueDate: '2025-04-01' },
    { id: '3', seq: 3, amount: 150_000, dueDate: '2025-07-01' },
  ];
  it('fixes the sketch: paid 400,000 of 600,000 leaves 200,000', () => {
    const acc = computeFeeAccount({
      installments,
      payments: [
        { amount: 300_000, paidAt: '2024-12-20' },
        { amount: 100_000, paidAt: '2025-04-03' },
      ],
      today: '2025-05-25',
    });
    expect(acc.total).toBe(600_000);
    expect(acc.paid).toBe(400_000);
    expect(acc.remaining).toBe(200_000);
    expect(acc.overdue).toBe(50_000);
    expect(acc.installments.map((i) => i.status)).toEqual(['paid', 'late', 'upcoming']);
    expect(acc.installments[1]).toMatchObject({ paid: 100_000, remaining: 50_000 });
  });
  it('applies the discount to the last installments first', () => {
    const acc = computeFeeAccount({ installments, discount: 200_000, payments: [], today: '2024-12-01' });
    expect(acc.net).toBe(400_000);
    expect(acc.installments.map((i) => i.due)).toEqual([300_000, 100_000, 0]);
    expect(acc.installments[2].status).toBe('paid');
  });
  it('records overpayment as credit', () => {
    const acc = computeFeeAccount({ installments, payments: [{ amount: 700_000, paidAt: '2025-01-01' }], today: '2025-01-02' });
    expect(acc.remaining).toBe(0);
    expect(acc.credit).toBe(100_000);
  });
});

describe('format', () => {
  it('money and dates', () => {
    expect(formatMoney(600000)).toBe('600,000');
    expect(formatDate('2025-05-09')).toBe('9/5/2025');
  });
  it('phones', () => {
    expect(normalizePhone('+249 91 234 5678')).toBe('0912345678');
    expect(normalizePhone('٠٩١٢٣٤٥٦٧٨')).toBe('0912345678');
    expect(normalizePhone('912345678')).toBe('0912345678');
    expect(whatsappLink('0912345678', 'hi')).toBe('https://wa.me/249912345678?text=hi');
  });
});
