export interface GradeBand {
  /** Minimum percentage (inclusive) for this band. */
  min: number;
  label: string;
}

/** Default bands; each school can override them (`schools.grade_bands`). */
export const DEFAULT_GRADE_BANDS: GradeBand[] = [
  { min: 90, label: 'ممتاز' },
  { min: 75, label: 'جيد جداً' },
  { min: 60, label: 'جيد' },
  { min: 50, label: 'مقبول' },
  { min: 0, label: 'ضعيف' },
];

export function gradeFor(percentage: number, bands: GradeBand[] = DEFAULT_GRADE_BANDS): string {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  return (sorted.find((b) => percentage >= b.min) ?? sorted[sorted.length - 1])?.label ?? '';
}

export function roundTo(value: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export interface ResultRowInput {
  subjectId: string;
  subjectName: string;
  /** null = no score entered for this student. */
  score: number | null;
  maxScore: number;
}

export interface ResultSheet {
  rows: ResultRowInput[];
  total: number;
  max: number;
  /** 0–100, one decimal. */
  percentage: number;
  grade: string;
  /** True when at least one subject has no score; those rows are left out of the totals. */
  incomplete: boolean;
}

/** Totals for a result sheet (P13). Derived values are never typed in by hand. */
export function computeResultSheet(rows: ResultRowInput[], bands: GradeBand[] = DEFAULT_GRADE_BANDS): ResultSheet {
  const scored = rows.filter((r) => r.score !== null);
  const total = scored.reduce((s, r) => s + (r.score ?? 0), 0);
  const max = scored.reduce((s, r) => s + r.maxScore, 0);
  const percentage = max > 0 ? roundTo((total / max) * 100, 1) : 0;
  return {
    rows,
    total: roundTo(total, 2),
    max,
    percentage,
    grade: max > 0 ? gradeFor(percentage, bands) : '',
    incomplete: scored.length < rows.length,
  };
}

export function isValidGradeBands(value: unknown): value is GradeBand[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (b) =>
        b &&
        typeof b === 'object' &&
        typeof (b as GradeBand).min === 'number' &&
        typeof (b as GradeBand).label === 'string',
    )
  );
}
