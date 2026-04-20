// src/webhooks/clerk.webhook.ts
// Uses @clerk/express verifyWebhook (latest API) + svix signature verification.
// IMPORTANT: This route must use express.raw() — NOT express.json() —
// because svix needs the raw body bytes to verify the signature.

import { Request, Response } from "express";
import { Webhook } from "svix";
import { User } from "../models/User";
import { Trade } from "../models/Trade";
import { Strategy } from "../models/Strategy";
import { Rule } from "../models/Rule";
import { Mistake } from "../models/Mistake";
import { DailyChecklist } from "../models/DailyChecklist";
import { ChecklistTemplate } from "../models/ChecklistTemplate";

// ── Clerk webhook event types ──────────────────────────────────────────────────
interface ClerkEmailAddress {
  id: string;
  email_address: string;
  verification: { status: string } | null;
}

interface ClerkExternalAccount {
  provider: string;
}

interface ClerkUserPayload {
  id: string;
  email_addresses: ClerkEmailAddress[];
  primary_email_address_id: string;
  first_name: string | null;
  last_name: string | null;
  image_url: string | null;
  username: string | null;
  external_accounts: ClerkExternalAccount[];
  created_at: number; // Unix timestamp in ms
  updated_at: number;
  last_sign_in_at: number | null;
}

interface ClerkWebhookEvent {
  type: string;
  data: ClerkUserPayload;
}

// ── Helper: extract primary email ─────────────────────────────────────────────
function getPrimaryEmail(payload: ClerkUserPayload): {
  email: string;
  verified: boolean;
} {
  const primary = payload.email_addresses.find(
    (e) => e.id === payload.primary_email_address_id,
  );
  if (!primary) {
    // Fallback to first email
    const first = payload.email_addresses[0];
    return {
      email: first?.email_address ?? "",
      verified: first?.verification?.status === "verified",
    };
  }
  return {
    email: primary.email_address,
    verified: primary.verification?.status === "verified",
  };
}

// ── Helper: get auth providers ────────────────────────────────────────────────
function getAuthProviders(payload: ClerkUserPayload): string[] {
  const providers: string[] = [];

  // Has email/password
  if (payload.email_addresses.length > 0) {
    providers.push("email");
  }

  // OAuth providers
  payload.external_accounts?.forEach((account) => {
    if (!providers.includes(account.provider)) {
      providers.push(account.provider);
    }
  });

  return providers;
}

// ── Main webhook handler ───────────────────────────────────────────────────────
export async function clerkWebhookHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("❌ CLERK_WEBHOOK_SECRET is not set");
    res.status(500).json({ error: "Server misconfigured" });
    return;
  }

  // ── Step 1: Extract Svix headers ────────────────────────────────────────────
  const svixId = req.headers["svix-id"] as string;
  const svixTimestamp = req.headers["svix-timestamp"] as string;
  const svixSignature = req.headers["svix-signature"] as string;

  if (!svixId || !svixTimestamp || !svixSignature) {
    console.warn("⚠️  Missing Svix headers");
    res.status(400).json({ error: "Missing Svix headers" });
    return;
  }

  // ── Step 2: Verify signature with raw body ──────────────────────────────────
  // express.raw() gives us a Buffer — convert to string for svix
  const body =
    req.body instanceof Buffer
      ? req.body.toString("utf8")
      : JSON.stringify(req.body);

  const wh = new Webhook(webhookSecret);
  let evt: ClerkWebhookEvent;

  try {
    evt = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch (err) {
    console.error("❌ Webhook signature verification failed:", err);
    res.status(400).json({ error: "Invalid webhook signature" });
    return;
  }

  // ── Step 3: Route by event type ─────────────────────────────────────────────
  const { type, data } = evt;
  console.log(`📨 Clerk webhook received: ${type} (id: ${data.id})`);

  try {
    switch (type) {
      case "user.created":
        await handleUserCreated(data);
        break;

      case "user.updated":
        await handleUserUpdated(data);
        break;

      case "user.deleted":
        await handleUserDeleted(data);
        break;

      default:
        console.log(`ℹ️  Unhandled event type: ${type}`);
    }

    res.status(200).json({ message: "Webhook processed", type });
  } catch (error) {
    console.error(`❌ Error processing webhook ${type}:`, error);
    res.status(500).json({ error: "Failed to process webhook" });
  }
}

// ── Event handlers ─────────────────────────────────────────────────────────────

async function handleUserCreated(data: ClerkUserPayload): Promise<void> {
  const { email, verified } = getPrimaryEmail(data);

  if (!email) {
    console.error("❌ user.created: No email found for user", data.id);
    return;
  }

  const fullName =
    [data.first_name, data.last_name].filter(Boolean).join(" ").trim() || null;

  const user = await User.create({
    clerkId: data.id,
    email,
    emailVerified: verified,
    firstName: data.first_name,
    lastName: data.last_name,
    fullName,
    username: data.username,
    imageUrl: data.image_url,
    authProviders: getAuthProviders(data),
    clerkCreatedAt: new Date(data.created_at),
    clerkUpdatedAt: new Date(data.updated_at),
    lastSignInAt: data.last_sign_in_at ? new Date(data.last_sign_in_at) : null,
  });

  console.log(`✅ User created in MongoDB: ${user.email} (${user.clerkId})`);
}

async function handleUserUpdated(data: ClerkUserPayload): Promise<void> {
  const { email, verified } = getPrimaryEmail(data);

  const fullName =
    [data.first_name, data.last_name].filter(Boolean).join(" ").trim() || null;

  const updated = await User.findOneAndUpdate(
    { clerkId: data.id },
    {
      $set: {
        email,
        emailVerified: verified,
        firstName: data.first_name,
        lastName: data.last_name,
        fullName,
        username: data.username,
        imageUrl: data.image_url,
        authProviders: getAuthProviders(data),
        clerkUpdatedAt: new Date(data.updated_at),
        lastSignInAt: data.last_sign_in_at
          ? new Date(data.last_sign_in_at)
          : null,
      },
    },
    { new: true, upsert: true }, // upsert = create if not exists (handles race conditions)
  );

  console.log(`✅ User updated in MongoDB: ${updated?.email} (${data.id})`);
}

async function handleUserDeleted(data: { id: string }): Promise<void> {
  const clerkId = data.id;
  console.log(`🗑️  Starting cascading deletion for user: ${clerkId}`);

  try {
    // Delete all associated data in parallel
    const results = await Promise.allSettled([
      User.findOneAndDelete({ clerkId }),
      Trade.deleteMany({ clerkId }),
      Strategy.deleteMany({ clerkId }),
      Rule.deleteMany({ clerkId }),
      Mistake.deleteMany({ clerkId }),
      DailyChecklist.deleteMany({ clerkId }),
      ChecklistTemplate.deleteMany({ clerkId }),
    ]);

    // Log results for debugging
    const labels = [
      "User",
      "Trades",
      "Strategies",
      "Rules",
      "Mistakes",
      "DailyChecklist",
      "ChecklistTemplate",
    ];

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        console.log(`✅ ${labels[index]} deletion processed.`);
      } else {
        console.error(
          `❌ ${labels[index]} deletion failed:`,
          result.reason.message || result.reason,
        );
      }
    });

    console.log(`✅ Finished cascading deletion for clerkId: ${clerkId}`);
  } catch (error) {
    console.error(`❌ Unexpected error during handleUserDeleted:`, error);
    throw error;
  }
}
