// src/controllers/system.controller.ts

import { Request, Response } from "express";
import axios from "axios";

/**
 * Fetches the public outbound IP address of the server.
 * This is useful for users needing to whitelist the server IP on broker platforms.
 */
export const getOutboundIp = async (_req: Request, res: Response) => {
  try {
    const response = await axios.get("https://api.ipify.org?format=json");
    res.json({
      ip: response.data.ip,
      provider: "Render.com (Inferred)",
      isShared: true,
      note: "This IP is part of a shared pool and may change. For a static dedicated IP, please use a proxy service like QuotaGuard."
    });
  } catch (error) {
    console.error("Error fetching outbound IP:", error);
    res.status(500).json({ error: "Could not determine outbound IP address" });
  }
};
