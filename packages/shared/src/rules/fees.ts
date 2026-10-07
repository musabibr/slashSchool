import type { InstallmentStatus } from '../enums';

export interface InstallmentInput {
  id: string;
  seq: number;
  amount: number;
  dueDate: string;
}

export interface PaymentInput {
  amount: number;
  paidAt: string;
}

export interface InstallmentState extends InstallmentInput {
  /** Amount owed after the discount is applied (discount reduces the last installments first). */
  due: number;
  paid: number;
  remaining: number;
  status: InstallmentStatus;
}

export interface FeeAccount {
  total: number;
  discount: number;
  /** total − discount */
  net: number;
  paid: number;
  /** net − paid, never below zero */
  remaining: number;
  /** Paid beyond what is owed. */
  credit: number;
  /** Sum of unpaid amounts on installments that are past due. */
  overdue: number;
  installments: InstallmentState[];
}

/**
 * Fee balance for one student (P9). Payments are allocated to installments oldest-first.
 * All amounts are whole SDG.
 */
export function computeFeeAccount(input: {
  installments: InstallmentInput[];
  discount?: number;
  payments: PaymentInput[];
  today: string;
}): FeeAccount {
  const installments = [...input.installments].sort((a, b) => a.seq - b.seq);
  const total = installments.reduce((s, i) => s + i.amount, 0);
  const discount = Math.min(Math.max(input.discount ?? 0, 0), total);
  const net = total - discount;
  const paid = input.payments.reduce((s, p) => s + p.amount, 0);

  // Apply the discount from the last installment backwards.
  const dues = installments.map((i) => i.amount);
  let toDiscount = discount;
  for (let k = dues.length - 1; k >= 0 && toDiscount > 0; k--) {
    const cut = Math.min(dues[k], toDiscount);
    dues[k] -= cut;
    toDiscount -= cut;
  }

  let pool = paid;
  let overdue = 0;
  const states: InstallmentState[] = installments.map((inst, k) => {
    const due = dues[k];
    const applied = Math.min(due, pool);
    pool -= applied;
    const remaining = due - applied;
    let status: InstallmentStatus;
    if (remaining === 0) status = 'paid';
    else if (inst.dueDate < input.today) status = 'late';
    else if (applied > 0) status = 'partial';
    else status = 'upcoming';
    if (status === 'late') overdue += remaining;
    return { ...inst, due, paid: applied, remaining, status };
  });

  return {
    total,
    discount,
    net,
    paid,
    remaining: Math.max(net - paid, 0),
    credit: Math.max(paid - net, 0),
    overdue,
    installments: states,
  };
}
