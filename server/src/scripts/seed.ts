#!/usr/bin/env tsx

/**
 * Database Seeding Script
 * 
 * Seeds the database with mock prescription data for testing and demo purposes.
 */

import { PrismaClient } from '@prisma/client';
import { RefillService } from '../domain/refill/refillService.js';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  try {
    // Initialize services
    const refillService = new RefillService();

    // Seed mock prescriptions
    await refillService.seedMockPrescriptions();

    // Create some sample sessions for testing
    await seedSampleSessions();

    console.log('✅ Database seeding completed successfully!');
  } catch (error) {
    console.error('❌ Database seeding failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

async function seedSampleSessions() {
  console.log('📝 Seeding sample sessions...');

  const sampleSessions = [
    {
      id: 'demo-session-1',
      token: 'demo-token-1',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
      userId: null,
      isActive: true
    },
    {
      id: 'demo-session-2', 
      token: 'demo-token-2',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      userId: null,
      isActive: true
    }
  ];

  for (const session of sampleSessions) {
    await prisma.session.upsert({
      where: { id: session.id },
      update: {
        expiresAt: session.expiresAt,
        isActive: session.isActive
      },
      create: session
    });
  }

  // Add some sample audit logs
  const sampleAuditLogs = [
    {
      sessionId: 'demo-session-1',
      action: 'session_start',
      details: { userAgent: 'Demo Browser', timestamp: new Date().toISOString() },
      timestamp: new Date()
    },
    {
      sessionId: 'demo-session-1',
      action: 'refill_request',
      details: { medication: '[REDACTED]', status: 'placed' },
      timestamp: new Date()
    },
    {
      sessionId: 'demo-session-2',
      action: 'interaction_check',
      details: { medicationCount: 2, alertCount: 1 },
      timestamp: new Date()
    }
  ];

  for (const log of sampleAuditLogs) {
    await prisma.auditLog.create({ data: log });
  }

  console.log('✅ Sample sessions and audit logs created');
}

// Run the seeding
main().catch((error) => {
  console.error('Seeding error:', error);
  process.exit(1);
});
