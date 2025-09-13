import { beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

// Load environment variables for testing
dotenv.config();

const prisma = new PrismaClient();

beforeAll(async () => {
  // Ensure database is migrated and ready for testing
  try {
    await prisma.$connect();
    console.log('Test database connected');
  } catch (error) {
    console.error('Failed to connect to test database:', error);
    throw error;
  }
});

afterAll(async () => {
  // Cleanup after all tests
  await prisma.$disconnect();
  console.log('Test database disconnected');
});
