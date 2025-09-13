import { describe, it, expect } from 'vitest';
import { DrugInfoService } from '../domain/drugInfo/service.js';
import { MockDrugInfoProvider } from '../domain/drugInfo/mockProvider.js';

describe('Drug Information Service', () => {
  const drugInfoService = new DrugInfoService([new MockDrugInfoProvider()]);

  describe('Drug Interaction Checking', () => {
    it('should detect high-risk drug interactions', async () => {
      const medications = ['sertraline', 'ibuprofen', 'warfarin'];
      const alerts = await drugInfoService.checkInteractions(medications);

      expect(alerts.length).toBeGreaterThan(0);
      
      // Should detect warfarin-ibuprofen interaction
      const warfarinInteraction = alerts.find(alert => 
        alert.summary.toLowerCase().includes('bleeding')
      );
      expect(warfarinInteraction).toBeDefined();
      expect(warfarinInteraction?.severity).toBe('high');
    });

    it('should detect duplicate therapy', async () => {
      const medications = ['atorvastatin', 'simvastatin']; // Both are statins
      const alerts = await drugInfoService.checkInteractions(medications);

      const duplicateTherapy = alerts.find(alert => 
        alert.category === 'duplicate-therapy'
      );
      expect(duplicateTherapy).toBeDefined();
      expect(duplicateTherapy?.severity).toBe('medium');
    });

    it('should handle drug-condition interactions', async () => {
      const medications = ['ibuprofen'];
      const conditions = ['heart disease'];
      const alerts = await drugInfoService.checkInteractions(medications, conditions);

      const conditionInteraction = alerts.find(alert => 
        alert.category === 'drug-condition'
      );
      expect(conditionInteraction).toBeDefined();
    });

    it('should return no alerts for safe combinations', async () => {
      const medications = ['acetaminophen']; // Generally safe alone
      const alerts = await drugInfoService.checkInteractions(medications);

      expect(alerts.length).toBe(0);
    });
  });

  describe('Administration Guidance', () => {
    it('should provide guidance for known medications', async () => {
      const guide = await drugInfoService.getAdministrationGuide('atorvastatin');

      expect(guide).toBeDefined();
      expect(guide?.instructions).toBeTruthy();
      expect(guide?.commonSideEffects).toBeDefined();
      expect(guide?.commonSideEffects.length).toBeGreaterThan(0);
      expect(guide?.whenToSeekHelp).toBeTruthy();
    });

    it('should return null for unknown medications', async () => {
      const guide = await drugInfoService.getAdministrationGuide('nonexistent-drug');
      expect(guide).toBeNull();
    });

    it('should provide class-specific guidance', async () => {
      const statinGuide = await drugInfoService.getAdministrationGuide('atorvastatin');
      const antibioticGuide = await drugInfoService.getAdministrationGuide('amoxicillin');

      expect(statinGuide?.instructions).toContain('evening');
      expect(antibioticGuide?.instructions).toContain('complete the entire course');
    });
  });

  describe('Medication Search', () => {
    it('should find medications by partial name', async () => {
      const results = await drugInfoService.searchMedications('atorv');
      
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(med => med.toLowerCase().includes('atorvastatin'))).toBe(true);
    });

    it('should find medications by generic name', async () => {
      const results = await drugInfoService.searchMedications('lisinopril');
      
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(med => med.toLowerCase().includes('lisinopril'))).toBe(true);
    });

    it('should limit search results', async () => {
      const results = await drugInfoService.searchMedications('a'); // Very broad search
      
      expect(results.length).toBeLessThanOrEqual(10);
    });

    it('should handle empty search queries', async () => {
      const results = await drugInfoService.searchMedications('');
      
      expect(results.length).toBe(0);
    });
  });

  describe('Caching', () => {
    it('should cache interaction check results', async () => {
      const medications = ['atorvastatin', 'lisinopril'];
      
      // First call
      const start1 = Date.now();
      const alerts1 = await drugInfoService.checkInteractions(medications);
      const time1 = Date.now() - start1;

      // Second call (should be cached)
      const start2 = Date.now();
      const alerts2 = await drugInfoService.checkInteractions(medications);
      const time2 = Date.now() - start2;

      expect(alerts1).toEqual(alerts2);
      expect(time2).toBeLessThan(time1); // Cached call should be faster
    });

    it('should allow cache clearing', () => {
      drugInfoService.clearCache();
      // If no error is thrown, cache clearing works
      expect(true).toBe(true);
    });
  });
});
