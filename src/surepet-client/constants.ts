export const BASE_URL = "https://app.api.surehub.io/api";

export const ENDPOINTS = {
  LOGIN: "/auth/login",
  DASHBOARD: "/me/start",
  HOUSEHOLD_DEVICES: (householdId: number) =>
    `/household/${householdId}/device`,
  HOUSEHOLD_PETS: (householdId: number) => `/household/${householdId}/pet`,
  DEVICE_CONTROL: (deviceId: number) => `/device/${deviceId}/control`,
  DEVICE_TAG: (deviceId: number, tagId: number) =>
    `/device/${deviceId}/tag/${tagId}`,
  PET_POSITION: (petId: number) => `/pet/${petId}/position`,
} as const;

/** Lock modes for the device as a whole */
export const LOCK_MODES = {
  UNLOCKED: 0,
  LOCKED_IN: 1,
  LOCKED_OUT: 2,
  LOCKED_ALL: 3,
} as const;

export const LOCK_MODE_NAMES: Record<number, string> = {
  0: "unlocked",
  1: "locked_in",
  2: "locked_out",
  3: "locked_all",
};

/** Tag profiles: per-cat access control */
export const TAG_PROFILES = {
  /** Keep current setting / unmanaged */
  KEEP_CURRENT: 0,
  /** Full access: cat can enter and exit */
  FULL_ACCESS: 2,
  /** Indoor only: cat can enter but cannot exit */
  INDOOR_ONLY: 3,
} as const;

export const TAG_PROFILE_NAMES: Record<number, string> = {
  0: "keep_current",
  2: "full_access",
  3: "indoor_only",
};

/** Product IDs */
export const PRODUCTS = {
  HUB: 1,
  REPEATER: 2,
  PET_FLAP: 3,
  PET_FLAP_CONNECT: 6,
  CAT_FLAP_CONNECT: 13,
} as const;

/** Pet location values */
export const PET_LOCATION = {
  INSIDE: 1,
  OUTSIDE: 2,
} as const;
