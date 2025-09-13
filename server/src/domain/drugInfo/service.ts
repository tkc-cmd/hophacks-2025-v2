/**
 * Drug Information Service Interface
 * 
 * This service provides drug interaction checking and administration guidance.
 * It's designed to be pluggable with different providers (mock, openFDA, RxNorm, etc.)
 */

export interface DrugInteractionAlert {
  severity: 'high' | 'medium' | 'low';
  summary: string;
  guidance: string;
  drugPair?: [string, string];
  category: 'drug-drug' | 'drug-condition' | 'drug-food' | 'duplicate-therapy' | 'contraindication';
}

export interface AdministrationGuide {
  instructions: string;
  commonSideEffects: string[];
  whenToSeekHelp: string;
  foodInteractions?: string[];
  timingGuidance?: string;
  storageInstructions?: string;
}

export interface DrugInfo {
  name: string;
  genericName?: string;
  drugClass: string;
  commonDosages: string[];
  interactions: {
    drugs: string[];
    conditions: string[];
    foods: string[];
  };
  contraindications: string[];
  blackBoxWarning?: string;
  pregnancyCategory?: string;
  ageRestrictions?: string;
}

export interface DrugInfoProvider {
  /**
   * Check for drug interactions and contraindications
   */
  checkInteractions(
    medications: string[], 
    conditions: string[]
  ): Promise<DrugInteractionAlert[]>;

  /**
   * Get administration guidance for a specific medication
   */
  getAdministrationGuide(medication: string): Promise<AdministrationGuide | null>;

  /**
   * Get detailed drug information
   */
  getDrugInfo(medication: string): Promise<DrugInfo | null>;

  /**
   * Search for medications by name (fuzzy matching)
   */
  searchMedications(query: string): Promise<string[]>;
}

/**
 * Main Drug Information Service
 * 
 * This service orchestrates multiple providers and caches results for performance.
 */
export class DrugInfoService {
  private providers: DrugInfoProvider[] = [];
  private cache = new Map<string, any>();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  constructor(providers: DrugInfoProvider[]) {
    this.providers = providers;
  }

  async checkInteractions(
    medications: string[], 
    conditions: string[] = []
  ): Promise<DrugInteractionAlert[]> {
    const cacheKey = `interactions:${medications.sort().join(',')}:${conditions.sort().join(',')}`;
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    const allAlerts: DrugInteractionAlert[] = [];

    // Query all providers
    for (const provider of this.providers) {
      try {
        const alerts = await provider.checkInteractions(medications, conditions);
        allAlerts.push(...alerts);
      } catch (error) {
        console.error('Drug info provider error:', error);
        // Continue with other providers
      }
    }

    // Deduplicate and prioritize by severity
    const uniqueAlerts = this.deduplicateAlerts(allAlerts);
    const sortedAlerts = uniqueAlerts.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });

    // Cache the result
    this.cache.set(cacheKey, {
      data: sortedAlerts,
      timestamp: Date.now()
    });

    return sortedAlerts;
  }

  async getAdministrationGuide(medication: string): Promise<AdministrationGuide | null> {
    const cacheKey = `admin:${medication.toLowerCase()}`;
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    // Try each provider until we get a result
    for (const provider of this.providers) {
      try {
        const guide = await provider.getAdministrationGuide(medication);
        if (guide) {
          // Cache the result
          this.cache.set(cacheKey, {
            data: guide,
            timestamp: Date.now()
          });
          return guide;
        }
      } catch (error) {
        console.error('Drug info provider error:', error);
        // Continue with other providers
      }
    }

    return null;
  }

  async searchMedications(query: string): Promise<string[]> {
    const cacheKey = `search:${query.toLowerCase()}`;
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    const allResults: string[] = [];

    // Query all providers
    for (const provider of this.providers) {
      try {
        const results = await provider.searchMedications(query);
        allResults.push(...results);
      } catch (error) {
        console.error('Drug info provider error:', error);
        // Continue with other providers
      }
    }

    // Deduplicate and limit results
    const uniqueResults = Array.from(new Set(allResults.map(r => r.toLowerCase())))
      .map(r => allResults.find(orig => orig.toLowerCase() === r)!)
      .slice(0, 10);

    // Cache the result
    this.cache.set(cacheKey, {
      data: uniqueResults,
      timestamp: Date.now()
    });

    return uniqueResults;
  }

  private deduplicateAlerts(alerts: DrugInteractionAlert[]): DrugInteractionAlert[] {
    const seen = new Set<string>();
    return alerts.filter(alert => {
      const key = `${alert.category}:${alert.summary}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Clear the cache (useful for testing or memory management)
   */
  clearCache(): void {
    this.cache.clear();
  }
}
