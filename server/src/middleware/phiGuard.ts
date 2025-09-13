import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

/**
 * Redacts personally identifiable information from text
 */
export function redactPHI(text: string): string {
  // Redact phone numbers (various formats)
  text = text.replace(/(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g, '[PHONE_REDACTED]');
  
  // Redact dates that look like DOB (MM/DD/YYYY, MM-DD-YYYY, etc.)
  text = text.replace(/\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](19|20)\d{2}\b/g, '[DOB_REDACTED]');
  
  // Redact SSN patterns
  text = text.replace(/\b\d{3}-?\d{2}-?\d{4}\b/g, '[SSN_REDACTED]');
  
  // Redact email addresses
  text = text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL_REDACTED]');
  
  return text;
}

/**
 * Creates a one-way hash for PII that needs to be stored for matching
 */
export function hashPII(value: string): string {
  const salt = process.env.JWT_SECRET || 'default_salt';
  return crypto.createHash('sha256').update(value.toLowerCase().trim() + salt).digest('hex');
}

/**
 * Masks phone number to show only last 4 digits
 */
export function maskPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 4) {
    return `****${digits.slice(-4)}`;
  }
  return '[PHONE_MASKED]';
}

/**
 * Logs an audit event with redacted information
 */
export async function logAuditEvent(
  sessionId: string,
  action: string,
  details: Record<string, any>
): Promise<void> {
  try {
    // Redact sensitive information from details
    const redactedDetails = JSON.parse(JSON.stringify(details));
    
    // Recursively redact text fields
    function redactObject(obj: any): any {
      if (typeof obj === 'string') {
        return redactPHI(obj);
      } else if (Array.isArray(obj)) {
        return obj.map(redactObject);
      } else if (obj && typeof obj === 'object') {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
          // Special handling for known PII fields
          if (['phone', 'phoneNumber', 'dob', 'dateOfBirth'].includes(key.toLowerCase())) {
            result[key] = '[REDACTED]';
          } else if (key.toLowerCase().includes('name')) {
            result[key] = '[NAME_REDACTED]';
          } else {
            result[key] = redactObject(value);
          }
        }
        return result;
      }
      return obj;
    }

    const sanitizedDetails = redactObject(redactedDetails);

    await prisma.auditLog.create({
      data: {
        sessionId,
        action,
        details: sanitizedDetails,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
    // Don't throw - audit logging failure shouldn't break the main flow
  }
}

/**
 * Validates that required PHI fields are present and properly formatted
 */
export function validatePHIFields(data: {
  name?: string;
  dob?: string;
  phone?: string;
}): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (data.name) {
    const namePattern = /^[a-zA-Z\s\-']{2,50}$/;
    if (!namePattern.test(data.name.trim())) {
      errors.push('Name must contain only letters, spaces, hyphens, and apostrophes (2-50 characters)');
    }
  }

  if (data.dob) {
    const dobPattern = /^(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](19|20)\d{2}$/;
    if (!dobPattern.test(data.dob)) {
      errors.push('Date of birth must be in MM/DD/YYYY format');
    } else {
      const dobDate = new Date(data.dob);
      const now = new Date();
      const age = now.getFullYear() - dobDate.getFullYear();
      if (age < 0 || age > 150) {
        errors.push('Date of birth must represent a valid age (0-150 years)');
      }
    }
  }

  if (data.phone) {
    const phoneDigits = data.phone.replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      errors.push('Phone number must be 10 digits');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Rate limiting for PHI access attempts
 */
const accessAttempts = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(sessionId: string, maxAttempts: number = 5, windowMs: number = 300000): boolean {
  const now = Date.now();
  const attempts = accessAttempts.get(sessionId);

  if (!attempts || now > attempts.resetTime) {
    // Reset or initialize
    accessAttempts.set(sessionId, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (attempts.count >= maxAttempts) {
    return false; // Rate limit exceeded
  }

  attempts.count++;
  return true;
}
