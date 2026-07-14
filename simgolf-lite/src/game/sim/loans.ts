import type { Loan, LoanKind } from "../models/types";
import { BALANCE } from "../balance/balanceConfig";

export function computeWeeklyPayment(principal: number, apr: number, termWeeks: number) {
  const r = apr / 52;
  if (termWeeks <= 0) return principal;
  if (r <= 0) return principal / termWeeks;
  return (principal * r) / (1 - Math.pow(1 + r, -termWeeks));
}

export function createLoan(args: {
  kind: LoanKind;
  principal: number;
  apr: number;
  termWeeks: number;
  idSeed: number;
}): Loan {
  const weeklyPayment = computeWeeklyPayment(args.principal, args.apr, args.termWeeks);
  return {
    id: `${args.kind}-${args.idSeed}-${args.principal}-${args.termWeeks}`,
    kind: args.kind,
    principal: args.principal,
    apr: args.apr,
    termWeeks: args.termWeeks,
    weeksRemaining: args.termWeeks,
    weeklyPayment,
    balance: args.principal,
    status: "ACTIVE",
    missedPayments: 0,
  };
}

export function stepLoanWeek(loan: Loan, opts: { pay: boolean }): Loan {
  if (loan.status !== "ACTIVE") return loan;
  // Only a cleared balance counts as PAID. Term expiry with debt still owed is
  // handled as a default in the missed-payment branch (ZKU-76).
  if (loan.balance <= 0.01) {
    return { ...loan, weeksRemaining: 0, balance: 0, status: "PAID", weeklyPayment: 0 };
  }

  if (!opts.pay) {
    // Missed payment (ZKU-76): non-payment is no longer nearly free.
    //  - Capitalize the week's accrued interest into the balance (balloon grows).
    //  - Still consume a term week so perpetual non-payment can't extend the loan.
    //  - Bump APR as a penalty and re-amortize the larger balance over less time,
    //    which sharply raises the payment the player must catch up on.
    //  - After a threshold of missed payments — or if the term runs out with debt
    //    still owed — the loan DEFAULTS.
    const interest = loan.balance * (loan.apr / 52);
    const nextBalance = loan.balance + interest;
    const nextWeeks = Math.max(0, loan.weeksRemaining - 1);
    const apr = Math.min(BALANCE.loans.aprMax, loan.apr + BALANCE.loans.aprMissedPaymentBump);
    const missedPayments = loan.missedPayments + 1;
    const defaulted =
      missedPayments >= BALANCE.loans.missedPaymentsToDefault ||
      (nextWeeks <= 0 && nextBalance > 0.01);
    const weeklyPayment =
      defaulted || nextWeeks <= 0 ? 0 : computeWeeklyPayment(nextBalance, apr, nextWeeks);
    return {
      ...loan,
      apr,
      balance: nextBalance,
      weeksRemaining: nextWeeks,
      weeklyPayment,
      missedPayments,
      status: defaulted ? "DEFAULTED" : loan.status,
    };
  }

  const r = loan.apr / 52;
  const interest = loan.balance * r;
  const principalPaid = Math.max(0, loan.weeklyPayment - interest);
  const nextBalance = Math.max(0, loan.balance - principalPaid);
  const nextWeeks = loan.weeksRemaining - 1;
  if (nextBalance <= 0.01 || nextWeeks <= 0) {
    return { ...loan, balance: 0, weeksRemaining: 0, status: "PAID", weeklyPayment: 0 };
  }
  return { ...loan, balance: nextBalance, weeksRemaining: nextWeeks };
}

export function totalWeeklyPayments(loans: Loan[]) {
  return loans
    .filter((l) => l.status === "ACTIVE")
    .reduce((sum, l) => sum + (l.weeklyPayment || 0), 0);
}


