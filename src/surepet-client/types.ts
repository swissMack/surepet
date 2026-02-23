/** Auth response */
export interface AuthResponse {
  data: {
    token: string;
    user: {
      id: number;
      email_address: string;
      name: string;
    };
  };
}

/** Dashboard / me/start response */
export interface DashboardResponse {
  data: {
    households: Household[];
    pets: Pet[];
    devices: Device[];
    tags: Tag[];
    user: {
      id: number;
      name: string;
    };
  };
}

export interface Household {
  id: number;
  name: string;
  timezone_id: number;
  created_at: string;
  updated_at: string;
}

export interface Device {
  id: number;
  household_id: number;
  name: string;
  product_id: number;
  serial_number: string;
  mac_address: string;
  created_at: string;
  updated_at: string;
  status: DeviceStatus;
  control?: DeviceControl;
  tags?: DeviceTag[];
}

export interface DeviceStatus {
  led_mode: number;
  pairing_mode: number;
  battery: number | null;
  battery_percentage: number | null;
  version: string[];
  online: boolean;
  signal: {
    device_rssi: number;
    hub_rssi: number;
  };
}

export interface DeviceControl {
  locking: number;
  fast_polling: boolean;
  curfew?: {
    enabled: boolean;
    lock_time: string;
    unlock_time: string;
  }[];
}

export interface DeviceTag {
  id: number;
  tag_id: number;
  profile: number;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: number;
  tag: string;
  created_at: string;
  updated_at: string;
}

export interface Pet {
  id: number;
  household_id: number;
  name: string;
  gender: number;
  species_id: number;
  photo_id: number | null;
  tag_id: number;
  created_at: string;
  updated_at: string;
  position?: PetPosition;
  status: {
    activity: {
      tag_id: number;
      device_id: number;
      where: number; // 1 = inside, 2 = outside
      since: string;
    };
  };
}

export interface PetPosition {
  tag_id: number;
  device_id: number;
  where: number;
  since: string;
}

/** Control update response */
export interface ControlResponse {
  data: {
    locking: number;
  };
}

/** Tag profile update response */
export interface TagProfileResponse {
  data: {
    id: number;
    tag_id: number;
    profile: number;
  };
}
