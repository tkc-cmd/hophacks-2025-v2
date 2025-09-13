import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { RefillService } from '../domain/refill/refillService.js';
import { createSession } from '../domain/sessions/sessionStore.js';

const prisma = new PrismaClient();
const refillService = new RefillService();

describe('Refill Service', () => {
  let testSessionId: string;

  beforeAll(async () => {
    // Seed test data
    await refillService.seedMockPrescriptions();
    
    // Create test session
    const session = await createSession();
    testSessionId = session.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.refillEvent.deleteMany({
      where: { sessionId: testSessionId }
    });
    await prisma.session.deleteMany({
      where: { id: testSessionId }
    });
    await prisma.$disconnect();
  });

  it('should successfully place a refill for valid prescription', async () => {
    const refillRequest = {
      patientName: 'Jane Smith',
      dateOfBirth: '01/02/1975',
      phoneNumber: '555-555-5678',
      medicationName: 'Atorvastatin',
      dosage: '20mg',
      quantity: 30,
      pharmacyLocation: 'Main Street Pharmacy'
    };

    const result = await refillService.placeRefill(testSessionId, refillRequest);

    expect(result.status).toBe('placed');
    expect(result.etaMinutes).toBeGreaterThan(0);
    expect(result.message).toContain('placed your refill');
    expect(result.refillsRemaining).toBeDefined();
  });

  it('should handle prescription not found', async () => {
    const refillRequest = {
      patientName: 'Nonexistent Patient',
      dateOfBirth: '01/01/2000',
      medicationName: 'Nonexistent Drug',
      dosage: '10mg',
      pharmacyLocation: 'Test Pharmacy'
    };

    const result = await refillService.placeRefill(testSessionId, refillRequest);

    expect(result.status).toBe('not_found');
    expect(result.message).toContain('couldn\'t find a prescription');
  });

  it('should handle no refills remaining', async () => {
    const refillRequest = {
      patientName: 'Mary Johnson',
      dateOfBirth: '12/08/1965',
      phoneNumber: '555-555-9876',
      medicationName: 'Amoxicillin',
      dosage: '500mg',
      pharmacyLocation: 'Express Pharmacy'
    };

    const result = await refillService.placeRefill(testSessionId, refillRequest);

    expect(result.status).toBe('needs_provider');
    expect(result.message).toContain('no refills remaining');
    expect(result.message).toContain('contact your prescriber');
  });

  it('should validate patient information', async () => {
    const refillRequest = {
      patientName: '', // Invalid empty name
      dateOfBirth: 'invalid-date',
      medicationName: 'Test Drug',
      dosage: '10mg',
      pharmacyLocation: 'Test Pharmacy'
    };

    const result = await refillService.placeRefill(testSessionId, refillRequest);

    expect(result.status).toBe('validation_error');
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('should log refill events', async () => {
    const refillRequest = {
      patientName: 'John Doe',
      dateOfBirth: '03/15/1980',
      phoneNumber: '555-555-1234',
      medicationName: 'Lisinopril',
      dosage: '10mg',
      pharmacyLocation: 'Downtown Pharmacy'
    };

    await refillService.placeRefill(testSessionId, refillRequest);

    // Check that refill event was logged
    const events = await prisma.refillEvent.findMany({
      where: { sessionId: testSessionId }
    });

    expect(events.length).toBeGreaterThan(0);
    
    const latestEvent = events[events.length - 1];
    expect(latestEvent.medicationName).toBe('Lisinopril');
    expect(latestEvent.dosage).toBe('10mg');
    expect(latestEvent.phoneLastFour).toBe('1234');
  });
});
