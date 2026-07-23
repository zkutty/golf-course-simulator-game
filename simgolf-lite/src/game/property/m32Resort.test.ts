import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Course, World } from "../models/types";
import {
  applyPropertyCommand,
  emptyPropertyCourse,
  emptyPropertyEnterprise,
  normalizePropertyEnterprise,
  propertyAccessCapacity,
  propertyPackagePreview,
  settlePropertyDay,
  type PropertyCommand,
} from "./property";

function fixture(): { course: Course; world: World } {
  return {
    course: {
      ...DEFAULT_COURSE,
      holes: DEFAULT_COURSE.holes.map((hole, index) => index === 0 ? { ...hole, tee: { x: 44, y: 42 }, green: { x: 58, y: 50 } } : hole),
      property: emptyPropertyCourse(),
    },
    world: { ...DEFAULT_WORLD, cash: 1_000_000, reputation: 82, enterprise: emptyPropertyEnterprise() },
  };
}

function run(course: Course, world: World, command: PropertyCommand): { course: Course; world: World } {
  const result = applyPropertyCommand(course, world, command);
  expect(result.ok, result.message).toBe(true);
  return { course: result.course, world: result.world };
}

function buildLodge(course: Course, world: World): { course: Course; world: World } {
  for (const command of [
    { type: "BUILD", kind: "road" },
    { type: "BUILD", kind: "parking" },
    { type: "BUILD", kind: "lodge" },
    { type: "HIRE_SERVICE", role: "frontDesk" },
    { type: "HIRE_SERVICE", role: "housekeeping" },
  ] as PropertyCommand[]) ({ course, world } = run(course, world, command));
  return { course, world };
}

describe("M32 destination resort certification", () => {
  it("reserves every room night and rejects a stay that overlaps inventory booked in the prior week", () => {
    let { course, world } = fixture();
    ({ course, world } = buildLodge(course, world));
    const lodge = course.property!.assets.find((asset) => asset.kind === "lodge")!;
    world = {
      ...world,
      enterprise: {
        ...emptyPropertyEnterprise(),
        ...world.enterprise!,
        reservations: [{
          id: "cross-week-sellout",
          assetId: lodge.id,
          customerId: "customer-1",
          week: world.week,
          nights: 3,
          package: "room_only",
          value: lodge.price * lodge.capacity * 3,
          partySize: lodge.capacity * 2,
          roomCount: lodge.capacity,
          checkInWeek: world.week,
          checkInDay: 6,
          checkOutWeek: world.week + 1,
          checkOutDay: 2,
          status: "booked",
        }],
      },
    };

    const preview = propertyPackagePreview(course, world, "room_only");
    expect(preview.roomsRemaining).toBe(0);
    expect(preview.blockers.join(" ")).toMatch(/complete stay/i);
    const result = applyPropertyCommand(course, world, { type: "BOOK_PACKAGE", package: "room_only" });
    expect(result.ok).toBe(false);
  });

  it("executes included services on their scheduled day and refunds an invalidated component exactly once", () => {
    let { course, world } = fixture();
    ({ course, world } = buildLodge(course, world));
    for (const command of [
      { type: "BUILD", kind: "clubhouse" },
      { type: "BUILD", kind: "restaurant" },
      { type: "HIRE_SERVICE", role: "foodService" },
      { type: "BOOK_PACKAGE", package: "stay_and_play" },
    ] as PropertyCommand[]) ({ course, world } = run(course, world, command));

    const reservationId = world.enterprise!.reservations.at(-1)!.id;
    expect(world.enterprise!.reservations.at(-1)).toMatchObject({
      roomCount: 2,
      travelerSegment: "buddies",
      status: "booked",
      entitlements: [
        { kind: "room", status: "pending", redeemed: false },
        { kind: "golf", status: "pending", redeemed: false },
        { kind: "dining", status: "pending", redeemed: false },
      ],
    });

    world = { ...world, week: world.week + 1 };
    const arrival = settlePropertyDay(course, world, 0, 0);
    course = arrival.course;
    world = arrival.world;
    const checkedIn = world.enterprise!.reservations.find((reservation) => reservation.id === reservationId)!;
    expect(checkedIn.status).toBe("checked_in");
    expect(checkedIn.entitlements?.find((item) => item.kind === "room")).toMatchObject({ status: "fulfilled", redeemed: true });
    expect(checkedIn.entitlements?.find((item) => item.kind === "dining")).toMatchObject({ status: "fulfilled", redeemed: true });
    expect(checkedIn.entitlements?.find((item) => item.kind === "golf")).toMatchObject({ status: "pending", redeemed: false });
    expect(checkedIn.folio?.reduce((sum, item) => sum + item.amount, 0)).toBe(checkedIn.value);

    course = { ...course, holes: course.holes.map((hole) => ({ ...hole, tee: null, green: null })) };
    const disrupted = settlePropertyDay(course, world, 1, 0);
    const refunded = disrupted.world.enterprise!.reservations.find((reservation) => reservation.id === reservationId)!;
    expect(refunded.entitlements?.find((item) => item.kind === "golf")).toMatchObject({ status: "refunded", redeemed: false, refundAmount: expect.any(Number) });
    expect(refunded.refund).toBeGreaterThan(0);
    expect(disrupted.report.entries.filter((entry) => entry.description.includes("Package service refund"))).toHaveLength(1);

    const duplicate = settlePropertyDay(disrupted.course, disrupted.world, 1, 0);
    expect(duplicate.report).toMatchObject({ revenue: 0, costs: 0 });
    expect(normalizePropertyEnterprise(JSON.parse(JSON.stringify(duplicate.world.enterprise))).reservations.find((reservation) => reservation.id === reservationId)).toEqual(
      duplicate.world.enterprise!.reservations.find((reservation) => reservation.id === reservationId),
    );
  });

  it("only counts remote parking when a staffed shuttle connects it", () => {
    let { course, world } = fixture();
    for (const command of [
      { type: "BUILD", kind: "road" },
      { type: "BUILD", kind: "parking" },
      { type: "BUILD", kind: "overflow_parking" },
      { type: "BUILD", kind: "shuttle" },
    ] as PropertyCommand[]) ({ course, world } = run(course, world, command));
    const road = course.property!.assets.find((asset) => asset.kind === "road")!;
    ({ course, world } = run(course, world, { type: "UPGRADE", assetId: road.id }));
    const unstaffed = propertyAccessCapacity(course, world);
    ({ course, world } = run(course, world, { type: "HIRE_SERVICE", role: "shuttleDrivers" }));
    expect(propertyAccessCapacity(course, world)).toBeGreaterThan(unstaffed);
  });

  it("blocks manual packages priced beyond destination demand instead of guaranteeing profit", () => {
    let { course, world } = fixture();
    ({ course, world } = buildLodge(course, world));
    const lodge = course.property!.assets.find((asset) => asset.kind === "lodge")!;
    ({ course, world } = run(course, world, { type: "SET_PRICE", assetId: lodge.id, price: 10_000 }));
    const preview = propertyPackagePreview(course, world, "room_only");
    expect(preview.blockers.join(" ")).toMatch(/market ceiling/i);
    expect(applyPropertyCommand(course, world, { type: "BOOK_PACKAGE", package: "room_only" }).ok).toBe(false);
  });

  it("makes unsupported room overbuilding less profitable than a capacity-matched lodge", () => {
    const runPortfolio = (overbuild: boolean) => {
      let { course, world } = fixture();
      ({ course, world } = buildLodge(course, world));
      for (const kind of ["road", "parking"] as const) {
        const asset = course.property!.assets.find((candidate) => candidate.kind === kind)!;
        ({ course, world } = run(course, world, { type: "UPGRADE", assetId: asset.id }));
      }
      if (overbuild) {
        ({ course, world } = run(course, world, { type: "BUILD", kind: "hotel" }));
        ({ course, world } = run(course, world, { type: "BUILD", kind: "cottages" }));
      }
      let net = 0;
      for (let ordinal = 0; ordinal < 21; ordinal++) {
        world = { ...world, week: Math.floor(ordinal / 7) };
        const settled = settlePropertyDay(course, world, ordinal % 7, 18);
        course = settled.course;
        world = settled.world;
        net += settled.report.revenue - settled.report.costs;
      }
      return net;
    };

    expect(runPortfolio(true)).toBeLessThan(runPortfolio(false));
  });
});
