import { jwtVerify } from "jose";
import type { NextFunction, Request, Response } from "express";

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error("SESSION_SECRET is required");
}
const JWT_SECRET = new TextEncoder().encode(sessionSecret);

export interface AuthPayload {
  userId: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = header.slice(7);
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    req.auth = { userId: payload.sub as string, email: payload.email as string };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export { JWT_SECRET };
