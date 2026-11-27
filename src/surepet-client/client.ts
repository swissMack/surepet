import { BASE_URL, ENDPOINTS } from "./constants.js";
import type {
  AuthResponse,
  DashboardResponse,
  TagProfileResponse,
  ControlResponse,
} from "./types.js";
import type { CacheRepository } from "../db/repositories/cache.repository.js";
import type { FastifyBaseLogger } from "fastify";

export class SurePetClient {
  private token: string | null = null;
  private email: string;
  private password: string;
  private log: FastifyBaseLogger;
  private cache: CacheRepository;

  constructor(
    email: string,
    password: string,
    cache: CacheRepository,
    log: FastifyBaseLogger
  ) {
    this.email = email;
    this.password = password;
    this.cache = cache;
    this.log = log.child({ module: "surepet-client" });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    if (!this.token) {
      await this.login();
    }

    const url = `${BASE_URL}${path}`;
    this.log.debug({ method, path }, "API request");

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 401) {
      this.log.info("Token expired, re-authenticating");
      this.token = null;
      await this.login();
      // Retry once
      const retry = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!retry.ok) {
        const text = await retry.text();
        throw new Error(`API ${method} ${path} failed: ${retry.status} ${text}`);
      }
      return (await retry.json()) as T;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `API ${method} ${path} failed: ${response.status} ${text}`
      );
    }

    return (await response.json()) as T;
  }

  async login(): Promise<void> {
    // Check cached token first
    const cachedToken = this.cache.get("auth_token");
    if (cachedToken) {
      this.token = cachedToken;
      this.log.info("Using cached auth token");
      return;
    }

    this.log.info("Logging in to Sure Petcare API");
    const response = await fetch(`${BASE_URL}${ENDPOINTS.LOGIN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email_address: this.email,
        password: this.password,
        device_id: "surepet-curfew-service",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Login failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as AuthResponse;
    this.token = data.data.token;
    this.cache.set("auth_token", this.token);
    this.log.info(
      { userId: data.data.user.id, name: data.data.user.name },
      "Logged in successfully"
    );
  }

  async getDashboard(): Promise<DashboardResponse> {
    return this.request<DashboardResponse>("GET", ENDPOINTS.DASHBOARD);
  }

  async setTagProfile(
    deviceId: number,
    tagId: number,
    profile: number
  ): Promise<TagProfileResponse> {
    this.log.info(
      { deviceId, tagId, profile },
      "Setting tag profile"
    );
    return this.request<TagProfileResponse>(
      "PUT",
      ENDPOINTS.DEVICE_TAG(deviceId, tagId),
      { profile }
    );
  }

  async setDeviceLock(
    deviceId: number,
    lockMode: number
  ): Promise<ControlResponse> {
    this.log.info({ deviceId, lockMode }, "Setting device lock mode");
    return this.request<ControlResponse>(
      "PUT",
      ENDPOINTS.DEVICE_CONTROL(deviceId),
      { locking: lockMode }
    );
  }

  /**
   * Set a pet's location in the Sure Petcare cloud (same call the official
   * app makes). where: 1 = inside, 2 = outside. Without this, a location set
   * locally is overwritten by the next dashboard poll.
   */
  async setPetPosition(petId: number, where: number): Promise<unknown> {
    // Sure Petcare reads "since" as UTC "YYYY-MM-DD HH:MM" — verified
    // 2026-11-27: a UTC string was stored as the correct instant, a local
    // (CET) one landed an hour in the future.
    const since = new Date().toISOString().slice(0, 16).replace("T", " ");
    this.log.info({ petId, where, since }, "Setting pet position");
    return this.request<unknown>("POST", ENDPOINTS.PET_POSITION(petId), {
      where,
      since,
    });
  }

  clearToken(): void {
    this.token = null;
    this.cache.delete("auth_token");
  }
}
