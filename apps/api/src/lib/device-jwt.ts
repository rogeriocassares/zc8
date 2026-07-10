import * as crypto from "crypto";

export type DeviceAuthContext = {
  tenant_id: bigint;
  device_id: string;
  device_key: string;
  scopes: string[];
};

/**
 * ParseUUIDv7ToDeviceKey converts a canonical UUID string to a uint64 DeviceKey
 * using the lower 64 bits of the UUID.
 */
export function parseUUIDv7ToDeviceKey(s: string): bigint {
  if (s.length !== 36) {
    throw new Error("Invalid UUID format: expected 36 characters");
  }

  let result = 0n;

  const fromHex = (c: string): number => {
    const charCode = c.charCodeAt(0);
    if (charCode >= 48 && charCode <= 57) return charCode - 48;
    if (charCode >= 97 && charCode <= 102) return charCode - 97 + 10;
    if (charCode >= 65 && charCode <= 70) return charCode - 65 + 10;
    throw new Error(`Invalid hex character: ${c}`);
  };

  for (let i = 19; i < 23; i++) {
    result = (result << 4n) | BigInt(fromHex(s[i]));
  }
  for (let i = 24; i < 36; i++) {
    result = (result << 4n) | BigInt(fromHex(s[i]));
  }

  return result;
}

export class DeviceJWTHandler {
  private signingKey: Buffer;

  constructor(signingKey?: Buffer) {
    this.signingKey = signingKey || crypto.randomBytes(32);
  }

  generateToken(
    deviceId: string,
    tenantId: bigint,
    deviceKey: string,
    expiresInHours: number = 24,
  ): string {
    const header = { alg: "HS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const exp = now + expiresInHours * 3600;

    const payload = {
      device_id: deviceId,
      tenant_id: tenantId.toString(),
      device_key: deviceKey,
      iat: now,
      exp: exp,
      scopes: ["read:telemetry", "write:telemetry"],
      purpose: "telemetry",
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");

    const signature = crypto
      .createHmac("sha256", this.signingKey)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64url");

    return `${headerB64}.${payloadB64}.${signature}`;
  }

  validateToken(token: string): Partial<DeviceAuthContext> | null {
    try {
      const [headerB64, payloadB64, signatureB64] = token.split(".");
      const signature = crypto
        .createHmac("sha256", this.signingKey)
        .update(`${headerB64}.${payloadB64}`)
        .digest("base64url");

      if (signature !== signatureB64) return null;

      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
      if (payload.exp < Math.floor(Date.now() / 1000)) return null;

      return {
        device_id: payload.device_id,
        tenant_id: BigInt(payload.tenant_id),
        device_key: payload.device_key,
        scopes: payload.scopes,
      };
    } catch {
      return null;
    }
  }
}
