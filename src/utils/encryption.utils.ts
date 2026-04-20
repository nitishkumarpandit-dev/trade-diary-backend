import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

/**
 * Encrypts a string using AES-256-GCM.
 * Requires BROKER_SECRET_ENCRYPTION_KEY environment variable (64-character hex).
 */
export function encrypt(text: string): string {
  const secretKey = process.env.BROKER_SECRET_ENCRYPTION_KEY;
  if (!secretKey || secretKey.length !== 64) {
    throw new Error("BROKER_SECRET_ENCRYPTION_KEY must be a 64-character hex string (256 bits)");
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(secretKey, "hex"), iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");

  // Format: iv:authTag:encryptedText
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a string using AES-256-GCM.
 */
export function decrypt(encryptedText: string): string {
  const secretKey = process.env.BROKER_SECRET_ENCRYPTION_KEY;
  if (!secretKey || secretKey.length !== 64) {
    throw new Error("BROKER_SECRET_ENCRYPTION_KEY must be a 64-character hex string (256 bits)");
  }

  const sections = encryptedText.split(":");
  if (sections.length !== 3) {
    throw new Error("Invalid encrypted text format. Expected iv:authTag:encryptedText");
  }

  const [ivHex, authTagHex, encrypted] = sections;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(secretKey, "hex"), iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
