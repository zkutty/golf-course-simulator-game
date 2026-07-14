import { describe, expect, it } from "vitest";
import { BALANCE } from "../balance/balanceConfig";
import { computeWeeklyPayment, createLoan, stepLoanWeek } from "./loans";
import { tickWeek } from "./tickWeek";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Loan, World } from "../models/types";

function bridge(): Loan {
  return createLoan({ kind: "BRIDGE", principal: 25_000, apr: 0.18, termWeeks: 26, idSeed: 1 });
}

describe("loans — amortization, missed payments, and default (ZKU-76)", () => {
  it("computeWeeklyPayment amortizes a positive-rate loan above the straight-line split", () => {
    const p = computeWeeklyPayment(25_000, 0.18, 26);
    // Must at least cover principal/term; interest pushes it higher.
    expect(p).toBeGreaterThan(25_000 / 26);
    expect(Number.isFinite(p)).toBe(true);
  });

  it("computeWeeklyPayment handles the zero-rate and zero-term edges", () => {
    expect(computeWeeklyPayment(1000, 0, 10)).toBeCloseTo(100);
    expect(computeWeeklyPayment(1000, 0.1, 0)).toBe(1000);
  });

  it("paying every week draws the balance down and eventually marks the loan PAID", () => {
    let loan = bridge();
    let weeks = 0;
    while (loan.status === "ACTIVE" && weeks < 200) {
      const before = loan.balance;
      loan = stepLoanWeek(loan, { pay: true });
      if (loan.status === "ACTIVE") {
        expect(loan.balance).toBeLessThan(before); // principal chips down
        expect(loan.weeksRemaining).toBeLessThan(26);
      }
      weeks++;
    }
    expect(loan.status).toBe("PAID");
    expect(loan.balance).toBe(0);
    expect(loan.weeklyPayment).toBe(0);
    expect(weeks).toBeLessThanOrEqual(26);
  });

  it("a missed payment capitalizes interest, burns a term week, bumps APR, and counts the miss", () => {
    const loan = bridge();
    const next = stepLoanWeek(loan, { pay: false });

    // Interest capitalized onto the balance — non-payment is not free.
    const expectedInterest = loan.balance * (loan.apr / 52);
    expect(next.balance).toBeCloseTo(loan.balance + expectedInterest);
    expect(next.balance).toBeGreaterThan(loan.balance);

    // A term week is consumed so perpetual non-payment can't extend the loan.
    expect(next.weeksRemaining).toBe(loan.weeksRemaining - 1);

    // APR penalty and a recorded miss.
    expect(next.apr).toBeCloseTo(loan.apr + BALANCE.loans.aprMissedPaymentBump);
    expect(next.missedPayments).toBe(1);
    expect(next.status).toBe("ACTIVE");

    // Larger balance over a shorter term ⇒ the catch-up payment rises.
    expect(next.weeklyPayment).toBeGreaterThan(loan.weeklyPayment);
  });

  it("APR is capped at aprMax across repeated misses", () => {
    let loan = { ...bridge(), apr: BALANCE.loans.aprMax };
    loan = stepLoanWeek(loan, { pay: false });
    expect(loan.apr).toBe(BALANCE.loans.aprMax);
  });

  it("enough missed payments transitions the loan to DEFAULTED and stops billing", () => {
    let loan = bridge();
    for (let i = 0; i < BALANCE.loans.missedPaymentsToDefault; i++) {
      expect(loan.status).toBe("ACTIVE");
      loan = stepLoanWeek(loan, { pay: false });
    }
    expect(loan.missedPayments).toBe(BALANCE.loans.missedPaymentsToDefault);
    expect(loan.status).toBe("DEFAULTED");
    expect(loan.weeklyPayment).toBe(0);
  });

  it("term running out with a balance still owed is treated as a default", () => {
    // One week left, but the missed payment burns it while debt remains.
    const loan: Loan = { ...bridge(), weeksRemaining: 1, missedPayments: 0 };
    const next = stepLoanWeek(loan, { pay: false });
    expect(next.weeksRemaining).toBe(0);
    expect(next.balance).toBeGreaterThan(0.01);
    expect(next.status).toBe("DEFAULTED");
  });

  it("a non-ACTIVE loan is inert", () => {
    const paid: Loan = { ...bridge(), status: "PAID", balance: 0, weeklyPayment: 0 };
    expect(stepLoanWeek(paid, { pay: true })).toEqual(paid);
    const defaulted: Loan = { ...bridge(), status: "DEFAULTED", weeklyPayment: 0 };
    expect(stepLoanWeek(defaulted, { pay: false })).toEqual(defaulted);
  });

  it("a loan that defaults during the weekly tick bankrupts the course", () => {
    // Healthy cash cushion isolates the failure to the default itself: cash never
    // touches the liquidity floor and the distress timer never exhausts, so the
    // only route to bankruptcy is the loan crossing into DEFAULTED. The payment
    // is set unpayably large so this week is a guaranteed miss — the last one.
    const loan: Loan = {
      ...bridge(),
      balance: 300_000,
      weeklyPayment: 300_000,
      weeksRemaining: 10,
      missedPayments: BALANCE.loans.missedPaymentsToDefault - 1,
    };
    const world: World = { ...DEFAULT_WORLD, cash: 200_000, loans: [loan] };

    const { world: next } = tickWeek(DEFAULT_COURSE, world, 42);

    expect(next.cash).toBeGreaterThan(BALANCE.distress.liquidityTrapCash); // not a liquidity trap
    expect(next.loans[0].status).toBe("DEFAULTED");
    expect(next.isBankrupt).toBe(true);
  });
});
