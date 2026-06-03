import { db, usersTable } from "@workspace/db";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { Router } from "express";
import { SignJWT } from "jose";

import { requireAuth, JWT_SECRET } from "../middleware/auth.js";

const router = Router();

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

async function signToken(userId: string, email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(JWT_SECRET);
}

// POST /api/auth/register
router.post("/auth/register", async (req, res) => {
  const { email, password, name } = req.body ?? {};
  if (!email || !password || !name) {
    res.status(400).json({ error: "email, password and name are required" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "An account with that email already exists" });
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const userId = genId();
  await db.insert(usersTable).values({ id: userId, email: email.toLowerCase(), name, passwordHash });

  // Seed default settings for new user
  const { settingsTable } = await import("@workspace/db");
  await db.insert(settingsTable).values({ userId, paymentMethod: "snowball", startingBalance: "0" }).onConflictDoNothing();

  // Seed default categories
  const { categoriesTable } = await import("@workspace/db");
  const defaultCats = ["Housing","Utilities","Insurance","Transportation","Food","Entertainment","Health","Education","Savings","Debt","Shopping","Rent","Other"];
  await db.insert(categoriesTable).values(defaultCats.map(name => ({ id: genId(), userId, name }))).onConflictDoNothing();

  const token = await signToken(userId, email.toLowerCase());
  res.status(201).json({ token, user: { id: userId, email: email.toLowerCase(), name } });
});

// POST /api/auth/login
router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }
  const rows = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
  if (rows.length === 0) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const user = rows[0];
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const token = await signToken(user.id, user.email);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

// GET /api/auth/me
router.get("/auth/me", requireAuth, async (req, res) => {
  const rows = await db.select().from(usersTable).where(eq(usersTable.id, req.auth!.userId)).limit(1);
  if (rows.length === 0) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const { passwordHash: _, ...user } = rows[0];
  res.json({ user });
});

// POST /api/auth/logout  (client just drops the token — server is stateless)
router.post("/auth/logout", (_req, res) => {
  res.json({ ok: true });
});

export default router;
