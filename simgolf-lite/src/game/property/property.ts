import type { ConcessionType, Course, World } from "../models/types";
import type {
  ClubProfessional,
  CommercialCategory,
  CommercialLedgerEntry,
  FacilityModuleKind,
  FacilityUpkeepPolicy,
  InfrastructureSurface,
  LodgingRoomClass,
  LodgingReservation,
  OutingBooking,
  PackageEntitlement,
  PropertyAsset,
  PropertyAssetCategory,
  PropertyAssetKind,
  PropertyCourseState,
  PropertyCustomer,
  PropertyDayReport,
  PropertyEnterpriseState,
  PropertyIncident,
  PropertyTier,
  ResidentialSafetyReport,
  ResidentHousehold,
  ResortFolioTransaction,
  ResortOperations,
  ResortTravelerSegment,
} from "./types";
import { isOwnedTile } from "../estate/estate";
import { buildingFootprintSet } from "../models/buildings";

export interface PropertyAssetSpec {
  kind: PropertyAssetKind;
  label: string;
  icon: string;
  category: PropertyAssetCategory;
  description: string;
  buildCost: number;
  baseCapacity: number;
  basePrice: number;
  dailyUpkeep: number;
  maxTier: PropertyTier;
  footprint: [number, number];
}

export const SURFACE_ORDER: readonly InfrastructureSurface[] = ["grass", "dirt", "gravel", "asphalt", "paver"];

export interface FacilityModuleSpec {
  kind: FacilityModuleKind;
  label: string;
  requiredShellTier: PropertyTier;
  buildCost: number;
  capacity: number;
  dailyUpkeep: number;
  parkingDemand: number;
  description: string;
}

export const FACILITY_MODULE_SPECS: Record<FacilityModuleKind, FacilityModuleSpec> = {
  check_in: moduleSpec("check_in", "Check-in desk", 1, 2_500, 24, 22, 2, "Greets golfers and routes members, outings, and resort guests."),
  pro_shop: moduleSpec("pro_shop", "Pro-shop room", 1, 5_500, 14, 52, 3, "Adds merchandise and rental capacity inside the clubhouse shell."),
  restaurant: moduleSpec("restaurant", "Dining room", 2, 9_000, 28, 96, 8, "Adds seated dining; a kitchen and food-service coverage unlock full throughput."),
  kitchen: moduleSpec("kitchen", "Commercial kitchen", 2, 7_500, 36, 88, 3, "Supports restaurant, catering, clinic, and function-room service."),
  bar: moduleSpec("bar", "Club bar", 2, 6_500, 20, 70, 5, "Adds a staffed post-round and event beverage service."),
  lockers: moduleSpec("lockers", "Locker rooms", 2, 8_000, 36, 65, 4, "Supports members, academy students, and premium outing packages."),
  member_lounge: moduleSpec("member_lounge", "Member lounge", 3, 11_000, 24, 90, 4, "Raises member loyalty but consumes room, staff, and upkeep."),
  pro_office: moduleSpec("pro_office", "Club-pro office", 2, 6_000, 8, 46, 2, "Adds lesson administration and professional booking capacity."),
  fitting_studio: moduleSpec("fitting_studio", "Teaching and fitting studio", 3, 13_000, 10, 105, 3, "Unlocks premium fittings and reliable all-weather instruction."),
  function_room: moduleSpec("function_room", "Function room", 3, 15_000, 54, 138, 14, "Hosts catered outings, clinics, meetings, and destination events."),
};

export const PROPERTY_ASSET_SPECS: Record<PropertyAssetKind, PropertyAssetSpec> = {
  road: spec("road", "Main road", "🛣️", "access", "Connects the estate to the regional road. Better surfaces improve throughput and reliability.", 2_500, 28, 0, 30, 5, [8, 2]),
  parking: spec("parking", "Guest parking", "🅿️", "access", "Every golfer, diner, student, and overnight guest needs an arrival space.", 3_500, 32, 0, 24, 5, [6, 5]),
  valet: spec("valet", "Valet court", "🚘", "access", "Premium arrival service adds parking capacity and resort appeal.", 9_000, 18, 12, 80, 3, [4, 3]),
  overflow_parking: spec("overflow_parking", "Remote overflow parking", "🚐", "access", "Peak capacity that only becomes usable when a staffed shuttle connects it to the campus.", 7_500, 42, 0, 48, 4, [8, 6]),
  shuttle: spec("shuttle", "Resort shuttle", "🚌", "access", "Moves overnight groups, luggage, and remote-parking guests without teleporting across the estate.", 12_000, 24, 8, 120, 4, [4, 2]),
  driving_range: spec("driving_range", "Driving range", "🏌️", "practice", "Sells buckets, develops customer skill, and supplies lesson demand.", 12_000, 28, 14, 110, 4, [12, 5]),
  putting_green: spec("putting_green", "Putting green", "⛳", "practice", "Low-cost practice amenity that improves loyalty and member value.", 5_500, 18, 8, 45, 4, [5, 5]),
  short_game_area: spec("short_game_area", "Short-game area", "🎯", "practice", "Chipping and bunker sessions broaden the academy offer.", 8_000, 16, 11, 65, 4, [7, 5]),
  practice_holes: spec("practice_holes", "Practice loop", "🏳️", "practice", "A compact loop for playing lessons, fittings, and warm-up rounds.", 18_000, 20, 20, 155, 4, [10, 8]),
  practice_bays: spec("practice_bays", "Covered practice bays", "🏗️", "practice", "All-weather bays raise range capacity and destination appeal.", 15_000, 24, 19, 135, 4, [8, 4]),
  clubhouse: spec("clubhouse", "Clubhouse", "🏛️", "clubhouse", "A tiered shell whose size unlocks hospitality, retail, locker, and event modules.", 20_000, 24, 0, 180, 4, [7, 6]),
  pro_shop: spec("pro_shop", "Pro shop", "🧢", "clubhouse", "Merchandise, apparel, rental sets, and club fitting revenue.", 8_000, 16, 28, 75, 4, [3, 3]),
  restaurant: spec("restaurant", "Restaurant", "🍽️", "clubhouse", "Captures spend from golfers, residents, event guests, and hotel guests.", 14_000, 34, 26, 150, 4, [5, 4]),
  bar: spec("bar", "Club bar", "🍸", "clubhouse", "Extends dwell time and increases post-round and overnight spend.", 9_000, 26, 17, 105, 4, [4, 3]),
  locker_room: spec("locker_room", "Locker rooms", "🔐", "clubhouse", "Supports memberships, outings, lessons, and premium daily-fee guests.", 10_000, 40, 6, 95, 4, [4, 4]),
  event_space: spec("event_space", "Function rooms", "🎉", "clubhouse", "Hosts outings, weddings, meetings, and destination events.", 18_000, 70, 65, 170, 4, [7, 5]),
  lodge: spec("lodge", "Golf lodge", "🛎️", "resort", "A small overnight property that unlocks stay-and-play packages.", 35_000, 16, 145, 260, 4, [7, 6]),
  hotel: spec("hotel", "Resort hotel", "🏨", "resort", "High-capacity destination lodging with substantial staffing and access needs.", 85_000, 48, 185, 620, 4, [10, 8]),
  cottages: spec("cottages", "Golf cottages", "🏡", "resort", "Premium group accommodation for buddies trips, families, and events.", 48_000, 24, 225, 330, 4, [9, 7]),
  spa: spec("spa", "Spa and wellness", "🧖", "resort", "Raises length of stay, non-golfer appeal, and room rates.", 28_000, 24, 75, 250, 4, [6, 5]),
  houses: spec("houses", "Fairway homes", "🏘️", "community", "For-sale homes create development income, residents, and errant-ball exposure.", 60_000, 20, 0, 120, 4, [12, 8]),
  condos: spec("condos", "Golf condominiums", "🏢", "community", "Higher-density homes create more customers and more safety pressure.", 75_000, 32, 0, 165, 4, [9, 8]),
  community_club: spec("community_club", "Community club", "🤝", "community", "Resident amenity that improves sales, satisfaction, memberships, and dining.", 24_000, 42, 12, 205, 4, [7, 6]),
  safety_buffer: spec("safety_buffer", "Safety buffer", "🌲", "safety", "Landscaped setbacks reduce ball-strike frequency without changing course play.", 9_000, 0, 0, 35, 4, [10, 3]),
  netting: spec("netting", "Protective netting", "🥅", "safety", "Targeted protection strongly reduces incidents but carries visible upkeep.", 13_000, 0, 0, 75, 4, [10, 1]),
};

function spec(kind: PropertyAssetKind, label: string, icon: string, category: PropertyAssetCategory, description: string, buildCost: number, baseCapacity: number, basePrice: number, dailyUpkeep: number, maxTier: PropertyTier, footprint: [number, number]): PropertyAssetSpec {
  return { kind, label, icon, category, description, buildCost, baseCapacity, basePrice, dailyUpkeep, maxTier, footprint };
}

function moduleSpec(kind: FacilityModuleKind, label: string, requiredShellTier: PropertyTier, buildCost: number, capacity: number, dailyUpkeep: number, parkingDemand: number, description: string): FacilityModuleSpec {
  return { kind, label, requiredShellTier, buildCost, capacity, dailyUpkeep, parkingDemand, description };
}

const CUSTOMER_NAMES = ["Maya Chen", "Theo Brooks", "Sam Rivera", "Priya Shah", "Jordan Reed", "Ana Torres", "Eli Martin", "Nora Kim", "Luis Bennett", "Jamie Patel", "Riley Foster", "Avery Walker"];

export function emptyPropertyCourse(): PropertyCourseState {
  return { version: 1, assets: [] };
}

/** Deterministic municipal access granted to new and pre-M31 courses so the
 * existing tee sheet keeps equivalent baseline demand without manual repair. */
export function starterPropertyCourse(): PropertyCourseState {
  return {
    version: 1,
    assets: [
      { id: "property-road-starter", kind: "road", name: "Main road", category: "access", tier: 3, x: 4, y: 4, width: 8, height: 2, capacity: 64, condition: 1, price: 0, surface: "gravel", upkeepPolicy: "standard", openHour: 7, closeHour: 20, constructionDaysRemaining: 0, enabled: true },
      { id: "property-parking-starter", kind: "parking", name: "Guest parking", category: "access", tier: 3, x: 13, y: 4, width: 6, height: 5, capacity: 72, condition: 1, price: 0, surface: "gravel", upkeepPolicy: "standard", openHour: 7, closeHour: 20, constructionDaysRemaining: 0, enabled: true },
    ],
  };
}

export function emptyPropertyEnterprise(): PropertyEnterpriseState {
  return {
    version: 2,
    sequence: 1,
    ledger: [],
    customers: CUSTOMER_NAMES.map((name, index) => ({
      id: `customer-${index + 1}`,
      name,
      segment: index < 4 ? "local" : index < 7 ? "student" : index < 10 ? "tourist" : "event_guest",
      skill: 18 + (index * 7) % 55,
      loyalty: 20 + (index * 11) % 45,
      visits: 0,
      totalSpend: 0,
      member: false,
      lastVisitWeek: 0,
    })),
    professionals: [],
    membership: { active: false, tier: 1, monthlyFee: 95, memberCount: 0, capacity: 40 },
    reservations: [],
    residents: [],
    incidents: [],
    outings: [],
    resort: { frontDesk: 0, housekeeping: 0, maintenance: 0, concierge: 0, shuttleDrivers: 0, foodService: 0, lockerAttendants: 0, dirtyRooms: 0, outOfOrderRooms: 0, serviceQueue: 0, transportWaitMinutes: 0 },
  };
}

export function normalizePropertyCourse(raw: unknown): PropertyCourseState {
  if (!raw || typeof raw !== "object") return emptyPropertyCourse();
  const candidate = raw as Partial<PropertyCourseState>;
  const assets = Array.isArray(candidate.assets) ? candidate.assets.filter(validAsset).map((asset) => {
    const assetSpec = PROPERTY_ASSET_SPECS[asset.kind];
    const tier = clamp(Math.floor(asset.tier), 1, assetSpec.maxTier) as PropertyTier;
    const surface = assetSpec.category === "access" && asset.kind !== "valet"
      ? (SURFACE_ORDER.includes(asset.surface as InfrastructureSurface) ? asset.surface as InfrastructureSurface : SURFACE_ORDER[Math.min(SURFACE_ORDER.length - 1, tier - 1)])
      : undefined;
    const openHour = clamp(Math.floor(asset.openHour ?? 7), 5, 20);
    const closeHour = clamp(Math.max(openHour + 4, Math.floor(asset.closeHour ?? 20)), 8, 24);
    return withPracticeGeometry({
      ...asset,
      id: asset.id || `property-${asset.kind}-${Math.floor(asset.x)}-${Math.floor(asset.y)}`,
      name: typeof asset.name === "string" && asset.name.trim().length >= 2 ? asset.name.trim().replace(/\s+/g, " ").slice(0, 40) : assetSpec.label,
      category: assetSpec.category,
      tier,
      x: Math.max(0, Math.floor(asset.x)),
      y: Math.max(0, Math.floor(asset.y)),
      width: assetSpec.footprint[0],
      height: assetSpec.footprint[1],
      capacity: Math.max(0, Math.floor(Number.isFinite(asset.capacity) ? asset.capacity : assetSpec.baseCapacity)),
      condition: clamp(Number.isFinite(asset.condition) ? asset.condition : 1, 0, 1),
      price: Math.max(0, Number.isFinite(asset.price) ? Math.round(asset.price) : assetSpec.basePrice),
      ...(asset.kind === "clubhouse" ? { modules: Array.isArray(asset.modules)
        ? asset.modules.filter((module) => module && module.kind in FACILITY_MODULE_SPECS).map((module) => ({
          kind: module.kind,
          tier: clamp(Math.floor(module.tier || 1), 1, 4) as PropertyTier,
          enabled: module.enabled !== false,
        }))
        : [] } : {}),
      upkeepPolicy: (["lean", "standard", "premium"] as FacilityUpkeepPolicy[]).includes(asset.upkeepPolicy as FacilityUpkeepPolicy)
        ? asset.upkeepPolicy
        : "standard",
      openHour,
      closeHour,
      constructionDaysRemaining: Math.max(0, Math.floor(asset.constructionDaysRemaining ?? 0)),
      ...(asset.lastDay && Number.isFinite(asset.lastDay.demand) ? { lastDay: {
        demand: Math.max(0, Math.floor(asset.lastDay.demand)),
        served: Math.max(0, Math.floor(asset.lastDay.served)),
        denied: Math.max(0, Math.floor(asset.lastDay.denied)),
        revenue: Math.max(0, Math.round(asset.lastDay.revenue)),
      } } : {}),
      ...(surface ? { surface } : {}),
      enabled: asset.enabled !== false,
    });
  }) : [];
  const unique = new Map(assets.map((asset) => [asset.id, asset]));
  return { version: 1, assets: [...unique.values()] };
}

export function normalizePropertyEnterprise(raw: unknown): PropertyEnterpriseState {
  const defaults = emptyPropertyEnterprise();
  if (!raw || typeof raw !== "object") return defaults;
  const candidate = raw as Partial<PropertyEnterpriseState>;
  return {
    ...defaults,
    ...candidate,
    version: 2,
    sequence: Number.isInteger(candidate.sequence) ? Math.max(1, candidate.sequence!) : 1,
    ledger: Array.isArray(candidate.ledger) ? candidate.ledger.slice(-420) : [],
    customers: normalizedCustomers(candidate.customers, defaults.customers),
    professionals: Array.isArray(candidate.professionals) ? candidate.professionals.slice(0, 8) : [],
    reservations: normalizedReservations(candidate.reservations),
    residents: Array.isArray(candidate.residents) ? candidate.residents.slice(0, 24) : [],
    incidents: Array.isArray(candidate.incidents) ? candidate.incidents.slice(-120) : [],
    outings: Array.isArray(candidate.outings) ? candidate.outings.slice(-80) : [],
    resort: normalizedResortOperations(candidate.resort, defaults.resort),
    membership: candidate.membership && typeof candidate.membership === "object" ? { ...defaults.membership, ...candidate.membership } : defaults.membership,
  };
}

function normalizedResortOperations(raw: unknown, defaults: ResortOperations): ResortOperations {
  const candidate = raw && typeof raw === "object" ? raw as Partial<ResortOperations> : {};
  const staff = (value: unknown) => Number.isFinite(value) ? clamp(Math.floor(value as number), 0, 8) : 0;
  const count = (value: unknown, max = 1_000) => Number.isFinite(value) ? clamp(Math.floor(value as number), 0, max) : 0;
  return {
    ...defaults,
    frontDesk: staff(candidate.frontDesk),
    housekeeping: staff(candidate.housekeeping),
    maintenance: staff(candidate.maintenance),
    concierge: staff(candidate.concierge),
    shuttleDrivers: staff(candidate.shuttleDrivers),
    foodService: staff(candidate.foodService),
    lockerAttendants: staff(candidate.lockerAttendants),
    dirtyRooms: count(candidate.dirtyRooms),
    outOfOrderRooms: count(candidate.outOfOrderRooms),
    serviceQueue: count(candidate.serviceQueue),
    transportWaitMinutes: count(candidate.transportWaitMinutes, 1_440),
  };
}

function normalizedReservations(raw: unknown): LodgingReservation[] {
  if (!Array.isArray(raw)) return [];
  const validPackages = new Set<LodgingReservation["package"]>(["room_only", "stay_and_play", "academy", "event"]);
  const validStatuses = new Set<NonNullable<LodgingReservation["status"]>>(["booked", "checked_in", "checked_out", "cancelled"]);
  const validRoomClasses = new Set<LodgingRoomClass>(["standard", "deluxe", "suite", "villa"]);
  const validEntitlements = new Set<PackageEntitlement["kind"]>(["room", "golf", "practice", "dining", "spa"]);
  return raw.filter((value): value is LodgingReservation => {
    if (!value || typeof value !== "object") return false;
    const reservation = value as LodgingReservation;
    return typeof reservation.id === "string"
      && typeof reservation.assetId === "string"
      && typeof reservation.customerId === "string"
      && validPackages.has(reservation.package)
      && Number.isFinite(reservation.week)
      && Number.isFinite(reservation.nights)
      && Number.isFinite(reservation.value);
  }).map((reservation) => {
    const checkInWeek = Math.max(0, Math.floor(reservation.checkInWeek ?? reservation.week));
    const checkInDay = clamp(Math.floor(reservation.checkInDay ?? 0), 0, 6);
    const nights = clamp(Math.floor(reservation.nights), 1, 14);
    const checkout = ordinalToWeekDay(checkInWeek * 7 + checkInDay + nights);
    const entitlementIds = new Set<string>();
    const entitlements = (Array.isArray(reservation.entitlements) ? reservation.entitlements : [])
      .filter((entitlement): entitlement is PackageEntitlement => {
        if (!entitlement || typeof entitlement.id !== "string" || !validEntitlements.has(entitlement.kind) || entitlementIds.has(entitlement.id)) return false;
        entitlementIds.add(entitlement.id);
        return true;
      })
      .map((entitlement) => {
        const redeemed = entitlement.redeemed === true || entitlement.status === "fulfilled" || entitlement.status === "substituted";
        return {
          ...entitlement,
          quantity: clamp(Math.floor(entitlement.quantity ?? 1), 1, 16),
          scheduledWeek: Math.max(0, Math.floor(entitlement.scheduledWeek ?? checkInWeek)),
          scheduledDay: clamp(Math.floor(entitlement.scheduledDay ?? checkInDay), 0, 6),
          status: entitlement.status ?? (redeemed ? "fulfilled" : "pending"),
          redeemed,
          refundAmount: Math.max(0, Math.round(entitlement.refundAmount ?? 0)),
        };
      });
    const folio = (Array.isArray(reservation.folio) ? reservation.folio : [])
      .filter((item): item is ResortFolioTransaction => !!item && typeof item.id === "string" && Number.isFinite(item.amount))
      .slice(-80)
      .map((item) => ({ ...item, amount: Math.round(item.amount * 100) / 100 }));
    return {
      ...reservation,
      week: checkInWeek,
      nights,
      value: Math.max(0, Math.round(reservation.value)),
      partySize: clamp(Math.floor(reservation.partySize ?? 1), 1, 16),
      roomCount: clamp(Math.floor(reservation.roomCount ?? Math.ceil((reservation.partySize ?? 1) / 2)), 1, 64),
      companionCount: clamp(Math.floor(reservation.companionCount ?? 0), 0, 12),
      checkInWeek,
      checkInDay,
      checkOutWeek: Math.max(checkInWeek, Math.floor(reservation.checkOutWeek ?? checkout.week)),
      checkOutDay: clamp(Math.floor(reservation.checkOutDay ?? checkout.day), 0, 6),
      deposit: Math.max(0, Math.round(reservation.deposit ?? 0)),
      refund: Math.max(0, Math.round(reservation.refund ?? 0)),
      status: validStatuses.has(reservation.status ?? "booked") ? reservation.status ?? "booked" : "booked",
      roomClass: validRoomClasses.has(reservation.roomClass ?? "standard") ? reservation.roomClass ?? "standard" : "standard",
      transportMode: reservation.transportMode ?? "self_drive",
      vehicleCount: clamp(Math.floor(reservation.vehicleCount ?? Math.ceil((reservation.partySize ?? 1) / 3)), 0, 6),
      luggageReady: reservation.luggageReady !== false,
      revalidation: reservation.revalidation ?? "valid",
      entitlements,
      folio,
    };
  }).slice(-120);
}

function normalizedCustomers(raw: unknown, fallback: PropertyCustomer[]): PropertyCustomer[] {
  if (!Array.isArray(raw) || raw.length === 0) return fallback;
  const normalized = raw.filter((value): value is PropertyCustomer => {
    if (!value || typeof value !== "object") return false;
    const customer = value as PropertyCustomer;
    return typeof customer.id === "string" && typeof customer.name === "string" && Number.isFinite(customer.skill) && Number.isFinite(customer.loyalty);
  }).map((customer) => ({
    ...customer,
    skill: clamp(customer.skill, 0, 100),
    loyalty: clamp(customer.loyalty, 0, 100),
    visits: Math.max(0, Math.floor(customer.visits || 0)),
    totalSpend: Math.max(0, customer.totalSpend || 0),
    lastVisitWeek: Math.max(0, Math.floor(customer.lastVisitWeek || 0)),
    member: customer.member === true,
  }));
  if (normalized.length <= 256) return normalized;
  return normalized.sort((a, b) => Number(b.member) - Number(a.member) || b.lastVisitWeek - a.lastVisitWeek || b.loyalty - a.loyalty || a.id.localeCompare(b.id)).slice(0, 256);
}

function validAsset(value: unknown): value is PropertyAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as PropertyAsset;
  return typeof asset.id === "string" && asset.kind in PROPERTY_ASSET_SPECS && Number.isFinite(asset.x) && Number.isFinite(asset.y) && Number.isFinite(asset.tier);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function assetOf(course: Course, kind: PropertyAssetKind): PropertyAsset | undefined {
  return normalizePropertyCourse(course.property).assets.find((asset) => asset.kind === kind && isOperational(asset));
}

export function propertyAccessCapacity(course: Course, world?: World): number {
  const assets = normalizePropertyCourse(course.property).assets;
  const road = assets.find((asset) => asset.kind === "road" && asset.enabled);
  const parking = assets.find((asset) => asset.kind === "parking" && asset.enabled);
  // Before the player formalizes access, limited roadside/grass overflow keeps
  // existing courses playable while creating a clear capacity pressure.
  if (!road || !parking) return 18;
  const valet = assets.find((asset) => asset.kind === "valet" && asset.enabled);
  const overflow = assets.find((asset) => asset.kind === "overflow_parking" && asset.enabled);
  const shuttle = assets.find((asset) => asset.kind === "shuttle" && asset.enabled);
  const shuttleDrivers = world ? normalizePropertyEnterprise(world.enterprise).resort.shuttleDrivers : 0;
  const quality = Math.min(surfaceLevel(road.surface), surfaceLevel(parking.surface));
  const condition = Math.min(road.condition, parking.condition);
  const connectedOverflow = overflow && shuttle && shuttleDrivers > 0 ? Math.min(overflow.capacity, shuttle.capacity * shuttleDrivers) : 0;
  return Math.max(12, Math.floor(Math.min(road.capacity, parking.capacity + (valet?.capacity ?? 0) + connectedOverflow) * (0.7 + quality * 0.1) * condition));
}

export function propertyAccessMultiplier(course: Course, plannedGolfers: number, world?: World): number {
  if (plannedGolfers <= 0) return 1;
  return clamp(propertyAccessCapacity(course, world) / plannedGolfers, 0.55, 1.15);
}

function surfaceLevel(surface: InfrastructureSurface | undefined): number {
  return Math.max(1, SURFACE_ORDER.indexOf(surface ?? "grass") + 1);
}

function isOperational(asset: PropertyAsset): boolean {
  return asset.enabled && (asset.constructionDaysRemaining ?? 0) <= 0;
}

function operatingHoursFactor(asset: PropertyAsset): number {
  return clamp(((asset.closeHour ?? 20) - (asset.openHour ?? 7)) / 13, 0.25, 1.25);
}

function upkeepCostFactor(policy: FacilityUpkeepPolicy | undefined): number {
  return policy === "lean" ? 0.65 : policy === "premium" ? 1.55 : 1;
}

function hasFacilityCapability(course: Course, standalone: PropertyAssetKind, module: FacilityModuleKind): boolean {
  const property = normalizePropertyCourse(course.property);
  return property.assets.some((asset) => isOperational(asset) && (
    asset.kind === standalone
    || asset.kind === "clubhouse" && asset.modules?.some((candidate) => candidate.kind === module && candidate.enabled)
  ));
}

export interface PropertyUpgradePreview {
  assetId: string;
  nextTier: PropertyTier;
  cost: number;
  downtimeDays: number;
  capacityDelta: number;
  upkeepDelta: number;
  parkingDemandDelta: number;
  breakEvenVisitorsPerDay: number;
  width: number;
  height: number;
  blocker?: string;
}

export function propertyUpgradePreview(course: Course, assetId: string): PropertyUpgradePreview | null {
  const property = normalizePropertyCourse(course.property);
  const asset = property.assets.find((candidate) => candidate.id === assetId);
  if (!asset) return null;
  const assetSpec = PROPERTY_ASSET_SPECS[asset.kind];
  if (asset.tier >= assetSpec.maxTier) return null;
  const nextTier = (asset.tier + 1) as PropertyTier;
  const cost = Math.round(assetSpec.buildCost * (0.65 + asset.tier * 0.35));
  const nextCapacity = Math.round(assetSpec.baseCapacity * (1 + (nextTier - 1) * 0.62));
  const footprintGrowth = asset.kind === "clubhouse" && nextTier >= 3 ? 1 : 0;
  const width = asset.width + footprintGrowth;
  const height = asset.height + footprintGrowth;
  const candidate = { ...asset, width, height };
  const blocker = propertySiteBlocker(course, property.assets, candidate, asset.id) ?? undefined;
  const upkeepDelta = Math.round(assetSpec.dailyUpkeep * 0.28 * upkeepCostFactor(asset.upkeepPolicy));
  const contributionPerVisitor = Math.max(4, asset.price * (1 - categoryCogs(asset.kind === "pro_shop" ? "retail" : asset.kind === "restaurant" || asset.kind === "bar" ? "food_beverage" : asset.category === "practice" ? "practice" : "events")));
  return {
    assetId,
    nextTier,
    cost,
    downtimeDays: Math.max(1, asset.tier),
    capacityDelta: nextCapacity - asset.capacity,
    upkeepDelta,
    parkingDemandDelta: Math.max(1, Math.ceil((nextCapacity - asset.capacity) / 8)),
    breakEvenVisitorsPerDay: Math.ceil((cost / 104 + upkeepDelta) / contributionPerVisitor),
    width,
    height,
    blocker,
  };
}

export type PropertyCommand =
  | { type: "BUILD"; kind: PropertyAssetKind }
  | { type: "UPGRADE"; assetId: string }
  | { type: "MAINTAIN"; assetId: string }
  | { type: "SET_PRICE"; assetId: string; price: number }
  | { type: "SET_HOURS"; assetId: string; openHour: number; closeHour: number }
  | { type: "SET_UPKEEP"; assetId: string; policy: FacilityUpkeepPolicy }
  | { type: "RENAME"; assetId: string; name: string }
  | { type: "ROTATE_PRACTICE"; assetId: string }
  | { type: "INSTALL_MODULE"; module: FacilityModuleKind }
  | { type: "TOGGLE_MODULE"; module: FacilityModuleKind }
  | { type: "TOGGLE"; assetId: string }
  | { type: "MOVE"; assetId: string; dx: number; dy: number }
  | { type: "REMOVE"; assetId: string }
  | { type: "HIRE_PRO" }
  | { type: "LAUNCH_MEMBERSHIP" }
  | { type: "UPGRADE_MEMBERSHIP" }
  | { type: "HIRE_SERVICE"; role: "frontDesk" | "housekeeping" | "maintenance" | "concierge" | "shuttleDrivers" | "foodService" | "lockerAttendants" }
  | { type: "BOOK_PACKAGE"; package: LodgingReservation["package"] }
  | { type: "BOOK_OUTING"; package?: OutingBooking["package"] }
  | { type: "CANCEL_OUTING"; outingId: string }
  | { type: "RECOVER_SERVICE" }
  | { type: "BUYBACK"; assetId: string };

export interface PropertyCommandResult {
  ok: boolean;
  course: Course;
  world: World;
  message: string;
}

export interface OutingPreview {
  package: OutingBooking["package"];
  guests: number;
  gross: number;
  variableCost: number;
  deposit: number;
  parkingDemand: number;
  blockers: string[];
}

export interface ResortPackagePreview {
  package: LodgingReservation["package"];
  lodgingId?: string;
  lodgingName?: string;
  travelerSegment: ResortTravelerSegment;
  roomClass: LodgingRoomClass;
  partySize: number;
  companionCount: number;
  roomCount: number;
  nights: number;
  checkInWeek: number;
  checkInDay: number;
  checkOutWeek: number;
  checkOutDay: number;
  value: number;
  deposit: number;
  estimatedCost: number;
  estimatedMargin: number;
  roomsRemaining: number;
  blockers: string[];
}

const PACKAGE_PROFILES: Record<LodgingReservation["package"], {
  travelerSegment: ResortTravelerSegment;
  partySize: number;
  companionCount: number;
  roomCount: number;
  nights: number;
}> = {
  room_only: { travelerSegment: "couples", partySize: 2, companionCount: 1, roomCount: 1, nights: 2 },
  stay_and_play: { travelerSegment: "buddies", partySize: 4, companionCount: 0, roomCount: 2, nights: 2 },
  academy: { travelerSegment: "academy", partySize: 2, companionCount: 0, roomCount: 1, nights: 3 },
  event: { travelerSegment: "corporate", partySize: 6, companionCount: 2, roomCount: 3, nights: 3 },
};

function reservationOrdinal(reservation: LodgingReservation, endpoint: "checkIn" | "checkOut"): number {
  if (endpoint === "checkIn") return (reservation.checkInWeek ?? reservation.week) * 7 + (reservation.checkInDay ?? 0);
  return (reservation.checkOutWeek ?? reservation.week) * 7 + (reservation.checkOutDay ?? 6);
}

function roomsReservedOn(reservations: LodgingReservation[], assetId: string, ordinal: number): number {
  return reservations
    .filter((reservation) => reservation.assetId === assetId
      && reservation.status !== "cancelled"
      && reservationOrdinal(reservation, "checkIn") <= ordinal
      && reservationOrdinal(reservation, "checkOut") > ordinal)
    .reduce((sum, reservation) => sum + (reservation.roomCount ?? Math.ceil((reservation.partySize ?? 1) / 2)), 0);
}

function lodgingPreference(packageKind: LodgingReservation["package"], asset: PropertyAsset): number {
  if (packageKind === "event") return asset.kind === "hotel" ? 4 : asset.kind === "cottages" ? 3 : 2;
  if (packageKind === "stay_and_play") return asset.kind === "cottages" ? 4 : asset.kind === "lodge" ? 3 : 2;
  if (packageKind === "academy") return asset.kind === "lodge" ? 4 : asset.kind === "hotel" ? 3 : 2;
  return asset.kind === "hotel" ? 4 : asset.kind === "lodge" ? 3 : 2;
}

function roomClassFor(asset: PropertyAsset): LodgingRoomClass {
  if (asset.kind === "cottages") return "villa";
  if (asset.kind === "hotel" && asset.tier >= 3) return "suite";
  if (asset.tier >= 2) return "deluxe";
  return "standard";
}

export function propertyPackagePreview(course: Course, world: World, packageKind: LodgingReservation["package"]): ResortPackagePreview {
  const enterprise = normalizePropertyEnterprise(world.enterprise);
  const profile = PACKAGE_PROFILES[packageKind];
  const checkInWeek = world.week + 1;
  const checkInDay = 0;
  const checkInOrdinal = checkInWeek * 7 + checkInDay;
  const checkout = ordinalToWeekDay(checkInOrdinal + profile.nights);
  const lodging = normalizePropertyCourse(course.property).assets
    .filter((asset) => isOperational(asset) && ["lodge", "hotel", "cottages"].includes(asset.kind))
    .sort((a, b) => lodgingPreference(packageKind, b) - lodgingPreference(packageKind, a) || b.tier - a.tier || a.id.localeCompare(b.id))
    .find((asset) => Array.from({ length: profile.nights }, (_, night) => asset.capacity - roomsReservedOn(enterprise.reservations, asset.id, checkInOrdinal + night))
      .every((remaining) => remaining >= profile.roomCount));
  const blockers: string[] = [];
  if (!lodging) blockers.push("No lodging property has enough clean room nights for the complete stay.");
  if (enterprise.resort.frontDesk < 1) blockers.push("Staff the front desk before selling rooms.");
  if (enterprise.resort.housekeeping < 1) blockers.push("Staff housekeeping before selling rooms.");
  if (packageKind === "stay_and_play" && !course.holes.some((hole) => hole.tee && hole.green)) blockers.push("Publish a playable course for stay-and-play.");
  if (packageKind === "academy" && !normalizePropertyCourse(course.property).assets.some((asset) => isOperational(asset) && asset.category === "practice")) blockers.push("Open a practice facility for the academy itinerary.");
  if (packageKind === "academy" && enterprise.professionals.length < 1) blockers.push("Hire a club professional for the academy itinerary.");
  if (packageKind === "event" && !hasFacilityCapability(course, "event_space", "function_room")) blockers.push("Open function space for the event itinerary.");
  if (packageKind !== "room_only" && (!hasFacilityCapability(course, "restaurant", "restaurant") || enterprise.resort.foodService < 1)) blockers.push("Open staffed dining for the included meal.");
  if (propertyAccessCapacity(course, world) < profile.partySize + 8) blockers.push(`Provide arrival capacity for at least ${profile.partySize + 8} simultaneous guests.`);
  const shuttle = normalizePropertyCourse(course.property).assets.find((asset) => isOperational(asset) && asset.kind === "shuttle");
  if (lodging && (lodging.kind === "hotel" || lodging.kind === "cottages") && (!shuttle || enterprise.resort.shuttleDrivers < 1)) blockers.push("A staffed shuttle is required for hotel or cottage itineraries.");
  const baseRate = lodging?.price ?? 0;
  const amenityBonus = normalizePropertyCourse(course.property).assets.filter((asset) => isOperational(asset) && ["spa", "restaurant", "driving_range"].includes(asset.kind)).length * 0.06;
  const marketCeiling = lodging ? Math.round(PROPERTY_ASSET_SPECS[lodging.kind].basePrice * (0.9 + world.reputation / 220 + amenityBonus)) : 0;
  if (lodging && baseRate > marketCeiling * 1.25) blockers.push(`The ${lodging.name} rate is above the ${marketCeiling.toLocaleString()} market ceiling for current destination appeal.`);
  const effectiveRate = Math.min(baseRate, marketCeiling || baseRate);
  const roomRevenue = effectiveRate * profile.roomCount * profile.nights;
  const packagePremium = packageKind === "room_only" ? 0 : packageKind === "stay_and_play" ? 240 * profile.partySize : packageKind === "academy" ? 210 * profile.partySize : 310 * profile.partySize;
  const value = Math.round(roomRevenue + packagePremium);
  const variableCost = Math.round(roomRevenue * 0.27 + packagePremium * (packageKind === "event" ? 0.38 : 0.24));
  const serviceCost = Math.round(profile.roomCount * profile.nights * 28 + profile.partySize * (packageKind === "room_only" ? 4 : 18));
  const estimatedCost = variableCost + serviceCost;
  const roomsRemaining = lodging ? Math.min(...Array.from({ length: profile.nights }, (_, night) => lodging.capacity - roomsReservedOn(enterprise.reservations, lodging.id, checkInOrdinal + night))) : 0;
  return {
    package: packageKind,
    lodgingId: lodging?.id,
    lodgingName: lodging?.name,
    ...profile,
    roomClass: lodging ? roomClassFor(lodging) : "standard",
    checkInWeek,
    checkInDay,
    checkOutWeek: checkout.week,
    checkOutDay: checkout.day,
    value,
    deposit: Math.round(value * 0.25),
    estimatedCost,
    estimatedMargin: value - estimatedCost,
    roomsRemaining,
    blockers,
  };
}

export function propertyOutingPreview(course: Course, world: World, packageKind: OutingBooking["package"]): OutingPreview {
  const enterprise = normalizePropertyEnterprise(world.enterprise);
  const venue = normalizePropertyCourse(course.property).assets.find((asset) => isOperational(asset) && asset.kind === "event_space");
  const guests = Math.min(venue?.capacity ?? 36, packageKind === "golf_only" ? 40 : packageKind === "golf_clinic" ? 24 : packageKind === "destination_event" ? 54 : 48);
  const perGuest = packageKind === "golf_only" ? 92 : packageKind === "golf_clinic" ? 148 : packageKind === "destination_event" ? 235 : 175;
  const gross = guests * perGuest;
  const variableCost = Math.round(gross * (packageKind === "golf_only" ? 0.12 : 0.3));
  const blockers: string[] = [];
  if (!venue && !hasFacilityCapability(course, "event_space", "function_room")) blockers.push("Open function space or install a function-room module.");
  if (!course.holes.some((hole) => hole.tee && hole.green)) blockers.push("Publish a playable golf routing.");
  if ((packageKind === "golf_clinic") && enterprise.professionals.length === 0) blockers.push("Hire a club professional for the clinic.");
  if ((packageKind === "golf_catering" || packageKind === "destination_event") && (!hasFacilityCapability(course, "restaurant", "restaurant") || enterprise.resort.foodService < 1)) blockers.push("Open staffed dining for catering.");
  if (packageKind === "destination_event" && !normalizePropertyCourse(course.property).assets.some((asset) => isOperational(asset) && ["lodge", "hotel", "cottages"].includes(asset.kind))) blockers.push("Open lodging for a destination event.");
  if (propertyAccessCapacity(course, world) < guests + 16) blockers.push(`Expand arrival capacity to at least ${guests + 16}.`);
  if (enterprise.outings.some((outing) => outing.week === world.week + 1 && outing.day === 5 && outing.status === "scheduled")) blockers.push("The peak outing slot next week is already booked.");
  return { package: packageKind, guests, gross, variableCost, deposit: Math.round(gross * 0.2), parkingDemand: Math.ceil(guests / 2.4), blockers };
}

export function applyPropertyCommand(course: Course, world: World, command: PropertyCommand): PropertyCommandResult {
  const property = normalizePropertyCourse(course.property);
  let enterprise = normalizePropertyEnterprise(world.enterprise);
  if (world.isBankrupt) return outcome(false, course, world, "The property cannot invest while bankrupt.");

  if (command.type === "INSTALL_MODULE" || command.type === "TOGGLE_MODULE") {
    const clubhouseIndex = property.assets.findIndex((asset) => asset.kind === "clubhouse");
    if (clubhouseIndex < 0) return outcome(false, course, world, "Build a clubhouse shell before configuring room modules.");
    const clubhouse = property.assets[clubhouseIndex];
    const moduleSpec = FACILITY_MODULE_SPECS[command.module];
    const existing = clubhouse.modules?.find((module) => module.kind === command.module);
    if (command.type === "TOGGLE_MODULE") {
      if (!existing) return outcome(false, course, world, `${moduleSpec.label} is not installed.`);
      const modules = clubhouse.modules!.map((module) => module.kind === command.module ? { ...module, enabled: !module.enabled } : module);
      const assets = property.assets.map((asset, index) => index === clubhouseIndex ? { ...clubhouse, modules } : asset);
      return outcome(true, { ...course, property: { ...property, assets } }, world, `${moduleSpec.label} ${existing.enabled ? "closed" : "reopened"}.`);
    }
    if (existing) return outcome(false, course, world, `${moduleSpec.label} is already installed.`);
    if (clubhouse.tier < moduleSpec.requiredShellTier) return outcome(false, course, world, `${moduleSpec.label} requires clubhouse shell tier ${moduleSpec.requiredShellTier}.`);
    const roomSlots = clubhouse.tier + 1;
    if ((clubhouse.modules?.length ?? 0) >= roomSlots) return outcome(false, course, world, `The tier ${clubhouse.tier} shell has no free room slots; expand it first.`);
    if (world.cash < moduleSpec.buildCost) return outcome(false, course, world, `Need $${moduleSpec.buildCost.toLocaleString()} to install ${moduleSpec.label}.`);
    const modules = [...(clubhouse.modules ?? []), { kind: command.module, tier: 1 as PropertyTier, enabled: true }];
    const assets = property.assets.map((asset, index) => index === clubhouseIndex ? { ...clubhouse, modules, constructionDaysRemaining: Math.max(clubhouse.constructionDaysRemaining ?? 0, 1) } : asset);
    return outcome(true, { ...course, property: { ...property, assets } }, { ...world, cash: world.cash - moduleSpec.buildCost }, `${moduleSpec.label} installed; the clubhouse will reopen after one construction day.`);
  }

  if (command.type === "BUILD") {
    const assetSpec = PROPERTY_ASSET_SPECS[command.kind];
    if (property.assets.some((asset) => asset.kind === command.kind)) return outcome(false, course, world, `${assetSpec.label} is already built; upgrade it instead.`);
    const blocked = prerequisiteMessage(command.kind, course, world);
    if (blocked) return outcome(false, course, world, blocked);
    if (world.cash < assetSpec.buildCost) return outcome(false, course, world, `Need $${assetSpec.buildCost.toLocaleString()} to build ${assetSpec.label}.`);
    const placement = findPlacement(course, property.assets, assetSpec);
    if (!placement) return outcome(false, course, world, `No valid owned site can fit ${assetSpec.label}; clear water, buildings, holes, or overlapping facilities.`);
    let asset = createAsset(property.assets, assetSpec, placement);
    if (command.kind === "houses" || command.kind === "condos") {
      const safety = analyzeResidentialSafety({ ...course, property: { ...property, assets: [...property.assets, asset] } }, asset.id);
      if (safety.eligibility === "blocked") return outcome(false, course, world, `Residential phase blocked at this site: corridor exposure ${Math.round(safety.score)}/100. Add a safety buffer/netting or revise nearby golf geometry.`);
      asset = { ...asset, tenure: "sold" };
    }
    let cash = world.cash - assetSpec.buildCost;
    const entries: CommercialLedgerEntry[] = [];
    if (command.kind === "houses" || command.kind === "condos") {
      const safety = analyzeResidentialSafety({ ...course, property: { ...property, assets: [...property.assets, asset] } }, asset.id);
      const marketMultiplier = clamp(0.58 + world.reputation / 200 + propertyAccessCapacity(course) / 400 - safety.score / 260, 0.62, 1.24);
      const saleRevenue = Math.round(assetSpec.buildCost * marketMultiplier);
      cash += saleRevenue;
      const resident: ResidentHousehold = { id: `residents-${asset.id}`, assetId: asset.id, units: asset.units ?? 0, occupied: Math.floor((asset.units ?? 0) * 0.72), satisfaction: 76, complaints: 0 };
      enterprise = { ...enterprise, residents: [...enterprise.residents, resident] };
      entries.push(makeEntry(enterprise, world.week, 0, asset.id, "real_estate", `${assetSpec.label} initial closings`, saleRevenue, 0, resident.occupied));
      enterprise.sequence += 1;
    }
    enterprise = { ...enterprise, ledger: [...enterprise.ledger, ...entries].slice(-420) };
    return outcome(true, { ...course, property: { ...property, assets: [...property.assets, asset] } }, { ...world, cash, enterprise }, `${assetSpec.label} opened at tier 1.`);
  }

  if (command.type === "HIRE_PRO") {
    if (!property.assets.some((asset) => asset.category === "practice")) return outcome(false, course, world, "Build a practice facility before hiring a club professional.");
    const cost = 4_000;
    if (world.cash < cost) return outcome(false, course, world, "Need $4,000 for recruiting and equipment.");
    if (enterprise.professionals.length >= 4) return outcome(false, course, world, "The academy already has its maximum four professionals.");
    const index = enterprise.professionals.length;
    const pro: ClubProfessional = { id: `club-pro-${index + 1}`, name: ["Alex Morgan", "Casey Woods", "Morgan Lee", "Taylor Green"][index], tier: 1, lessonPrice: 65, weeklyWage: 1_050, bookings: 0 };
    enterprise = { ...enterprise, professionals: [...enterprise.professionals, pro] };
    return outcome(true, course, { ...world, cash: world.cash - cost, enterprise }, `${pro.name} joined the academy.`);
  }

  if (command.type === "LAUNCH_MEMBERSHIP") {
    if (enterprise.membership.active) return outcome(false, course, world, "Memberships are already active.");
    if (!assetOf(course, "clubhouse") || !property.assets.some((asset) => asset.category === "practice")) return outcome(false, course, world, "Memberships require a clubhouse and at least one practice amenity.");
    if (world.cash < 2_500) return outcome(false, course, world, "Need $2,500 to launch the membership program.");
    enterprise = { ...enterprise, membership: { ...enterprise.membership, active: true, memberCount: 24 }, customers: enterprise.customers.map((customer, index) => index < 4 ? { ...customer, member: true, segment: "member" } : customer) };
    return outcome(true, course, { ...world, cash: world.cash - 2_500, enterprise }, "Founding memberships launched with 24 members.");
  }

  if (command.type === "UPGRADE_MEMBERSHIP") {
    const membership = enterprise.membership;
    if (!membership.active) return outcome(false, course, world, "Launch memberships first.");
    if (membership.tier >= 4) return outcome(false, course, world, "Membership program is already at the top tier.");
    const cost = 3_500 * (membership.tier + 1);
    if (world.cash < cost) return outcome(false, course, world, `Need $${cost.toLocaleString()} for the membership upgrade.`);
    enterprise = { ...enterprise, membership: { ...membership, tier: (membership.tier + 1) as PropertyTier, monthlyFee: membership.monthlyFee + 35, capacity: membership.capacity + 35, memberCount: Math.min(membership.capacity + 35, membership.memberCount + 18) } };
    return outcome(true, course, { ...world, cash: world.cash - cost, enterprise }, "Membership benefits and capacity upgraded.");
  }

  if (command.type === "HIRE_SERVICE") {
    const labels = { frontDesk: "front-desk agent", housekeeping: "housekeeper", maintenance: "maintenance technician", concierge: "concierge", shuttleDrivers: "shuttle driver", foodService: "food-service attendant", lockerAttendants: "locker attendant" } as const;
    if (enterprise.resort[command.role] >= 8) return outcome(false, course, world, `The ${labels[command.role]} team is already at capacity.`);
    if (world.cash < 2_500) return outcome(false, course, world, "Need $2,500 for recruiting, uniforms, and training.");
    enterprise = { ...enterprise, resort: { ...enterprise.resort, [command.role]: enterprise.resort[command.role] + 1 } };
    return outcome(true, course, { ...world, cash: world.cash - 2_500, enterprise }, `Hired one ${labels[command.role]}.`);
  }

  if (command.type === "BOOK_PACKAGE") {
    const preview = propertyPackagePreview(course, world, command.package);
    if (preview.blockers.length > 0 || !preview.lodgingId) return outcome(false, course, world, preview.blockers.join(" "));
    const lodging = property.assets.find((asset) => asset.id === preview.lodgingId)!;
    const id = `reservation-${enterprise.sequence}`;
    const serviceDay = ordinalToWeekDay(preview.checkInWeek * 7 + preview.checkInDay + 1);
    const entitlements: PackageEntitlement[] = [
      { id: `${id}-room`, kind: "room", scheduledWeek: preview.checkInWeek, scheduledDay: preview.checkInDay, quantity: preview.roomCount * preview.nights, status: "pending", redeemed: false },
      ...(command.package === "stay_and_play" || command.package === "event" ? [{ id: `${id}-golf`, kind: "golf" as const, scheduledWeek: serviceDay.week, scheduledDay: serviceDay.day, quantity: preview.partySize - preview.companionCount, status: "pending" as const, redeemed: false }] : []),
      ...(command.package === "academy" ? [{ id: `${id}-practice`, kind: "practice" as const, scheduledWeek: serviceDay.week, scheduledDay: serviceDay.day, quantity: preview.partySize, status: "pending" as const, redeemed: false }] : []),
      ...(command.package !== "room_only" ? [{ id: `${id}-dining`, kind: "dining" as const, scheduledWeek: preview.checkInWeek, scheduledDay: preview.checkInDay, quantity: preview.partySize, status: "pending" as const, redeemed: false }] : []),
      ...(command.package === "room_only" && property.assets.some((asset) => isOperational(asset) && asset.kind === "spa") ? [{ id: `${id}-spa`, kind: "spa" as const, scheduledWeek: serviceDay.week, scheduledDay: serviceDay.day, quantity: preview.partySize, status: "pending" as const, redeemed: false }] : []),
    ];
    const folio: ResortFolioTransaction[] = [{
      id: `${id}-folio-deposit`,
      week: world.week,
      day: 0,
      category: "deposit",
      description: `${command.package.replaceAll("_", " ")} advance deposit`,
      amount: preview.deposit,
      included: false,
    }];
    const reservation: LodgingReservation = {
      id,
      assetId: lodging.id,
      customerId: enterprise.customers[enterprise.sequence % enterprise.customers.length]?.id ?? "guest",
      week: preview.checkInWeek,
      nights: preview.nights,
      package: command.package,
      value: preview.value,
      partySize: preview.partySize,
      roomCount: preview.roomCount,
      roomClass: preview.roomClass,
      travelerSegment: preview.travelerSegment,
      companionCount: preview.companionCount,
      checkInWeek: preview.checkInWeek,
      checkInDay: preview.checkInDay,
      checkOutWeek: preview.checkOutWeek,
      checkOutDay: preview.checkOutDay,
      deposit: preview.deposit,
      refund: 0,
      status: "booked",
      transportMode: lodging.kind === "hotel" || lodging.kind === "cottages" ? "shuttle" : "self_drive",
      vehicleCount: lodging.kind === "cottages" ? Math.ceil(preview.partySize / 3) : 0,
      luggageReady: true,
      revalidation: "valid",
      entitlements,
      folio,
    };
    const entry = makeEntry(enterprise, world.week, 0, lodging.id, "lodging", `${command.package.replaceAll("_", " ")} package deposit`, preview.deposit, 0, preview.partySize);
    enterprise = { ...enterprise, sequence: enterprise.sequence + 1, reservations: [...enterprise.reservations, reservation].slice(-120), ledger: [...enterprise.ledger, entry].slice(-420) };
    return outcome(true, course, { ...world, cash: world.cash + preview.deposit, enterprise }, `${command.package.replaceAll("_", " ")} package booked at ${lodging.name} for week ${preview.checkInWeek}; ${preview.deposit.toLocaleString()} deposit collected.`);
  }

  if (command.type === "BOOK_OUTING") {
    const packageKind = command.package ?? "golf_catering";
    const preview = propertyOutingPreview(course, world, packageKind);
    if (preview.blockers.length > 0) return outcome(false, course, world, preview.blockers.join(" "));
    const venue = assetOf(course, "event_space") ?? property.assets.find((asset) => asset.kind === "clubhouse");
    const outing = { id: `outing-${enterprise.sequence}`, week: world.week + 1, day: 5, guests: preview.guests, package: packageKind, gross: preview.gross, deposit: preview.deposit, status: "scheduled" as const };
    const entry = makeEntry(enterprise, world.week, 0, venue?.id, "events", `${packageKind.replaceAll("_", " ")} outing deposit`, preview.deposit, 0, preview.guests);
    enterprise = { ...enterprise, sequence: enterprise.sequence + 1, outings: [...enterprise.outings, outing].slice(-80), ledger: [...enterprise.ledger, entry].slice(-420) };
    return outcome(true, course, { ...world, cash: world.cash + preview.deposit, enterprise }, `${packageKind.replaceAll("_", " ")} booked for week ${outing.week}; ${preview.deposit.toLocaleString()} deposit collected.`);
  }

  if (command.type === "CANCEL_OUTING") {
    const outing = enterprise.outings.find((candidate) => candidate.id === command.outingId && candidate.status === "scheduled");
    if (!outing) return outcome(false, course, world, "That outing is no longer scheduled.");
    const refund = Math.round(outing.deposit * 0.8);
    if (world.cash < refund) return outcome(false, course, world, `Need $${refund.toLocaleString()} cash to issue the outing refund.`);
    const entry = makeEntry(enterprise, world.week, 0, undefined, "events", `${outing.package.replaceAll("_", " ")} cancellation refund`, 0, refund, outing.guests);
    enterprise = { ...enterprise, sequence: enterprise.sequence + 1, outings: enterprise.outings.map((candidate) => candidate.id === outing.id ? { ...candidate, status: "cancelled" as const } : candidate), ledger: [...enterprise.ledger, entry].slice(-420) };
    return outcome(true, course, { ...world, cash: world.cash - refund, enterprise }, `Outing cancelled; ${refund.toLocaleString()} refunded and the non-refundable planning fee retained.`);
  }

  if (command.type === "RECOVER_SERVICE") {
    const affected = enterprise.resort.dirtyRooms + enterprise.resort.outOfOrderRooms;
    if (affected <= 0 && enterprise.resort.serviceQueue <= 0) return outcome(false, course, world, "Resort service is already caught up.");
    const cost = 450 + affected * 90;
    if (world.cash < cost) return outcome(false, course, world, `Need $${cost.toLocaleString()} for contractors and guest recovery.`);
    enterprise = { ...enterprise, resort: { ...enterprise.resort, dirtyRooms: 0, outOfOrderRooms: 0, serviceQueue: 0, transportWaitMinutes: 0 } };
    return outcome(true, course, { ...world, cash: world.cash - cost, enterprise }, "Service recovery completed; rooms and queues reset.");
  }

  if (command.type === "BUYBACK") {
    const asset = property.assets.find((candidate) => candidate.id === command.assetId && (candidate.kind === "houses" || candidate.kind === "condos"));
    const residents = enterprise.residents.find((resident) => resident.assetId === command.assetId);
    if (!asset || !residents || residents.occupied <= 0) return outcome(false, course, world, "No sold residential units are available for buyback.");
    const cost = Math.round(PROPERTY_ASSET_SPECS[asset.kind].buildCost * 1.45 + residents.occupied * 2_500);
    if (world.cash < cost) return outcome(false, course, world, `Need $${cost.toLocaleString()} for negotiated buybacks and relocation.`);
    const assets = property.assets.map((candidate) => candidate.id === asset.id ? { ...candidate, tenure: "reacquired" as const } : candidate);
    const entry = makeEntry(enterprise, world.week, 0, asset.id, "real_estate", "Residential buyback and relocation", 0, cost, residents.occupied);
    enterprise = { ...enterprise, sequence: enterprise.sequence + 1, residents: enterprise.residents.filter((resident) => resident.assetId !== asset.id), ledger: [...enterprise.ledger, entry].slice(-420) };
    return outcome(true, { ...course, property: { ...property, assets } }, { ...world, cash: world.cash - cost, enterprise }, `${asset.name} reacquired; the land can now be repurposed.`);
  }

  const index = property.assets.findIndex((asset) => "assetId" in command && asset.id === command.assetId);
  if (index < 0) return outcome(false, course, world, "That property asset no longer exists.");
  const asset = property.assets[index];
  const assets = property.assets.slice();
  if (command.type === "TOGGLE") {
    assets[index] = { ...asset, enabled: !asset.enabled };
    return outcome(true, { ...course, property: { ...property, assets } }, world, `${asset.name} ${assets[index].enabled ? "reopened" : "closed"}.`);
  }
  if (command.type === "RENAME") {
    const name = command.name.trim().replace(/\s+/g, " ").slice(0, 40);
    if (name.length < 2) return outcome(false, course, world, "Facility names must contain at least two characters.");
    assets[index] = { ...asset, name };
    return outcome(true, { ...course, property: { ...property, assets } }, world, `${name} saved.`);
  }
  if (command.type === "SET_HOURS") {
    const openHour = clamp(Math.floor(command.openHour), 5, 20);
    const closeHour = clamp(Math.floor(command.closeHour), 8, 24);
    if (closeHour - openHour < 4) return outcome(false, course, world, "Operating hours must span at least four hours.");
    assets[index] = { ...asset, openHour, closeHour };
    return outcome(true, { ...course, property: { ...property, assets } }, world, `${asset.name} will operate ${openHour}:00–${closeHour}:00.`);
  }
  if (command.type === "SET_UPKEEP") {
    assets[index] = { ...asset, upkeepPolicy: command.policy };
    return outcome(true, { ...course, property: { ...property, assets } }, world, `${asset.name} switched to ${command.policy} upkeep.`);
  }
  if (command.type === "ROTATE_PRACTICE") {
    if (asset.category !== "practice") return outcome(false, course, world, "Only practice geometry has a hitting direction.");
    assets[index] = rotatePracticeGeometry(asset);
    return outcome(true, { ...course, property: { ...property, assets } }, world, `${asset.name} hitting direction rotated within its safety footprint.`);
  }
  if (command.type === "MOVE") {
    const dx = Math.sign(command.dx);
    const dy = Math.sign(command.dy);
    const next = {
      ...asset,
      x: asset.x + dx,
      y: asset.y + dy,
      route: asset.route ? { ...asset.route, points: asset.route.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) } : undefined,
      stations: asset.stations?.map((station) => ({ ...station, x: station.x + dx, y: station.y + dy })),
    };
    const blocker = propertySiteBlocker(course, property.assets, next, asset.id);
    if (blocker) return outcome(false, course, world, `Cannot move ${asset.name}: ${blocker}.`);
    const cost = 150 * asset.tier;
    if (world.cash < cost) return outcome(false, course, world, `Need $${cost.toLocaleString()} to revise the site plan.`);
    assets[index] = withPracticeGeometry(next);
    return outcome(true, { ...course, property: { ...property, assets } }, { ...world, cash: world.cash - cost }, `${asset.name} moved one tile.`);
  }
  if (command.type === "REMOVE") {
    if ((asset.kind === "houses" || asset.kind === "condos") && enterprise.residents.some((resident) => resident.assetId === asset.id && resident.occupied > 0)) return outcome(false, course, world, "Occupied homes cannot be removed; a negotiated buyback is required.");
    const salvage = Math.round(PROPERTY_ASSET_SPECS[asset.kind].buildCost * 0.3 * asset.condition);
    return outcome(true, { ...course, property: { ...property, assets: assets.filter((candidate) => candidate.id !== asset.id) } }, { ...world, cash: world.cash + salvage }, `${asset.name} removed; ${salvage.toLocaleString()} recovered.`);
  }
  if (command.type === "SET_PRICE") {
    assets[index] = { ...asset, price: Math.max(0, Math.round(command.price)) };
    return outcome(true, { ...course, property: { ...property, assets } }, world, `${asset.name} pricing updated.`);
  }
  if (command.type === "MAINTAIN") {
    const cost = Math.round(PROPERTY_ASSET_SPECS[asset.kind].buildCost * 0.08 * (1.1 - asset.condition));
    if (asset.condition >= 0.99) return outcome(false, course, world, `${asset.name} is already in excellent condition.`);
    if (world.cash < cost) return outcome(false, course, world, `Need $${cost.toLocaleString()} for the work order.`);
    assets[index] = { ...asset, condition: 1 };
    return outcome(true, { ...course, property: { ...property, assets } }, { ...world, cash: world.cash - cost }, `${asset.name} restored to excellent condition.`);
  }
  const assetSpec = PROPERTY_ASSET_SPECS[asset.kind];
  const preview = propertyUpgradePreview(course, asset.id);
  if (!preview) return outcome(false, course, world, `${asset.name} is already at its maximum tier.`);
  if (preview.blocker) return outcome(false, course, world, `Cannot expand ${asset.name}: ${preview.blocker}.`);
  if (world.cash < preview.cost) return outcome(false, course, world, `Need $${preview.cost.toLocaleString()} for the tier upgrade.`);
  const nextTier = preview.nextTier;
  assets[index] = {
    ...asset,
    tier: nextTier,
    capacity: Math.round(assetSpec.baseCapacity * (1 + (nextTier - 1) * 0.62)),
    condition: 1,
    width: preview.width,
    height: preview.height,
    constructionDaysRemaining: preview.downtimeDays,
    surface: asset.surface ? SURFACE_ORDER[Math.min(SURFACE_ORDER.length - 1, nextTier - 1)] : undefined,
    units: asset.units ? Math.round(asset.units * 1.45) : undefined,
  };
  return outcome(true, { ...course, property: { ...property, assets } }, { ...world, cash: world.cash - preview.cost }, `${asset.name} upgraded to tier ${nextTier}${assets[index].surface ? ` ${assets[index].surface}` : ""}; ${preview.downtimeDays} construction day${preview.downtimeDays === 1 ? "" : "s"}.`);
}

function prerequisiteMessage(kind: PropertyAssetKind, course: Course, world: World): string | null {
  const assets = normalizePropertyCourse(course.property).assets;
  const has = (target: PropertyAssetKind) => assets.some((asset) => asset.kind === target);
  if (kind !== "road" && kind !== "parking" && (!has("road") || !has("parking"))) return "Build both a main road connection and guest parking first.";
  if (["pro_shop", "restaurant", "locker_room", "event_space"].includes(kind) && !has("clubhouse")) return "Expand the clubhouse campus first.";
  if (kind === "bar" && (!has("clubhouse") || !has("restaurant"))) return "The bar requires both a clubhouse and restaurant.";
  if (["hotel", "cottages", "spa"].includes(kind) && !has("lodge")) return "Open a golf lodge before expanding the resort.";
  if (["hotel", "houses", "condos"].includes(kind)) {
    const road = assets.find((asset) => asset.kind === "road");
    const parking = assets.find((asset) => asset.kind === "parking");
    if ((road?.tier ?? 0) < 2 || (parking?.tier ?? 0) < 2) return "This scale of development requires tier 2 gravel-or-better roads and parking.";
  }
  if (["houses", "condos"].includes(kind) && world.reputation < 55) return "Residential buyers require reputation 55 or higher.";
  if (kind === "community_club" && !has("houses") && !has("condos")) return "Build a residential phase first.";
  return null;
}

function createAsset(assets: PropertyAsset[], assetSpec: PropertyAssetSpec, placement: { x: number; y: number }): PropertyAsset {
  const tier: PropertyTier = 1;
  return withPracticeGeometry({
    id: `property-${assetSpec.kind}-${assets.length + 1}`,
    kind: assetSpec.kind,
    name: assetSpec.label,
    category: assetSpec.category,
    tier,
    x: placement.x,
    y: placement.y,
    width: assetSpec.footprint[0],
    height: assetSpec.footprint[1],
    capacity: assetSpec.baseCapacity,
    condition: 1,
    price: assetSpec.basePrice,
    surface: assetSpec.category === "access" && assetSpec.kind !== "valet" ? "grass" : undefined,
    units: assetSpec.kind === "houses" ? 16 : assetSpec.kind === "condos" ? 28 : undefined,
    modules: assetSpec.kind === "clubhouse" ? [] : undefined,
    upkeepPolicy: "standard",
    openHour: assetSpec.category === "clubhouse" ? 8 : 7,
    closeHour: assetSpec.kind === "bar" ? 23 : 20,
    constructionDaysRemaining: 0,
    enabled: true,
  });
}

function findPlacement(course: Course, assets: PropertyAsset[], assetSpec: PropertyAssetSpec): { x: number; y: number } | null {
  const parcel = course.estate?.parcels.find((candidate) => candidate.id === course.estate?.starterParcelId);
  const minX = parcel?.bounds.minX ?? 3;
  const minY = parcel?.bounds.minY ?? 3;
  const maxX = parcel?.bounds.maxX ?? course.width - 3;
  const maxY = parcel?.bounds.maxY ?? course.height - 3;
  for (let y = minY; y <= maxY - assetSpec.footprint[1] + 1; y += 2) {
    for (let x = minX; x <= maxX - assetSpec.footprint[0] + 1; x += 2) {
      const candidate: PropertyAsset = { id: "preview", kind: assetSpec.kind, name: assetSpec.label, category: assetSpec.category, tier: 1, x, y, width: assetSpec.footprint[0], height: assetSpec.footprint[1], capacity: assetSpec.baseCapacity, condition: 1, price: assetSpec.basePrice, enabled: true };
      if (!propertySiteBlocker(course, assets, candidate)) return { x, y };
    }
  }
  return null;
}

function propertySiteBlocker(course: Course, assets: PropertyAsset[], candidate: PropertyAsset, excludeId?: string): string | null {
  if (candidate.x < 0 || candidate.y < 0 || candidate.x + candidate.width > course.width || candidate.y + candidate.height > course.height) return "the footprint is outside the estate";
  const buildingTiles = buildingFootprintSet(course);
  for (let y = candidate.y; y < candidate.y + candidate.height; y++) for (let x = candidate.x; x < candidate.x + candidate.width; x++) {
    if (course.estate && !isOwnedTile(course, x, y)) return "the land is not owned";
    if (course.tiles[y * course.width + x] === "water") return "the footprint crosses water";
    if (buildingTiles.has(y * course.width + x)) return "the footprint overlaps a course building";
  }
  for (const asset of assets) {
    if (asset.id === excludeId) continue;
    if (rectanglesOverlap(candidate, asset)) return `the footprint overlaps ${asset.name}`;
  }
  for (const obstacle of course.obstacles) if (obstacle.x >= candidate.x && obstacle.x < candidate.x + candidate.width && obstacle.y >= candidate.y && obstacle.y < candidate.y + candidate.height) return `the footprint is blocked by a ${obstacle.type}`;
  for (const hole of course.holes) for (const marker of [hole.tee, hole.green, ...Object.values(hole.teeBoxes ?? {}), ...Object.values(hole.pinPositions ?? {})]) {
    if (marker && marker.x >= candidate.x && marker.x < candidate.x + candidate.width && marker.y >= candidate.y && marker.y < candidate.y + candidate.height) return "the footprint covers a tee or pin";
  }
  return null;
}

function rectanglesOverlap(a: Pick<PropertyAsset, "x" | "y" | "width" | "height">, b: Pick<PropertyAsset, "x" | "y" | "width" | "height">): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function withPracticeGeometry(asset: PropertyAsset): PropertyAsset {
  if (asset.category !== "practice") return asset;
  if (asset.route?.points.length && asset.stations?.length) return asset;
  const centerY = asset.y + Math.floor(asset.height / 2);
  return {
    ...asset,
    route: { id: `route-${asset.id}`, points: [{ x: asset.x, y: centerY }, { x: asset.x + asset.width - 1, y: centerY }] },
    stations: [
      { id: `station-${asset.id}-entry`, kind: asset.kind === "putting_green" ? "cup" : "tee", x: asset.x, y: centerY, capacity: Math.max(1, Math.floor(asset.capacity / 4)) },
      { id: `station-${asset.id}-target`, kind: asset.kind === "putting_green" ? "cup" : "target", x: asset.x + asset.width - 1, y: centerY, capacity: Math.max(1, Math.floor(asset.capacity / 4)) },
    ],
  };
}

function rotatePracticeGeometry(asset: PropertyAsset): PropertyAsset {
  const horizontal = !asset.route || Math.abs((asset.route.points.at(-1)?.x ?? 0) - (asset.route.points[0]?.x ?? 0)) >= Math.abs((asset.route.points.at(-1)?.y ?? 0) - (asset.route.points[0]?.y ?? 0));
  const start = horizontal
    ? { x: asset.x + Math.floor(asset.width / 2), y: asset.y }
    : { x: asset.x, y: asset.y + Math.floor(asset.height / 2) };
  const end = horizontal
    ? { x: start.x, y: asset.y + asset.height - 1 }
    : { x: asset.x + asset.width - 1, y: start.y };
  const firstKind = asset.kind === "putting_green" ? "cup" as const : "tee" as const;
  const secondKind = asset.kind === "putting_green" ? "cup" as const : "target" as const;
  return {
    ...asset,
    route: { id: asset.route?.id ?? `route-${asset.id}`, points: [start, end] },
    stations: [
      { id: `station-${asset.id}-entry`, kind: firstKind, ...start, capacity: Math.max(1, Math.floor(asset.capacity / 4)) },
      { id: `station-${asset.id}-target`, kind: secondKind, ...end, capacity: Math.max(1, Math.floor(asset.capacity / 4)) },
    ],
  };
}

export function analyzeResidentialSafety(course: Course, assetId?: string): ResidentialSafetyReport {
  const assets = normalizePropertyCourse(course.property).assets;
  const residential = assets.filter((asset) => (asset.kind === "houses" || asset.kind === "condos") && (!assetId || asset.id === assetId));
  if (residential.length === 0) return { score: 0, eligibility: "safe", expectedExposure: 0, outlierExposure: 0, mitigation: 0, contributions: [] };
  const safetyAssets = assets.filter((asset) => asset.enabled && asset.category === "safety");
  const contributionMap = new Map<string, { holeId: string; holeName: string; distanceTiles: number; expectedRisk: number; outlierRisk: number }>();
  let expectedExposure = 0;
  let outlierExposure = 0;
  let mitigation = 0;
  for (const homes of residential) {
    const target = { x: homes.x + homes.width / 2, y: homes.y + homes.height / 2 };
    const unitFactor = Math.sqrt(Math.max(1, homes.units ?? 1)) / 4;
    for (const [index, hole] of course.holes.entries()) {
      if (!hole.tee || !hole.green) continue;
      const distance = pointSegmentDistance(target, hole.tee, hole.green);
      const expected = distance < 4 ? 42 : distance < 8 ? 26 : distance < 14 ? 11 : distance < 22 ? 3 : 0;
      const outlier = distance < 10 ? 18 : distance < 18 ? 10 : distance < 30 ? 4 : 0;
      if (expected + outlier <= 0) continue;
      const key = hole.id ?? `hole-${index + 1}`;
      const previous = contributionMap.get(key);
      contributionMap.set(key, {
        holeId: key,
        holeName: hole.name ?? `Hole ${index + 1}`,
        distanceTiles: previous ? Math.min(previous.distanceTiles, distance) : distance,
        expectedRisk: (previous?.expectedRisk ?? 0) + expected * unitFactor,
        outlierRisk: (previous?.outlierRisk ?? 0) + outlier * unitFactor,
      });
      expectedExposure += expected * unitFactor;
      outlierExposure += outlier * unitFactor;
    }
    for (const safety of safetyAssets) {
      const center = { x: safety.x + safety.width / 2, y: safety.y + safety.height / 2 };
      const distance = Math.hypot(center.x - target.x, center.y - target.y);
      if (distance > 26) continue;
      const base = safety.kind === "netting" ? 18 : 10;
      mitigation += base * safety.tier * safety.condition * (1 - distance / 32);
    }
  }
  const score = clamp(expectedExposure * 0.7 + outlierExposure * 0.3 - mitigation, 0, 100);
  return {
    score,
    eligibility: score >= 70 ? "blocked" : score >= 35 ? "marginal" : "safe",
    expectedExposure,
    outlierExposure,
    mitigation,
    contributions: [...contributionMap.values()].sort((a, b) => b.expectedRisk + b.outlierRisk - (a.expectedRisk + a.outlierRisk)).slice(0, 12),
  };
}

function pointSegmentDistance(point: { x: number; y: number }, from: { x: number; y: number }, to: { x: number; y: number }): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0) return Math.hypot(point.x - from.x, point.y - from.y);
  const t = clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq, 0, 1);
  return Math.hypot(point.x - (from.x + dx * t), point.y - (from.y + dy * t));
}

function outcome(ok: boolean, course: Course, world: World, message: string): PropertyCommandResult {
  return { ok, course, world, message };
}

export function settlePropertyDay(course: Course, world: World, day: number, coreGolfers: number): { course: Course; world: World; report: PropertyDayReport } {
  const property = normalizePropertyCourse(course.property);
  let enterprise = normalizePropertyEnterprise(world.enterprise);
  const settlementKey = `${world.week}-${day}`;
  if (enterprise.lastSettlementKey === settlementKey) return { course: { ...course, property }, world: { ...world, enterprise }, report: { revenue: 0, costs: 0, visitors: 0, accessCapacity: propertyAccessCapacity(course, world), demand: 0, denied: 0, entries: [], incidents: [] } };
  let sequence = enterprise.sequence;
  const entries: CommercialLedgerEntry[] = [];
  const incidents: PropertyIncident[] = [];
  const facilityStats = new Map<string, { demand: number; served: number; denied: number; revenue: number }>();
  const enabled = property.assets.filter(isOperational);
  const accessCapacity = propertyAccessCapacity(course, world);
  const resortBeds = capacity(enabled, ["lodge", "hotel", "cottages"]);
  const residentCount = enterprise.residents.reduce((sum, resident) => sum + resident.occupied, 0);
  const baseDemand = Math.max(0, Math.round(4 + world.reputation * 0.13 + world.marketingLevel * 3 + residentCount * 0.12 + resortBeds * 0.1));
  let remainingAccess = Math.max(0, accessCapacity - coreGolfers);
  let propertyVisitors = 0;
  const add = (asset: PropertyAsset | undefined, category: CommercialCategory, description: string, visitors: number, revenue: number, cost = 0, demand = visitors) => {
    if (revenue <= 0 && cost <= 0 && visitors <= 0) return;
    const grossRevenue = Math.round(revenue);
    const variableCost = Math.round(grossRevenue * categoryCogs(category));
    const totalCost = Math.round(cost) + variableCost;
    const denied = Math.max(0, demand - visitors);
    entries.push({ id: `commercial-${sequence++}`, week: world.week, day, assetId: asset?.id, category, description, revenue: grossRevenue, cost: totalCost, visitors, grossRevenue, variableCost, netContribution: grossRevenue - totalCost, demand, served: visitors, denied });
    if (asset) {
      const previous = facilityStats.get(asset.id) ?? { demand: 0, served: 0, denied: 0, revenue: 0 };
      facilityStats.set(asset.id, { demand: previous.demand + demand, served: previous.served + visitors, denied: previous.denied + denied, revenue: previous.revenue + grossRevenue });
    }
  };
  const practiceAssets = enabled.filter((asset) => asset.category === "practice");
  const memberShare = enterprise.customers.filter((customer) => customer.member).length / Math.max(1, enterprise.customers.length);

  const today = world.week * 7 + day;
  let dirtyRooms = Math.max(0, enterprise.resort.dirtyRooms - enterprise.resort.housekeeping * 6);
  const outOfOrderRooms = Math.max(0, enterprise.resort.outOfOrderRooms - enterprise.resort.maintenance * 2);
  let serviceQueue = 0;
  let transportWaitMinutes = 0;
  const staffedLodging = enterprise.resort.frontDesk > 0 && enterprise.resort.housekeeping > 0;
  let reservationsState: LodgingReservation[] = enterprise.reservations.map((reservation) => {
    const checkout = (reservation.checkOutWeek ?? reservation.week) * 7 + (reservation.checkOutDay ?? 6);
    if (reservation.status === "checked_in" && checkout <= today) {
      dirtyRooms += reservation.roomCount ?? Math.ceil((reservation.partySize ?? 1) / 2);
      return { ...reservation, status: "checked_out" as const };
    }
    return reservation;
  });
  const occupiedByAsset = new Map<string, number>();
  for (const reservation of reservationsState) {
    if (reservation.status !== "checked_in") continue;
    occupiedByAsset.set(reservation.assetId, (occupiedByAsset.get(reservation.assetId) ?? 0) + (reservation.roomCount ?? Math.ceil((reservation.partySize ?? 1) / 2)));
  }
  reservationsState = reservationsState.map((reservation) => {
    const checkin = (reservation.checkInWeek ?? reservation.week) * 7 + (reservation.checkInDay ?? 0);
    if (reservation.status !== "booked" || checkin !== today) return reservation;
    const lodging = property.assets.find((asset) => asset.id === reservation.assetId && isOperational(asset));
    const party = reservation.partySize ?? 1;
    const roomCount = reservation.roomCount ?? Math.ceil(party / 2);
    const roomsAvailable = Math.max(0, (lodging?.capacity ?? 0) - dirtyRooms - outOfOrderRooms - (occupiedByAsset.get(reservation.assetId) ?? 0));
    if (!staffedLodging || !lodging || roomsAvailable < roomCount || remainingAccess < party) {
      const refund = reservation.deposit ?? 0;
      serviceQueue += party;
      const incident: PropertyIncident = { id: `incident-${sequence++}`, week: world.week, day, assetId: lodging?.id ?? reservation.assetId, kind: "service_failure", severity: 2, cost: refund, description: !staffedLodging ? "An overnight package was cancelled because reception or housekeeping was not staffed." : "An overnight package was cancelled because room or arrival capacity was unavailable." };
      incidents.push(incident);
      add(lodging, "lodging", incident.description, 0, 0, refund, party);
      const refundFolio: ResortFolioTransaction = { id: `${reservation.id}-folio-refund`, week: world.week, day, category: "refund", description: "Cancelled-stay deposit refund", amount: -refund, included: false };
      return {
        ...reservation,
        refund,
        status: "cancelled" as const,
        revalidation: "cancelled" as const,
        folio: [...(reservation.folio ?? []), refundFolio],
        entitlements: reservation.entitlements?.map((entitlement) => ({ ...entitlement, status: "refunded" as const, redeemed: false, refundAmount: entitlement.kind === "room" ? refund : 0, note: incident.description })),
      };
    }
    remainingAccess -= party;
    propertyVisitors += party;
    occupiedByAsset.set(reservation.assetId, (occupiedByAsset.get(reservation.assetId) ?? 0) + roomCount);
    const balance = Math.max(0, reservation.value - (reservation.deposit ?? 0));
    add(lodging, "lodging", `${reservation.package.replaceAll("_", " ")} package check-in`, party, balance, 0, party);
    const roomFolio: ResortFolioTransaction = { id: `${reservation.id}-folio-room`, week: world.week, day, category: "room", description: `${roomCount} ${reservation.roomClass ?? "standard"} room${roomCount === 1 ? "" : "s"} for ${reservation.nights} nights`, amount: balance, included: false };
    return {
      ...reservation,
      status: "checked_in" as const,
      revalidation: "valid" as const,
      folio: [...(reservation.folio ?? []), roomFolio],
      entitlements: reservation.entitlements?.map((entitlement) => entitlement.kind === "room"
        ? { ...entitlement, status: "fulfilled" as const, redeemed: true, note: "Room inventory assigned at check-in." }
        : entitlement),
    };
  });

  const shuttle = enabled.find((asset) => asset.kind === "shuttle");
  const transportCapacity = (shuttle?.capacity ?? 0) * enterprise.resort.shuttleDrivers;
  reservationsState = reservationsState.map((reservation) => {
    if (reservation.status !== "checked_in") return reservation;
    const scheduled = reservation.entitlements?.filter((entitlement) => (entitlement.status ?? (entitlement.redeemed ? "fulfilled" : "pending")) === "pending"
      && (entitlement.scheduledWeek ?? reservation.checkInWeek ?? reservation.week) === world.week
      && (entitlement.scheduledDay ?? reservation.checkInDay ?? 0) === day) ?? [];
    if (scheduled.length === 0) return reservation;
    const party = reservation.partySize ?? 1;
    const transportReady = reservation.transportMode !== "shuttle" || transportCapacity >= party;
    const nextFolio = [...(reservation.folio ?? [])];
    let refund = reservation.refund ?? 0;
    let disrupted = false;
    const nextEntitlements = reservation.entitlements?.map((entitlement) => {
      if (!scheduled.some((candidate) => candidate.id === entitlement.id)) return entitlement;
      const quantity = entitlement.quantity ?? party;
      const serviceAsset = entitlement.kind === "practice"
        ? practiceAssets[0]
        : entitlement.kind === "dining"
          ? enabled.find((asset) => asset.kind === "restaurant" || asset.kind === "clubhouse")
          : entitlement.kind === "spa"
            ? enabled.find((asset) => asset.kind === "spa")
            : property.assets.find((asset) => asset.id === reservation.assetId);
      const serviceAvailable = transportReady && (
        entitlement.kind === "golf" ? course.holes.some((hole) => hole.tee && hole.green)
          : entitlement.kind === "practice" ? practiceAssets.length > 0
            : entitlement.kind === "dining" ? hasFacilityCapability(course, "restaurant", "restaurant") && enterprise.resort.foodService > 0
              : entitlement.kind === "spa" ? !!serviceAsset
                : true
      );
      const category: CommercialCategory = entitlement.kind === "golf" ? "green_fee"
        : entitlement.kind === "practice" ? "practice"
          : entitlement.kind === "dining" ? "food_beverage"
            : entitlement.kind === "spa" ? "lodging"
              : "lodging";
      if (serviceAvailable) {
        add(serviceAsset, category, `Included ${entitlement.kind} entitlement fulfilled`, quantity, 0, 0, quantity);
        nextFolio.push({ id: `${entitlement.id}-folio`, week: world.week, day, category: entitlement.kind === "golf" ? "golf" : entitlement.kind, description: `Included ${entitlement.kind} service`, amount: 0, included: true });
        return { ...entitlement, status: "fulfilled" as const, redeemed: true, note: "Fulfilled through reserved package capacity." };
      }
      const ratio = entitlement.kind === "golf" ? 0.18 : entitlement.kind === "practice" ? 0.12 : entitlement.kind === "dining" ? 0.1 : 0.14;
      const entitlementRefund = Math.min(Math.max(0, reservation.value - refund), Math.round(reservation.value * ratio));
      refund += entitlementRefund;
      disrupted = true;
      serviceQueue += quantity;
      const reason = transportReady ? `${entitlement.kind} capacity became unavailable after booking.` : "A shuttle overload caused the party to miss the included service.";
      add(serviceAsset, category, `Package service refund: ${reason}`, 0, 0, entitlementRefund, quantity);
      nextFolio.push({ id: `${entitlement.id}-folio-refund`, week: world.week, day, category: "refund", description: reason, amount: -entitlementRefund, included: false });
      return { ...entitlement, status: "refunded" as const, redeemed: false, refundAmount: entitlementRefund, note: reason };
    });
    if (!transportReady) {
      const waiting = Math.max(1, party - transportCapacity);
      transportWaitMinutes = Math.max(transportWaitMinutes, Math.ceil(waiting / Math.max(1, transportCapacity)) * 18);
    }
    return { ...reservation, refund, revalidation: disrupted ? "substituted" as const : reservation.revalidation, entitlements: nextEntitlements, folio: nextFolio.slice(-80) };
  });

  let practiceVisitors = 0;
  for (const asset of practiceAssets) {
    const serviceCapacity = Math.floor(asset.capacity * operatingHoursFactor(asset));
    const visitors = Math.min(remainingAccess, serviceCapacity, Math.max(0, Math.round(baseDemand * (0.32 + asset.tier * 0.1) * asset.condition / Math.max(1, practiceAssets.length))));
    remainingAccess -= visitors;
    practiceVisitors += visitors;
    propertyVisitors += visitors;
    const priceFit = clamp(1.18 - asset.price / Math.max(1, PROPERTY_ASSET_SPECS[asset.kind].basePrice * 2.2), 0.45, 1.08);
    add(asset, "practice", `${asset.name} sessions and bucket sales`, visitors, visitors * asset.price * priceFit * (1 - memberShare * 0.1), 0, Math.max(visitors, Math.round(baseDemand / Math.max(1, practiceAssets.length))));
  }

  const clubhouse = enabled.find((asset) => asset.kind === "clubhouse");
  const proOffice = clubhouse?.modules?.some((module) => module.kind === "pro_office" && module.enabled);
  const fittingStudio = clubhouse?.modules?.some((module) => module.kind === "fitting_studio" && module.enabled);
  const lessonCapacity = enterprise.professionals.length * (proOffice ? 7 : 5);
  const lessons = Math.min(lessonCapacity, Math.floor(practiceVisitors * 0.28));
  if (lessons > 0) {
    const averagePrice = enterprise.professionals.reduce((sum, pro) => sum + pro.lessonPrice, 0) / enterprise.professionals.length;
    add(practiceAssets[0], "lessons", "Club professional lessons", lessons, lessons * averagePrice);
    enterprise = { ...enterprise, professionals: enterprise.professionals.map((pro, index) => ({ ...pro, bookings: pro.bookings + Math.floor((lessons + index) / enterprise.professionals.length) })) };
  }

  if (enterprise.membership.active && day === 0) {
    add(assetOf(course, "clubhouse"), "membership", "Weekly membership dues", enterprise.membership.memberCount, enterprise.membership.memberCount * enterprise.membership.monthlyFee / 4);
  }

  const lodgingAssets = enabled.filter((asset) => asset.category === "resort" && ["lodge", "hotel", "cottages"].includes(asset.kind));
  const reservations: LodgingReservation[] = [];
  let overnightGuests = reservationsState.filter((reservation) => reservation.status === "checked_in").reduce((sum, reservation) => sum + (reservation.partySize ?? 1), 0);
  for (const asset of lodgingAssets) {
    if (!staffedLodging) { serviceQueue += Math.round(asset.capacity * 0.25); continue; }
    const availableRooms = Math.max(0, asset.capacity - dirtyRooms - outOfOrderRooms - (occupiedByAsset.get(asset.id) ?? 0));
    const baseRate = PROPERTY_ASSET_SPECS[asset.kind].basePrice;
    const rateFit = clamp(1.3 - asset.price / Math.max(1, baseRate * 1.45), 0, 1.05);
    const targetOccupancy = clamp((0.18 + world.reputation / 220 + enabled.filter((item) => item.category === "practice").length * 0.035) * rateFit, 0, 0.9);
    const roomCount = Math.min(availableRooms, Math.ceil(remainingAccess / 2), Math.round(asset.capacity * targetOccupancy / Math.max(1, lodgingAssets.length)));
    const guests = Math.min(remainingAccess, roomCount * 2);
    if (guests <= 0 || roomCount <= 0) continue;
    remainingAccess -= guests;
    overnightGuests += guests;
    propertyVisitors += guests;
    const nights = 1 + ((world.week + day + asset.tier) % 3);
    const packageType: LodgingReservation["package"] = practiceAssets.length ? "stay_and_play" : "room_only";
    const value = roomCount * asset.price * nights;
    add(asset, "lodging", `${asset.name} ${packageType.replaceAll("_", " ")} stays`, guests, value);
    const checkout = ordinalToWeekDay(today + nights);
    const reservationId = `reservation-${sequence++}`;
    const serviceDay = ordinalToWeekDay(today + 1);
    reservations.push({
      id: reservationId,
      assetId: asset.id,
      customerId: enterprise.customers[(world.week + day) % enterprise.customers.length]?.id ?? "walk-in",
      week: world.week,
      nights,
      package: packageType,
      value: Math.round(value),
      partySize: guests,
      roomCount,
      roomClass: roomClassFor(asset),
      travelerSegment: packageType === "stay_and_play" ? "buddies" : "couples",
      companionCount: packageType === "stay_and_play" ? 0 : Math.floor(guests / 2),
      checkInWeek: world.week,
      checkInDay: day,
      checkOutWeek: checkout.week,
      checkOutDay: checkout.day,
      deposit: 0,
      refund: 0,
      status: "checked_in",
      transportMode: asset.kind === "hotel" || asset.kind === "cottages" ? "shuttle" : "self_drive",
      vehicleCount: asset.kind === "cottages" ? Math.ceil(guests / 3) : 0,
      luggageReady: true,
      revalidation: "valid",
      folio: [{ id: `${reservationId}-folio-room`, week: world.week, day, category: "room", description: `${roomCount} ${roomClassFor(asset)} room${roomCount === 1 ? "" : "s"} for ${nights} nights`, amount: Math.round(value), included: false }],
      entitlements: [
        { id: `${reservationId}-room`, kind: "room", scheduledWeek: world.week, scheduledDay: day, quantity: roomCount * nights, status: "fulfilled", redeemed: true, refundAmount: 0 },
        ...(packageType === "stay_and_play" ? [{ id: `${reservationId}-golf`, kind: "golf" as const, scheduledWeek: serviceDay.week, scheduledDay: serviceDay.day, quantity: guests, status: "pending" as const, redeemed: false, refundAmount: 0 }] : []),
      ],
    });
    occupiedByAsset.set(asset.id, (occupiedByAsset.get(asset.id) ?? 0) + roomCount);
  }

  const clubhouseGuests = coreGolfers + practiceVisitors + overnightGuests + Math.round(residentCount * 0.08);
  for (const asset of enabled.filter((item) => item.category === "clubhouse" && item.kind !== "clubhouse" && item.kind !== "locker_room")) {
    const share = asset.kind === "restaurant" ? 0.34 : asset.kind === "bar" ? 0.27 : asset.kind === "pro_shop" ? 0.22 : 0.06;
    const staffingCap = asset.kind === "restaurant" || asset.kind === "bar" ? enterprise.resort.foodService * 24 : asset.kind === "locker_room" ? enterprise.resort.lockerAttendants * 30 : Number.POSITIVE_INFINITY;
    const demand = Math.round(clubhouseGuests * share * asset.condition);
    const visitors = Math.min(Math.floor(asset.capacity * operatingHoursFactor(asset)), staffingCap, demand);
    const category: CommercialCategory = asset.kind === "pro_shop" ? "retail" : asset.kind === "event_space" ? "events" : "food_beverage";
    if (asset.kind === "pro_shop") {
      const merchandise = Math.ceil(visitors * 0.58);
      const rentals = asset.tier >= 2 ? Math.ceil(visitors * 0.18) : 0;
      const repairs = asset.tier >= 3 ? Math.floor(visitors * 0.12) : 0;
      const fittings = asset.tier >= 4 && enterprise.professionals.length > 0 ? Math.min(enterprise.professionals.length * (fittingStudio ? 3 : 1), Math.floor(visitors * 0.12)) : 0;
      add(asset, "retail", "Equipment and apparel sales", merchandise, merchandise * asset.price, 0, Math.ceil(demand * 0.58));
      if (asset.tier >= 2) add(asset, "retail", "Club rental service", rentals, rentals * Math.round(asset.price * 0.72), 0, Math.ceil(demand * 0.18));
      if (asset.tier >= 3) add(asset, "retail", "Repair service", repairs, repairs * Math.round(asset.price * 0.9), 0, Math.ceil(demand * 0.12));
      if (asset.tier >= 4) add(asset, "retail", "Club fittings", fittings, fittings * Math.round(asset.price * 1.85), 0, Math.ceil(demand * 0.12));
    } else {
      add(asset, category, asset.kind === "event_space" ? "Function-space service" : `${asset.name} sales`, visitors, visitors * asset.price, 0, demand);
    }
  }

  if (clubhouse) {
    const modules = clubhouse.modules?.filter((module) => module.enabled) ?? [];
    const addModuleService = (moduleKind: FacilityModuleKind, standalone: PropertyAssetKind, category: CommercialCategory, share: number, price: number, staffingCap = Number.POSITIVE_INFINITY) => {
      if (enabled.some((asset) => asset.kind === standalone)) return;
      const module = modules.find((candidate) => candidate.kind === moduleKind);
      if (!module) return;
      const moduleSpec = FACILITY_MODULE_SPECS[moduleKind];
      const demand = Math.round(clubhouseGuests * share * clubhouse.condition);
      const visitors = Math.min(moduleSpec.capacity * module.tier, staffingCap, demand);
      add(clubhouse, category, `${moduleSpec.label} service`, visitors, visitors * price, 0, demand);
    };
    addModuleService("pro_shop", "pro_shop", "retail", 0.16, 24);
    addModuleService("restaurant", "restaurant", "food_beverage", 0.28, 25, enterprise.resort.foodService * 24);
    addModuleService("bar", "bar", "food_beverage", 0.2, 18, enterprise.resort.foodService * 20);
    addModuleService("function_room", "event_space", "events", 0.04, 62, enterprise.resort.foodService * 30);
  }

  const outings = enterprise.outings.map((outing) => {
    if (outing.status !== "scheduled" || outing.week !== world.week || outing.day !== day) return outing;
    const venue = assetOf(course, "event_space") ?? clubhouse;
    const needsFood = outing.package === "golf_catering" || outing.package === "destination_event";
    const needsPro = outing.package === "golf_clinic";
    const canFulfill = !!venue
      && (!needsFood || hasFacilityCapability(course, "restaurant", "restaurant") && enterprise.resort.foodService > 0)
      && (!needsPro || enterprise.professionals.length > 0)
      && accessCapacity - coreGolfers - propertyVisitors >= outing.guests;
    if (!canFulfill) {
      add(venue, "events", "Cancelled outing refund", 0, 0, outing.deposit, outing.guests);
      serviceQueue += outing.guests;
      return { ...outing, status: "cancelled" as const };
    }
    propertyVisitors += outing.guests;
    add(venue, "events", `${outing.package.replaceAll("_", " ")} outing fulfillment`, outing.guests, outing.gross - outing.deposit, 0, outing.guests);
    return { ...outing, status: "fulfilled" as const };
  });

  const shuttleGuests = [...reservationsState, ...reservations]
    .filter((reservation) => reservation.status === "checked_in" && reservation.transportMode === "shuttle")
    .reduce((sum, reservation) => sum + (reservation.partySize ?? 1), 0);
  if (shuttleGuests > 0) {
    const waiting = Math.max(0, shuttleGuests - transportCapacity);
    transportWaitMinutes = Math.max(transportWaitMinutes, waiting > 0 ? Math.ceil(waiting / Math.max(1, transportCapacity)) * 18 : 0);
    serviceQueue += waiting;
    if (transportCapacity > 0) add(shuttle, "access", "Resort shuttle circulation", Math.min(shuttleGuests, transportCapacity), 0, Math.round(Math.min(shuttleGuests, transportCapacity) * 3), shuttleGuests);
  }

  if (enterprise.residents.length > 0) {
    const safety = analyzeResidentialSafety({ ...course, property });
    const exposure = safety.score;
    const strikeChance = clamp(exposure * 0.0035, 0, 0.42);
    const roll = ((world.runSeed + world.week * 31 + day * 17 + sequence * 13) >>> 0) % 1000 / 1000;
    if (exposure > 0 && roll < strikeChance) {
      const resident = enterprise.residents[(world.week + day) % enterprise.residents.length];
      const source = safety.contributions[0];
      const cost = Math.round(180 + exposure * 24);
      const incident: PropertyIncident = { id: `incident-${sequence++}`, week: world.week, day, assetId: resident.assetId, kind: "ball_strike", severity: clamp(Math.ceil(exposure / 18), 1, 5), cost, description: `An errant ball from ${source?.holeName ?? "a live golf corridor"} struck residential property; the owner filed a complaint.` };
      incidents.push(incident);
      add(undefined, "liability", incident.description, 0, 0, cost);
      enterprise = { ...enterprise, residents: enterprise.residents.map((item) => item.id === resident.id ? { ...item, complaints: item.complaints + 1, satisfaction: clamp(item.satisfaction - incident.severity * 2, 0, 100) } : item) };
    }
  }

  const totalArrivals = coreGolfers + propertyVisitors;
  if (totalArrivals > accessCapacity) {
    const overflow = totalArrivals - accessCapacity;
    const cost = overflow * 18;
    const incident: PropertyIncident = { id: `incident-${sequence++}`, week: world.week, day, assetId: assetOf(course, "parking")?.id ?? "informal-parking", kind: "parking_overflow", severity: clamp(Math.ceil(overflow / 12), 1, 5), cost, description: `${overflow} arrivals could not find formal parking.` };
    incidents.push(incident);
    add(assetOf(course, "parking"), "access", incident.description, 0, 0, cost);
  }

  let upkeep = 0;
  const nextAssets = property.assets.map((asset) => {
    const constructionDaysRemaining = Math.max(0, (asset.constructionDaysRemaining ?? 0) - 1);
    const stats = facilityStats.get(asset.id) ?? { demand: 0, served: 0, denied: 0, revenue: 0 };
    if (!asset.enabled) return { ...asset, constructionDaysRemaining, lastDay: stats };
    const policy = asset.upkeepPolicy ?? "standard";
    const moduleUpkeep = asset.modules?.filter((module) => module.enabled).reduce((sum, module) => sum + FACILITY_MODULE_SPECS[module.kind].dailyUpkeep * module.tier, 0) ?? 0;
    const daily = (PROPERTY_ASSET_SPECS[asset.kind].dailyUpkeep * (0.8 + asset.tier * 0.28) + moduleUpkeep) * upkeepCostFactor(policy);
    upkeep += daily;
    const baseWear = asset.category === "access" ? 0.0028 : asset.category === "resort" ? 0.0022 : 0.0016;
    const wearFactor = policy === "lean" ? 1.65 : policy === "premium" ? 0.55 : 1;
    const recovery = policy === "premium" ? 0.004 : policy === "standard" ? 0.001 : 0;
    const condition = clamp(asset.condition - baseWear * wearFactor * (1 + stats.served / Math.max(1, asset.capacity * 8)) + recovery, 0.25, 1);
    return { ...asset, condition, constructionDaysRemaining, lastDay: stats };
  });
  const serviceHeadcount = enterprise.resort.frontDesk + enterprise.resort.housekeeping + enterprise.resort.maintenance + enterprise.resort.concierge + enterprise.resort.shuttleDrivers + enterprise.resort.foodService + enterprise.resort.lockerAttendants;
  const wages = enterprise.professionals.reduce((sum, pro) => sum + pro.weeklyWage / 7, 0) + serviceHeadcount * 590 / 7;
  add(undefined, "upkeep", "Property upkeep, utilities, and club-professional wages", 0, 0, upkeep + wages);

  const visitPool = Math.min(enterprise.customers.length, Math.max(0, practiceVisitors + Math.floor(overnightGuests / 2)));
  const customerSpend = entries.filter((entry) => entry.revenue > 0).reduce((sum, entry) => sum + entry.revenue, 0) / Math.max(1, propertyVisitors);
  const deniedTotal = entries.reduce((sum, entry) => sum + (entry.denied ?? 0), 0) + serviceQueue;
  const servicePenalty = clamp(deniedTotal / Math.max(1, propertyVisitors + deniedTotal), 0, 1);
  const customers: PropertyCustomer[] = enterprise.customers.map((customer, index) => index < visitPool ? {
    ...customer,
    visits: customer.visits + 1,
    skill: clamp(customer.skill + (practiceVisitors > 0 ? (0.3 + practiceAssets.length * 0.07 + lessons / Math.max(1, practiceVisitors) * 1.1) * (1 - customer.skill / 105) : 0), 0, 100),
    loyalty: clamp(customer.loyalty + 0.6 + (customer.member ? 0.4 : 0) - servicePenalty * 2.4 - incidents.length * 0.18, 0, 100),
    totalSpend: customer.totalSpend + customerSpend,
    lastVisitWeek: world.week,
  } : customer);

  let membership = enterprise.membership;
  let retainedCustomers = customers;
  if (membership.active && day === 6) {
    const memberCustomers = customers.filter((customer) => customer.member);
    const churn = memberCustomers.filter((customer) => customer.loyalty < 32 || servicePenalty > 0.45).slice(0, Math.ceil(memberCustomers.length * clamp(servicePenalty * 0.35, 0, 0.2)));
    const churnIds = new Set(churn.map((customer) => customer.id));
    retainedCustomers = customers.map((customer) => churnIds.has(customer.id) ? { ...customer, member: false, segment: "local" as const } : customer);
    const growth = servicePenalty < 0.12 && enabled.some((asset) => asset.kind === "locker_room") ? Math.min(3, membership.capacity - membership.memberCount) : 0;
    membership = { ...membership, memberCount: clamp(membership.memberCount - churn.length + growth, 0, membership.capacity) };
  }

  const revenue = entries.reduce((sum, entry) => sum + entry.revenue, 0);
  const costs = entries.reduce((sum, entry) => sum + entry.cost, 0);
  enterprise = {
    ...enterprise,
    sequence,
    lastSettlementKey: settlementKey,
    ledger: [...enterprise.ledger, ...entries].slice(-420),
    customers: retainedCustomers,
    membership,
    reservations: [...reservationsState, ...reservations].slice(-120),
    incidents: [...enterprise.incidents, ...incidents].slice(-120),
    outings,
    resort: { ...enterprise.resort, dirtyRooms, outOfOrderRooms, serviceQueue, transportWaitMinutes },
  };
  return {
    course: { ...course, property: { ...property, assets: nextAssets } },
    world: { ...world, enterprise },
    report: { revenue, costs, visitors: propertyVisitors, accessCapacity, demand: baseDemand, denied: entries.reduce((sum, entry) => sum + (entry.denied ?? 0), 0), entries, incidents },
  };
}

function capacity(assets: PropertyAsset[], kinds: PropertyAssetKind[]): number {
  return assets.filter((asset) => kinds.includes(asset.kind)).reduce((sum, asset) => sum + asset.capacity, 0);
}

function ordinalToWeekDay(ordinal: number): { week: number; day: number } {
  return { week: Math.floor(ordinal / 7), day: ((ordinal % 7) + 7) % 7 };
}

function makeEntry(enterprise: PropertyEnterpriseState, week: number, day: number, assetId: string | undefined, category: CommercialCategory, description: string, revenue: number, cost: number, visitors: number): CommercialLedgerEntry {
  return { id: `commercial-${enterprise.sequence}`, week, day, assetId, category, description, revenue, cost, visitors, grossRevenue: revenue, variableCost: cost, netContribution: revenue - cost, demand: visitors, served: visitors, denied: 0 };
}

function categoryCogs(category: CommercialCategory): number {
  switch (category) {
    case "retail": return 0.46;
    case "food_beverage": return 0.34;
    case "lodging": return 0.27;
    case "events": return 0.3;
    case "practice": return 0.12;
    case "lessons": return 0.08;
    case "membership": return 0.04;
    default: return 0;
  }
}

export function propertySummary(course: Course, world: World) {
  const assets = normalizePropertyCourse(course.property).assets;
  const enterprise = normalizePropertyEnterprise(world.enterprise);
  const recent = enterprise.ledger.filter((entry) => entry.week >= world.week - 11);
  const lodgingAssets = assets.filter((asset) => isOperational(asset) && ["lodge", "hotel", "cottages"].includes(asset.kind));
  const totalRooms = lodgingAssets.reduce((sum, asset) => sum + asset.capacity, 0);
  const activeReservations = enterprise.reservations.filter((reservation) => reservation.status === "checked_in");
  const occupiedRooms = activeReservations.reduce((sum, reservation) => sum + (reservation.roomCount ?? Math.ceil((reservation.partySize ?? 1) / 2)), 0);
  const completedStays = enterprise.reservations.filter((reservation) => reservation.status === "checked_in" || reservation.status === "checked_out");
  const soldRoomNights = completedStays.reduce((sum, reservation) => sum + (reservation.roomCount ?? Math.ceil((reservation.partySize ?? 1) / 2)) * reservation.nights, 0);
  const lodgingRevenue = recent.filter((entry) => entry.category === "lodging").reduce((sum, entry) => sum + entry.revenue, 0);
  const lodgingCosts = recent.filter((entry) => entry.category === "lodging").reduce((sum, entry) => sum + entry.cost, 0);
  const ancillarySpend = recent.filter((entry) => ["practice", "lessons", "retail", "food_beverage", "events"].includes(entry.category)).reduce((sum, entry) => sum + entry.revenue, 0);
  const transportCost = recent.filter((entry) => entry.category === "access" && entry.description.toLowerCase().includes("shuttle")).reduce((sum, entry) => sum + entry.cost, 0);
  const completeCourses = Math.max(0, normalizeCourseCount(course));
  const practiceCapacity = assets.filter((asset) => isOperational(asset) && asset.category === "practice").reduce((sum, asset) => sum + asset.capacity, 0);
  const diningCapacity = assets.filter((asset) => isOperational(asset) && ["restaurant", "bar"].includes(asset.kind)).reduce((sum, asset) => sum + asset.capacity, 0)
    + assets.filter((asset) => isOperational(asset) && asset.kind === "clubhouse").reduce((sum, asset) => sum + (asset.modules ?? []).filter((module) => module.enabled && (module.kind === "restaurant" || module.kind === "bar")).reduce((moduleSum, module) => moduleSum + FACILITY_MODULE_SPECS[module.kind].capacity * module.tier, 0), 0);
  const destinationAppeal = clamp(Math.round(
    world.reputation * 0.32
    + completeCourses * 10
    + lodgingAssets.reduce((sum, asset) => sum + asset.tier * asset.condition * 4, 0)
    + Math.min(12, practiceCapacity / 8)
    + Math.min(10, diningCapacity / 10)
    + (assets.some((asset) => isOperational(asset) && asset.kind === "spa") ? 8 : 0)
    - enterprise.resort.serviceQueue * 0.35
    - enterprise.resort.transportWaitMinutes * 0.12
  ), 0, 100);
  return {
    assets,
    enterprise,
    accessCapacity: propertyAccessCapacity(course, world),
    recentRevenue: recent.reduce((sum, entry) => sum + entry.revenue, 0),
    recentCosts: recent.reduce((sum, entry) => sum + entry.cost, 0),
    averageCustomerSkill: enterprise.customers.reduce((sum, customer) => sum + customer.skill, 0) / Math.max(1, enterprise.customers.length),
    occupiedHomes: enterprise.residents.reduce((sum, resident) => sum + resident.occupied, 0),
    openComplaints: enterprise.residents.reduce((sum, resident) => sum + resident.complaints, 0),
    safety: analyzeResidentialSafety(course),
    residentialValue: assets.filter((asset) => asset.kind === "houses" || asset.kind === "condos").reduce((sum, asset) => sum + propertyAssetValuation(course, world, asset), 0),
    resortMetrics: {
      totalRooms,
      occupiedRooms,
      occupancyRate: totalRooms > 0 ? occupiedRooms / totalRooms : 0,
      averageDailyRate: soldRoomNights > 0 ? lodgingRevenue / soldRoomNights : 0,
      revenuePerAvailableRoom: totalRooms > 0 ? lodgingRevenue / (totalRooms * 84) : 0,
      averageLengthOfStay: completedStays.length > 0 ? completedStays.reduce((sum, reservation) => sum + reservation.nights, 0) / completedStays.length : 0,
      packageMargin: lodgingRevenue - lodgingCosts,
      ancillarySpend,
      transportCost,
      destinationAppeal,
      activeStays: activeReservations.length,
      arrivals: enterprise.reservations.filter((reservation) => reservation.status === "booked").length,
      capacity: {
        rooms: totalRooms,
        arrivals: propertyAccessCapacity(course, world),
        golf: completeCourses * 72,
        practice: practiceCapacity,
        dining: diningCapacity,
        shuttle: assets.filter((asset) => isOperational(asset) && asset.kind === "shuttle").reduce((sum, asset) => sum + asset.capacity, 0) * enterprise.resort.shuttleDrivers,
      },
    },
  };
}

function normalizeCourseCount(course: Course): number {
  const layouts = course.layouts;
  if (Array.isArray(layouts) && layouts.length > 0) return layouts.filter((layout) => layout.state === "open" && layout.publishedHoleIds.length > 0).length;
  return course.holes.some((hole) => hole.tee && hole.green) ? 1 : 0;
}

export function propertyAssetValuation(course: Course, world: World, asset: PropertyAsset): number {
  if (asset.kind !== "houses" && asset.kind !== "condos") return 0;
  const safety = analyzeResidentialSafety(course, asset.id);
  const scenery = course.estate?.parcels.find((parcel) => asset.x >= parcel.bounds.minX && asset.x <= parcel.bounds.maxX && asset.y >= parcel.bounds.minY && asset.y <= parcel.bounds.maxY)?.sceneryScore ?? 50;
  const access = clamp(propertyAccessCapacity(course) / 80, 0.55, 1.35);
  const golfBenefit = clamp(course.holes.filter((hole) => hole.tee && hole.green).length / 18, 0, 1) * 0.18;
  const prestige = clamp(world.reputation / 100, 0.4, 1.1);
  const riskPenalty = safety.score / 100 * 0.42;
  const trafficPenalty = propertyAccessCapacity(course) < 40 ? 0.08 : 0;
  const perUnit = (asset.kind === "houses" ? 310_000 : 215_000) * (0.72 + scenery / 200 + golfBenefit - riskPenalty - trafficPenalty) * access * prestige;
  return Math.max(0, Math.round(perUnit * (asset.units ?? 0)));
}

/** Append the pre-M31 golf/concession streams to the same bounded audit trail
 * without changing their established cash timing or balance formulas. */
export function recordCoreCommerce(world: World, day: number, input: {
  greenFees: number;
  concessions: number;
  tournaments: number;
  byConcession: Partial<Record<ConcessionType, number>>;
}): World {
  let enterprise = normalizePropertyEnterprise(world.enterprise);
  let sequence = enterprise.sequence;
  const rows: CommercialLedgerEntry[] = [];
  const push = (category: CommercialCategory, description: string, revenue: number) => {
    if (revenue <= 0) return;
    rows.push({ id: `commercial-${sequence++}`, week: world.week, day, category, description, revenue, cost: 0, visitors: 0, grossRevenue: revenue, variableCost: 0, netContribution: revenue, demand: 0, served: 0, denied: 0 });
  };
  push("green_fee", "Golf green fees", input.greenFees);
  for (const [type, revenue] of Object.entries(input.byConcession) as Array<[ConcessionType, number]>) {
    push(type === "cart_rental" ? "cart" : type === "pro_shop" ? "retail" : "food_beverage", `${type.replaceAll("_", " ")} transactions`, revenue);
  }
  const itemized = Object.values(input.byConcession).reduce((sum, value) => sum + (value ?? 0), 0);
  push("food_beverage", "Other concession transactions", Math.max(0, input.concessions - itemized));
  push("tournament", "Tournament and event revenue", input.tournaments);
  enterprise = { ...enterprise, sequence, ledger: [...enterprise.ledger, ...rows].slice(-420) };
  return { ...world, enterprise };
}
