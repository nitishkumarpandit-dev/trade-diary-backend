// src/app.ts

import express, { Application, Request, Response } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";

import { clerkWebhookHandler } from "./webhooks/clerk.webhook";

export function createApp(): Application {
  const app = express();

  // ── CORS ────────────────────────────────────────────────────────────────────
  app.use(
    cors({
      origin: process.env.ALLOWED_ORIGINS?.split(",") ?? "*",
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );

  // ── Webhook route (MUST use raw body — register BEFORE express.json()) ──────
  // Svix signature verification requires the raw Buffer, not parsed JSON.
  app.post(
    "/api/webhooks/clerk",
    express.raw({ type: "application/json" }),
    clerkWebhookHandler,
  );

  // ── JSON body parser for all other routes ───────────────────────────────────
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // ── Clerk middleware (global — reads JWT from Authorization header) ──────────
  app.use(clerkMiddleware({
    secretKey: process.env.CLERK_SECRET_KEY,
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY
  }));

  // ── Health check ─────────────────────────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      service: "trade-diary-backend",
      timestamp: new Date().toISOString(),
    });
  });

  // ── 404 handler ──────────────────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Route not found" });
  });

  return app;
}
