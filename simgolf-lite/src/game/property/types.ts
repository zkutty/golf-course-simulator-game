export type PropertyTier = 1 | 2 | 3 | 4 | 5;
export type InfrastructureSurface = "grass" | "dirt" | "gravel" | "asphalt" | "paver";

export type PropertyAssetKind =
  | "road"
  | "parking"
  | "valet"
  | "overflow_parking"
  | "shuttle"
  | "driving_range"
  | "putting_green"
  | "short_game_area"
  | "practice_holes"
  | "practice_bays"
  | "clubhouse"
  | "pro_shop"
  | "restaurant"
  | "bar"
  | "locker_room"
  | "event_space"
  | "lodge"
  | "hotel"
  | "cottages"
  | "spa"
  | "houses"
  | "condos"
  | "community_club"
  | "safety_buffer"
  | "netting";

export type PropertyAssetCategory = "access" | "practice" | "clubhouse" | "resort" | "community" | "safety";

export type FacilityCondition = "excellent" | "good" | "worn" | "unsafe";
export type FacilityUpkeepPolicy = "lean" | "standard" | "premium";
export type FacilityModuleKind =
  | "check_in"
  | "pro_shop"
  | "restaurant"
  | "kitchen"
  | "bar"
  | "lockers"
  | "member_lounge"
  | "pro_office"
  | "fitting_studio"
  | "function_room";
export interface FacilityModule {
  kind: FacilityModuleKind;
  tier: PropertyTier;
  enabled: boolean;
}
export interface PracticeRoute { id: string; points: Array<{ x: number; y: number }>; }
export interface PracticeStation { id: string; kind: "tee" | "target" | "cup" | "bunker" | "lesson"; x: number; y: number; capacity: number; }
export interface FacilityDayStats {
  demand: number;
  served: number;
  denied: number;
  revenue: number;
}

export interface PropertyAsset {
  id: string;
  kind: PropertyAssetKind;
  name: string;
  category: PropertyAssetCategory;
  tier: PropertyTier;
  x: number;
  y: number;
  width: number;
  height: number;
  capacity: number;
  condition: number;
  price: number;
  surface?: InfrastructureSurface;
  units?: number;
  enabled: boolean;
  tenure?: "operating" | "for_sale" | "sold" | "retained" | "partnered" | "reacquired";
  route?: PracticeRoute;
  stations?: PracticeStation[];
  modules?: FacilityModule[];
  upkeepPolicy?: FacilityUpkeepPolicy;
  openHour?: number;
  closeHour?: number;
  constructionDaysRemaining?: number;
  lastDay?: FacilityDayStats;
}

export interface PropertyCourseState {
  version: 1;
  assets: PropertyAsset[];
}

export type CustomerSegment = "local" | "member" | "student" | "tourist" | "event_guest" | "resident";
export type ResortTravelerSegment = "buddies" | "couples" | "family" | "tournament" | "academy" | "corporate" | "premium";
export type LodgingRoomClass = "standard" | "deluxe" | "suite" | "villa";
export type ResortTransportMode = "walk" | "self_drive" | "shuttle" | "coach";
export type PackageEntitlementKind = "golf" | "practice" | "dining" | "spa" | "room";
export type PackageEntitlementStatus = "pending" | "fulfilled" | "substituted" | "refunded" | "failed";

export interface PackageEntitlement {
  id: string;
  kind: PackageEntitlementKind;
  scheduledWeek?: number;
  scheduledDay?: number;
  quantity?: number;
  status?: PackageEntitlementStatus;
  redeemed: boolean;
  refundAmount?: number;
  note?: string;
}

export interface ResortFolioTransaction {
  id: string;
  week: number;
  day: number;
  category: "deposit" | "room" | "golf" | "practice" | "dining" | "spa" | "transport" | "refund";
  description: string;
  amount: number;
  included: boolean;
}

export interface PropertyCustomer {
  id: string;
  name: string;
  segment: CustomerSegment;
  skill: number;
  loyalty: number;
  visits: number;
  totalSpend: number;
  member: boolean;
  lastVisitWeek: number;
}

export interface ClubProfessional {
  id: string;
  name: string;
  tier: PropertyTier;
  lessonPrice: number;
  weeklyWage: number;
  bookings: number;
}

export interface MembershipProgram {
  active: boolean;
  tier: PropertyTier;
  monthlyFee: number;
  memberCount: number;
  capacity: number;
}

export interface LodgingReservation {
  id: string;
  assetId: string;
  customerId: string;
  week: number;
  nights: number;
  package: "room_only" | "stay_and_play" | "academy" | "event";
  value: number;
  partySize?: number;
  checkInWeek?: number;
  checkInDay?: number;
  checkOutWeek?: number;
  checkOutDay?: number;
  deposit?: number;
  refund?: number;
  status?: "booked" | "checked_in" | "checked_out" | "cancelled";
  roomClass?: LodgingRoomClass;
  roomCount?: number;
  travelerSegment?: ResortTravelerSegment;
  companionCount?: number;
  transportMode?: ResortTransportMode;
  vehicleCount?: number;
  luggageReady?: boolean;
  revalidation?: "valid" | "substituted" | "cancelled";
  entitlements?: PackageEntitlement[];
  folio?: ResortFolioTransaction[];
}

export interface OutingBooking {
  id: string;
  week: number;
  day: number;
  guests: number;
  package: "golf_only" | "golf_clinic" | "golf_catering" | "destination_event";
  gross: number;
  deposit: number;
  status: "scheduled" | "fulfilled" | "cancelled";
}

export interface ResortOperations {
  frontDesk: number;
  housekeeping: number;
  maintenance: number;
  concierge: number;
  shuttleDrivers: number;
  foodService: number;
  lockerAttendants: number;
  dirtyRooms: number;
  outOfOrderRooms: number;
  serviceQueue: number;
  transportWaitMinutes: number;
}

export interface ResidentHousehold {
  id: string;
  assetId: string;
  units: number;
  occupied: number;
  satisfaction: number;
  complaints: number;
}

export interface PropertyIncident {
  id: string;
  week: number;
  day: number;
  assetId: string;
  kind: "ball_strike" | "parking_overflow" | "service_failure";
  severity: number;
  cost: number;
  description: string;
}

export type CommercialCategory =
  | "green_fee"
  | "cart"
  | "tournament"
  | "practice"
  | "lessons"
  | "membership"
  | "retail"
  | "food_beverage"
  | "events"
  | "lodging"
  | "real_estate"
  | "access"
  | "liability"
  | "upkeep";

export interface CommercialLedgerEntry {
  id: string;
  week: number;
  day: number;
  assetId?: string;
  category: CommercialCategory;
  description: string;
  revenue: number;
  cost: number;
  visitors: number;
  /** Explicit reconciliation fields; legacy entries may omit these. */
  grossRevenue?: number;
  variableCost?: number;
  netContribution?: number;
  demand?: number;
  served?: number;
  denied?: number;
  customerId?: string;
}

export interface PropertyEnterpriseState {
  version: 2;
  sequence: number;
  lastSettlementKey?: string;
  ledger: CommercialLedgerEntry[];
  customers: PropertyCustomer[];
  professionals: ClubProfessional[];
  membership: MembershipProgram;
  reservations: LodgingReservation[];
  residents: ResidentHousehold[];
  incidents: PropertyIncident[];
  outings: OutingBooking[];
  resort: ResortOperations;
}

export interface SafetyContribution {
  holeId: string;
  holeName: string;
  distanceTiles: number;
  expectedRisk: number;
  outlierRisk: number;
}

export interface ResidentialSafetyReport {
  score: number;
  eligibility: "safe" | "marginal" | "blocked";
  expectedExposure: number;
  outlierExposure: number;
  mitigation: number;
  contributions: SafetyContribution[];
}

export interface PropertyDayReport {
  revenue: number;
  costs: number;
  visitors: number;
  accessCapacity: number;
  demand: number;
  denied: number;
  entries: CommercialLedgerEntry[];
  incidents: PropertyIncident[];
}
