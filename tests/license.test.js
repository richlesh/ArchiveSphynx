const crypto = require("crypto");

const { LICENSE_SALT } = require("../license.js");

function expectedLicenseKey(userName) {
  const hmac = crypto.createHmac("sha256", LICENSE_SALT);
  hmac.update(userName.toLowerCase().trim());
  return hmac.digest("hex").slice(0, 16).toUpperCase();
}

function isValidLicense(key, userName) {
  if (!key || !userName) return false;
  return key.toUpperCase() === expectedLicenseKey(userName);
}

describe("license key", () => {
  test("generates consistent key for same input", () => {
    const key1 = expectedLicenseKey("user@example.com");
    const key2 = expectedLicenseKey("user@example.com");
    expect(key1).toBe(key2);
  });

  test("key is 16 uppercase hex characters", () => {
    const key = expectedLicenseKey("test@test.com");
    expect(key).toMatch(/^[0-9A-F]{16}$/);
  });

  test("key is case-insensitive for username", () => {
    const key1 = expectedLicenseKey("User@Example.com");
    const key2 = expectedLicenseKey("user@example.com");
    expect(key1).toBe(key2);
  });

  test("key trims whitespace from username", () => {
    const key1 = expectedLicenseKey("  user@example.com  ");
    const key2 = expectedLicenseKey("user@example.com");
    expect(key1).toBe(key2);
  });

  test("different usernames produce different keys", () => {
    const key1 = expectedLicenseKey("user1@example.com");
    const key2 = expectedLicenseKey("user2@example.com");
    expect(key1).not.toBe(key2);
  });

  test("isValidLicense returns true for correct key", () => {
    const key = expectedLicenseKey("user@example.com");
    expect(isValidLicense(key, "user@example.com")).toBe(true);
  });

  test("isValidLicense is case-insensitive for key", () => {
    const key = expectedLicenseKey("user@example.com");
    expect(isValidLicense(key.toLowerCase(), "user@example.com")).toBe(true);
  });

  test("isValidLicense returns false for wrong key", () => {
    expect(isValidLicense("0000000000000000", "user@example.com")).toBe(false);
  });

  test("isValidLicense returns false for empty key", () => {
    expect(isValidLicense("", "user@example.com")).toBe(false);
    expect(isValidLicense(null, "user@example.com")).toBe(false);
  });

  test("isValidLicense returns false for empty username", () => {
    expect(isValidLicense("ABCD1234ABCD1234", "")).toBe(false);
    expect(isValidLicense("ABCD1234ABCD1234", null)).toBe(false);
  });
});
