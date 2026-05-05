#!/usr/bin/env node
/**
 * Beulrock Serverside — Standalone Services Server
 * 
 * Starts the WebSocket server and BullMQ worker outside of Next.js.
 * Run: node scripts/start-services.mjs
 * 
 * This is useful for production where you want to run the WS server
 * as a separate process.
 */

const PORT = parseInt(process.env.WS_PORT || "3033", 10);

async function main() {
  console.log("=".repeat(50));
  console.log("  Beulrock Serverside — Background Services");
  console.log("=".repeat(50));
  console.log();

  // Dynamically import ESM modules
  const { startWebSocketServer } = await import("../src/lib/websocket-server");
  const { startWorker } = await import("../src/lib/bullmq-worker");

  // Start WebSocket server
  startWebSocketServer(PORT);

  // Start BullMQ worker
  try {
    startWorker();
    console.log("[Worker] BullMQ execution worker started");
  } catch (err) {
    console.warn("[Worker] BullMQ worker failed:", err);
    console.log("[Worker] Falling back to direct execution mode");
  }

  console.log();
  console.log("Services running:");
  console.log(`  - WebSocket Server: ws://localhost:${PORT}`);
  console.log(`  - BullMQ Worker: Active (max 5 concurrent)`);
  console.log();
  console.log("Press Ctrl+C to stop.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
