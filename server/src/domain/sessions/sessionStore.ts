import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const prisma = new PrismaClient();

export interface SessionData {
  id: string;
  token: string;
  userId?: string;
  createdAt: Date;
  expiresAt: Date;
  isActive: boolean;
}

// In-memory session cache for fast lookups
const sessionCache = new Map<string, SessionData>();

/**
 * Creates a new session with a unique token
 */
export async function createSession(userId?: string): Promise<SessionData> {
  const sessionId = uuidv4();
  const token = crypto.randomBytes(32).toString('hex');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + parseInt(process.env.SESSION_TIMEOUT_MS || '3600000'));

  const session = await prisma.session.create({
    data: {
      id: sessionId,
      token,
      userId: userId ? hashUserId(userId) : undefined,
      createdAt,
      expiresAt,
      isActive: true,
    },
  });

  const sessionData: SessionData = {
    id: session.id,
    token: session.token,
    userId: session.userId || undefined,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    isActive: session.isActive,
  };

  // Cache the session
  sessionCache.set(token, sessionData);
  
  return sessionData;
}

/**
 * Validates and retrieves a session by token
 */
export async function getSession(token: string): Promise<SessionData | null> {
  // Check cache first
  const cached = sessionCache.get(token);
  if (cached) {
    if (cached.expiresAt > new Date() && cached.isActive) {
      return cached;
    } else {
      // Remove expired session from cache
      sessionCache.delete(token);
    }
  }

  // Check database
  const session = await prisma.session.findUnique({
    where: { token },
  });

  if (!session || !session.isActive || session.expiresAt < new Date()) {
    return null;
  }

  const sessionData: SessionData = {
    id: session.id,
    token: session.token,
    userId: session.userId || undefined,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    isActive: session.isActive,
  };

  // Update cache
  sessionCache.set(token, sessionData);
  
  return sessionData;
}

/**
 * Invalidates a session
 */
export async function invalidateSession(token: string): Promise<void> {
  await prisma.session.update({
    where: { token },
    data: { isActive: false },
  });
  
  sessionCache.delete(token);
}

/**
 * Extends a session's expiration time
 */
export async function extendSession(token: string): Promise<SessionData | null> {
  const newExpiresAt = new Date(Date.now() + parseInt(process.env.SESSION_TIMEOUT_MS || '3600000'));
  
  try {
    const session = await prisma.session.update({
      where: { token },
      data: { expiresAt: newExpiresAt },
    });

    const sessionData: SessionData = {
      id: session.id,
      token: session.token,
      userId: session.userId || undefined,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      isActive: session.isActive,
    };

    // Update cache
    sessionCache.set(token, sessionData);
    
    return sessionData;
  } catch {
    return null;
  }
}

/**
 * Cleans up expired sessions from database and cache
 */
export async function cleanupExpiredSessions(): Promise<void> {
  const now = new Date();
  
  // Remove from database
  await prisma.session.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { isActive: false }
      ]
    }
  });

  // Remove from cache
  for (const [token, session] of sessionCache.entries()) {
    if (session.expiresAt < now || !session.isActive) {
      sessionCache.delete(token);
    }
  }

  console.log(`🧹 Cleaned up expired sessions at ${now.toISOString()}`);
}

/**
 * Hash user ID for privacy (one-way hash)
 */
function hashUserId(userId: string): string {
  return crypto.createHash('sha256').update(userId + process.env.JWT_SECRET).digest('hex');
}
