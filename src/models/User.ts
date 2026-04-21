// src/models/User.ts

import mongoose, { Document, Schema, Model } from "mongoose";

// ── TypeScript interface ───────────────────────────────────────────────────────
export interface IUser extends Document {
  // Clerk identifiers
  clerkId: string; // Clerk's user ID (e.g. "user_2abc...")
  email: string; // Primary email address
  emailVerified: boolean;

  // Profile
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  username: string | null;
  imageUrl: string | null;

  // Auth providers used
  authProviders: string[]; // e.g. ["email", "google"]

  // Broker connection
  brokerConnection?: {
    brokerId: string; // e.g. "delta"
    apiKey: string;
    apiSecretEncrypted: string;
    isConnected: boolean;
    lastVerifiedAt: Date | null;
    lastSyncedAt: Date | null;
  };

  // Timestamps
  clerkCreatedAt: Date;
  clerkUpdatedAt: Date;
  lastSignInAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Schema ─────────────────────────────────────────────────────────────────────
const UserSchema = new Schema<IUser>(
  {
    // Clerk identifiers
    clerkId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },

    // Profile
    firstName: { type: String, default: null },
    lastName: { type: String, default: null },
    fullName: { type: String, default: null },
    username: { type: String, default: null, sparse: true },
    imageUrl: { type: String, default: null },

    // Auth providers
    authProviders: {
      type: [String],
      default: [],
    },

    // Broker connection
    brokerConnection: {
      brokerId: { type: String, default: null },
      apiKey: { type: String, default: null },
      apiSecretEncrypted: { type: String, default: null },
      isConnected: { type: Boolean, default: false },
      lastVerifiedAt: { type: Date, default: null },
      lastSyncedAt: { type: Date, default: null },
    },

    // Clerk timestamps
    clerkCreatedAt: {
      type: Date,
      required: true,
    },
    clerkUpdatedAt: {
      type: Date,
      required: true,
    },
    lastSignInAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true, // adds createdAt + updatedAt automatically
    versionKey: false,
  },
);

// ── Virtual: full name fallback ───────────────────────────────────────────────
UserSchema.virtual("displayName").get(function (this: IUser) {
  return this.fullName || this.username || this.email.split("@")[0];
});

// ── Indexes ────────────────────────────────────────────────────────────────────
UserSchema.index({ email: 1, clerkId: 1 });

// ── Model ──────────────────────────────────────────────────────────────────────
export const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
