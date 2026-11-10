import { PrismaClient } from "@prisma/client";
import { ensureDatabaseUrl, missingRenderDisk, RENDER_DISK_PATH } from "./database-url.js";

// DATABASE_URL is optional: without it the app uses the Render disk
// (/var/data/prod.sqlite) or prisma/dev.sqlite locally. See database-url.js.
const databaseUrl = ensureDatabaseUrl();
if (missingRenderDisk(process.env, databaseUrl)) {
  console.warn(
    `[db] No persistent disk at ${RENDER_DISK_PATH}: sessions, settings and history are lost on every deploy. ` +
      `Attach a Render disk with mount path ${RENDER_DISK_PATH}.`,
  );
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;
