import { PrismaClient } from '@prisma/client';
import { hashPII, validatePHIFields } from '../../middleware/phiGuard.js';

const prisma = new PrismaClient();

export interface RefillRequest {
  patientName: string;
  dateOfBirth: string;
  phoneNumber?: string;
  medicationName: string;
  dosage: string;
  quantity?: number;
  pharmacyLocation: string;
}

export interface RefillResult {
  status: 'placed' | 'no_refills' | 'not_found' | 'needs_provider' | 'validation_error';
  message: string;
  etaMinutes?: number;
  refillsRemaining?: number;
  prescribedDate?: Date;
  errors?: string[];
}

export class RefillService {
  /**
   * Process a prescription refill request
   */
  async placeRefill(sessionId: string, request: RefillRequest): Promise<RefillResult> {
    // Validate PHI fields
    const validation = validatePHIFields({
      name: request.patientName,
      dob: request.dateOfBirth,
      phone: request.phoneNumber
    });

    if (!validation.isValid) {
      return {
        status: 'validation_error',
        message: 'Please provide valid patient information.',
        errors: validation.errors
      };
    }

    // Hash patient identifiers for lookup
    const patientNameHash = hashPII(request.patientName);
    const dobHash = hashPII(request.dateOfBirth);
    const phoneLastFour = request.phoneNumber ? 
      request.phoneNumber.replace(/\D/g, '').slice(-4) : undefined;

    try {
      // Look up prescription in mock database
      const prescription = await this.findPrescription(
        patientNameHash,
        dobHash,
        phoneLastFour,
        request.medicationName,
        request.dosage,
        request.pharmacyLocation
      );

      if (!prescription) {
        return {
          status: 'not_found',
          message: `I couldn't find a prescription for ${request.medicationName} ${request.dosage} under the provided information. Please verify the medication name, dosage, and patient details.`
        };
      }

      // Check refills remaining
      if (prescription.refillsRemaining <= 0) {
        // Log the renewal request
        await this.logRefillEvent(sessionId, request, 'needs_provider');

        return {
          status: 'needs_provider',
          message: `This prescription for ${request.medicationName} has no refills remaining. I'll contact your prescriber for a new prescription. You should hear back within 1-2 business days.`,
          refillsRemaining: 0,
          prescribedDate: prescription.prescribedDate
        };
      }

      // Calculate ETA based on pharmacy workload (mock calculation)
      const etaMinutes = this.calculateETA(request.pharmacyLocation, request.medicationName);

      // Update prescription (decrease refills)
      await prisma.mockPrescription.update({
        where: { id: prescription.id },
        data: { refillsRemaining: prescription.refillsRemaining - 1 }
      });

      // Log the successful refill
      await this.logRefillEvent(sessionId, request, 'placed', etaMinutes);

      return {
        status: 'placed',
        message: `Great! I've placed your refill for ${request.medicationName} ${request.dosage}. It will be ready for pickup in approximately ${etaMinutes} minutes at ${request.pharmacyLocation}.`,
        etaMinutes,
        refillsRemaining: prescription.refillsRemaining - 1,
        prescribedDate: prescription.prescribedDate
      };

    } catch (error) {
      console.error('Refill service error:', error);
      return {
        status: 'validation_error',
        message: 'I encountered an error processing your refill request. Please try again or contact the pharmacy directly.'
      };
    }
  }

  /**
   * Get refill history for a patient (for pharmacist use)
   */
  async getRefillHistory(patientNameHash: string, dobHash: string): Promise<any[]> {
    return await prisma.refillEvent.findMany({
      where: {
        patientNameHash,
        dobHash
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
  }

  private async findPrescription(
    patientNameHash: string,
    dobHash: string,
    phoneLastFour: string | undefined,
    medicationName: string,
    dosage: string,
    pharmacyLocation: string
  ) {
    // Build search criteria
    const where: any = {
      patientNameHash,
      dobHash,
      medicationName: {
        contains: medicationName,
        mode: 'insensitive'
      },
      dosage: {
        contains: dosage,
        mode: 'insensitive'
      },
      pharmacyLocation: {
        contains: pharmacyLocation,
        mode: 'insensitive'
      }
    };

    // Add phone filter if provided
    if (phoneLastFour) {
      where.phoneLastFour = phoneLastFour;
    }

    return await prisma.mockPrescription.findFirst({ where });
  }

  private calculateETA(pharmacyLocation: string, medicationName: string): number {
    // Mock ETA calculation based on various factors
    let baseTime = 15; // Base 15 minutes

    // Adjust for pharmacy location (simulate different workloads)
    const locationMultipliers: Record<string, number> = {
      'downtown': 1.5,
      'mall': 1.3,
      'main': 1.0,
      'express': 0.7,
      'drive-thru': 0.8
    };

    const locationKey = Object.keys(locationMultipliers).find(key => 
      pharmacyLocation.toLowerCase().includes(key)
    );
    if (locationKey) {
      baseTime *= locationMultipliers[locationKey];
    }

    // Adjust for medication complexity (some drugs require more prep time)
    const complexMedications = ['insulin', 'compound', 'injection', 'cream', 'ointment'];
    if (complexMedications.some(med => medicationName.toLowerCase().includes(med))) {
      baseTime *= 1.4;
    }

    // Add some random variation to simulate real-world conditions
    const variation = Math.random() * 0.3 - 0.15; // ±15% variation
    baseTime *= (1 + variation);

    // Round to nearest 5 minutes
    return Math.round(baseTime / 5) * 5;
  }

  private async logRefillEvent(
    sessionId: string,
    request: RefillRequest,
    status: string,
    etaMinutes?: number
  ): Promise<void> {
    try {
      await prisma.refillEvent.create({
        data: {
          sessionId,
          patientNameHash: hashPII(request.patientName),
          dobHash: hashPII(request.dateOfBirth),
          phoneLastFour: request.phoneNumber ? 
            request.phoneNumber.replace(/\D/g, '').slice(-4) : null,
          medicationName: request.medicationName,
          dosage: request.dosage,
          quantity: request.quantity,
          pharmacyLocation: request.pharmacyLocation,
          status,
          etaMinutes,
          createdAt: new Date()
        }
      });
    } catch (error) {
      console.error('Failed to log refill event:', error);
      // Don't throw - logging failure shouldn't break the refill process
    }
  }

  /**
   * Seed the database with mock prescription data for testing
   */
  async seedMockPrescriptions(): Promise<void> {
    const mockPrescriptions = [
      {
        patientNameHash: hashPII('Jane Smith'),
        dobHash: hashPII('01/02/1975'),
        phoneLastFour: '5678',
        medicationName: 'Atorvastatin',
        dosage: '20mg',
        quantity: 30,
        refillsRemaining: 3,
        prescribedDate: new Date('2024-08-15'),
        pharmacyLocation: 'Main Street Pharmacy'
      },
      {
        patientNameHash: hashPII('John Doe'),
        dobHash: hashPII('03/15/1980'),
        phoneLastFour: '1234',
        medicationName: 'Lisinopril',
        dosage: '10mg',
        quantity: 30,
        refillsRemaining: 2,
        prescribedDate: new Date('2024-09-01'),
        pharmacyLocation: 'Downtown Pharmacy'
      },
      {
        patientNameHash: hashPII('Jane Smith'),
        dobHash: hashPII('01/02/1975'),
        phoneLastFour: '5678',
        medicationName: 'Metformin',
        dosage: '500mg',
        quantity: 60,
        refillsRemaining: 5,
        prescribedDate: new Date('2024-07-20'),
        pharmacyLocation: 'Main Street Pharmacy'
      },
      {
        patientNameHash: hashPII('Mary Johnson'),
        dobHash: hashPII('12/08/1965'),
        phoneLastFour: '9876',
        medicationName: 'Amoxicillin',
        dosage: '500mg',
        quantity: 21,
        refillsRemaining: 0, // No refills - will trigger provider contact
        prescribedDate: new Date('2024-09-10'),
        pharmacyLocation: 'Express Pharmacy'
      },
      {
        patientNameHash: hashPII('Robert Wilson'),
        dobHash: hashPII('07/22/1955'),
        phoneLastFour: '4567',
        medicationName: 'Sertraline',
        dosage: '50mg',
        quantity: 30,
        refillsRemaining: 4,
        prescribedDate: new Date('2024-08-30'),
        pharmacyLocation: 'Mall Pharmacy'
      }
    ];

    for (const prescription of mockPrescriptions) {
      await prisma.mockPrescription.upsert({
        where: {
          // Use a combination of fields to identify unique prescriptions
          patientNameHash_medicationName_dosage: {
            patientNameHash: prescription.patientNameHash,
            medicationName: prescription.medicationName,
            dosage: prescription.dosage
          }
        },
        update: {
          refillsRemaining: prescription.refillsRemaining,
        },
        create: prescription
      });
    }

    console.log('✅ Mock prescription data seeded');
  }
}
