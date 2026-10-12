import { PrismaClient } from "@prisma/client";

// Next.js dev recompiles modules on every change; without the global cache each
// recompile would open a fresh connection pool until Postgres refuses more.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
