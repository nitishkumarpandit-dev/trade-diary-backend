// src/server.ts

import "dotenv/config";
import { createApp } from "./webhooks/app";
import { connectDB } from "./config/database";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function bootstrap() {
  // 1. Connect to MongoDB
  await connectDB();

  // 2. Create and start Express app
  const app = createApp();

  app.listen(PORT, () => {
    console.log(`\n🚀 Trade Diary API running on http://localhost:${PORT}`);
    console.log(`📋 Health check: http://localhost:${PORT}/health`);
    console.log(
      `🪝  Webhook endpoint: http://localhost:${PORT}/api/webhooks/clerk`,
    );
  });
}

bootstrap().catch((err) => {
  console.error("❌ Failed to start server:", err);
  process.exit(1);
});
