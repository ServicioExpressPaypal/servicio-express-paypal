type PinEnv = Pick<Env, "BETTER_AUTH_SECRET">;

export type AdminSecurityMode = "pin" | "totp" | "test-bypass";

const encoder = new TextEncoder();
const iterations = 210_000;
const weakPins = new Set(["012345", "123456", "654321", "987654"]);

function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function decode(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function pinMaterial(env: PinEnv, userId: string, pin: string) {
  return encoder.encode(`${userId}:${pin}:${env.BETTER_AUTH_SECRET}`);
}

function arrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function derive(
  env: PinEnv,
  userId: string,
  pin: string,
  salt: Uint8Array,
  rounds: number,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    pinMaterial(env, userId, pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: arrayBuffer(salt),
        iterations: rounds,
      },
      key,
      256,
    ),
  );
}

export function adminSecurityMode(env: Env): AdminSecurityMode {
  if (env.ADMIN_SECOND_FACTOR === "pin") return "pin";
  if (env.ADMIN_SECOND_FACTOR === "totp") return "totp";
  const hostname = new URL(env.APP_URL).hostname;
  if (
    env.ADMIN_REQUIRE_MFA === "false" &&
    ["127.0.0.1", "localhost", "portal.example.test"].includes(hostname)
  )
    return "test-bypass";
  return "totp";
}

export function validateAdminPin(pin: unknown) {
  if (typeof pin !== "string" || !/^\d{6}$/.test(pin))
    throw new Error("El PIN debe contener exactamente 6 dígitos.");
  if (weakPins.has(pin) || /^(\d)\1{5}$/.test(pin))
    throw new Error("Elige un PIN menos predecible.");
  return pin;
}

export async function createAdminPin(env: PinEnv, userId: string, pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(env, userId, pin, salt, iterations);
  return { salt: encode(salt), pin_hash: encode(hash), iterations };
}

export async function verifyAdminPin(
  env: PinEnv,
  userId: string,
  pin: string,
  credential: { salt: string; pin_hash: string; iterations: number },
) {
  if (credential.iterations < 100_000 || credential.iterations > 1_000_000)
    return false;
  let expected: Uint8Array;
  let actual: Uint8Array;
  try {
    expected = decode(credential.pin_hash);
    actual = await derive(
      env,
      userId,
      pin,
      decode(credential.salt),
      credential.iterations,
    );
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++)
    difference |= expected[index] ^ actual[index];
  return difference === 0;
}
