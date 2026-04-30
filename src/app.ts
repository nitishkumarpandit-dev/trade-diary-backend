// src/app.ts

import express, { Application, Request, Response } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import rateLimit from "express-rate-limit";

import { clerkWebhookHandler } from "./webhooks/clerk.webhook";

import apiRoutes from "./routes";

export function createApp(): Application {
  const app = express();

  // ── CORS ────────────────────────────────────────────────────────────────────
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(",") 
    : (process.env.NODE_ENV === "production" ? [] : "*");

  app.use(
    cors({
      origin: allowedOrigins,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
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

  // ── API Routes ───────────────────────────────────────────────────────────────
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // Limit each IP to 200 requests per windowMs
    message: { error: "Too many requests from this IP, please try again later." }
  });

  app.use("/api", apiLimiter, apiRoutes);

  // ── Health check ─────────────────────────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      service: "tradenote-backend",
      timestamp: new Date().toISOString(),
    });
  });

  // ── 404 handler ──────────────────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Route not found" });
  });

  return app;
}
