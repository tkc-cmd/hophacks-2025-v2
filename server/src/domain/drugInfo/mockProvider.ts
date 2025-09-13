import { 
  DrugInfoProvider, 
  DrugInteractionAlert, 
  AdministrationGuide, 
  DrugInfo 
} from './service.js';

/**
 * Mock Drug Information Provider
 * 
 * This provider contains a curated dataset of common medications with
 * realistic interaction data for demonstration purposes.
 * 
 * TODO: Replace with real drug database integration (openFDA, RxNorm, etc.)
 */

export class MockDrugInfoProvider implements DrugInfoProvider {
  private drugs: Map<string, DrugInfo> = new Map();
  private interactionRules: InteractionRule[] = [];

  constructor() {
    this.initializeDrugData();
    this.initializeInteractionRules();
  }

  async checkInteractions(
    medications: string[], 
    conditions: string[] = []
  ): Promise<DrugInteractionAlert[]> {
    const alerts: DrugInteractionAlert[] = [];
    const normalizedMeds = medications.map(m => this.normalizeDrugName(m));
    const normalizedConditions = conditions.map(c => c.toLowerCase().trim());

    // Check drug-drug interactions
    for (let i = 0; i < normalizedMeds.length; i++) {
      for (let j = i + 1; j < normalizedMeds.length; j++) {
        const drug1 = normalizedMeds[i];
        const drug2 = normalizedMeds[j];
        
        const interaction = this.findDrugInteraction(drug1, drug2);
        if (interaction) {
          alerts.push({
            severity: interaction.severity,
            summary: interaction.summary,
            guidance: interaction.guidance,
            drugPair: [drug1, drug2],
            category: 'drug-drug'
          });
        }
      }
    }

    // Check for duplicate therapy
    const drugClasses = new Map<string, string[]>();
    for (const med of normalizedMeds) {
      const drugInfo = this.drugs.get(med);
      if (drugInfo) {
        const className = drugInfo.drugClass;
        if (!drugClasses.has(className)) {
          drugClasses.set(className, []);
        }
        drugClasses.get(className)!.push(med);
      }
    }

    for (const [className, drugs] of drugClasses) {
      if (drugs.length > 1) {
        alerts.push({
          severity: 'medium',
          summary: `Multiple ${className} medications detected`,
          guidance: `Taking multiple medications in the same class (${drugs.join(', ')}) may increase the risk of side effects. Please consult your pharmacist about proper dosing and timing.`,
          category: 'duplicate-therapy'
        });
      }
    }

    // Check drug-condition interactions
    for (const med of normalizedMeds) {
      const drugInfo = this.drugs.get(med);
      if (drugInfo) {
        for (const condition of normalizedConditions) {
          if (drugInfo.interactions.conditions.some(c => c.toLowerCase().includes(condition))) {
            alerts.push({
              severity: 'medium',
              summary: `${drugInfo.name} may interact with ${condition}`,
              guidance: `This medication may not be suitable for patients with ${condition}. Please consult your healthcare provider.`,
              category: 'drug-condition'
            });
          }
        }
      }
    }

    return alerts;
  }

  async getAdministrationGuide(medication: string): Promise<AdministrationGuide | null> {
    const normalized = this.normalizeDrugName(medication);
    const drugInfo = this.drugs.get(normalized);
    
    if (!drugInfo) {
      return null;
    }

    return this.generateAdministrationGuide(drugInfo);
  }

  async getDrugInfo(medication: string): Promise<DrugInfo | null> {
    const normalized = this.normalizeDrugName(medication);
    return this.drugs.get(normalized) || null;
  }

  async searchMedications(query: string): Promise<string[]> {
    const normalizedQuery = query.toLowerCase().trim();
    const results: string[] = [];

    for (const [key, drug] of this.drugs) {
      if (
        drug.name.toLowerCase().includes(normalizedQuery) ||
        drug.genericName?.toLowerCase().includes(normalizedQuery) ||
        key.includes(normalizedQuery)
      ) {
        results.push(drug.name);
      }
    }

    return results.slice(0, 10);
  }

  private normalizeDrugName(name: string): string {
    return name.toLowerCase().trim().replace(/[^\w\s]/g, '');
  }

  private findDrugInteraction(drug1: string, drug2: string): InteractionRule | null {
    return this.interactionRules.find(rule => 
      (rule.drug1 === drug1 && rule.drug2 === drug2) ||
      (rule.drug1 === drug2 && rule.drug2 === drug1) ||
      (rule.drugClass1 && rule.drugClass2 && 
       this.isDrugInClass(drug1, rule.drugClass1) && this.isDrugInClass(drug2, rule.drugClass2)) ||
      (rule.drugClass1 && rule.drugClass2 && 
       this.isDrugInClass(drug1, rule.drugClass2) && this.isDrugInClass(drug2, rule.drugClass1))
    ) || null;
  }

  private isDrugInClass(drugName: string, drugClass: string): boolean {
    const drug = this.drugs.get(drugName);
    return drug?.drugClass.toLowerCase() === drugClass.toLowerCase();
  }

  private generateAdministrationGuide(drug: DrugInfo): AdministrationGuide {
    // Generate realistic administration guidance based on drug class
    const baseGuides: Record<string, Partial<AdministrationGuide>> = {
      'antibiotic': {
        instructions: 'Take with a full glass of water. Complete the entire course even if you feel better.',
        timingGuidance: 'Take at evenly spaced intervals throughout the day',
        whenToSeekHelp: 'Contact your healthcare provider if you experience severe diarrhea, rash, or difficulty breathing'
      },
      'statin': {
        instructions: 'Usually taken once daily in the evening with or without food.',
        foodInteractions: ['Avoid grapefruit and grapefruit juice'],
        whenToSeekHelp: 'Contact your doctor if you experience unexplained muscle pain, tenderness, or weakness'
      },
      'ace inhibitor': {
        instructions: 'Take at the same time each day, with or without food.',
        whenToSeekHelp: 'Seek immediate medical attention if you experience swelling of face, lips, tongue, or throat, or difficulty breathing'
      },
      'nsaid': {
        instructions: 'Take with food or milk to reduce stomach irritation.',
        whenToSeekHelp: 'Stop use and contact your doctor if you experience stomach pain, heartburn, or signs of bleeding'
      },
      'antidiabetic': {
        instructions: 'Take as directed with meals to help control blood sugar.',
        whenToSeekHelp: 'Monitor blood sugar regularly. Seek help if you experience symptoms of low or high blood sugar'
      },
      'antidepressant': {
        instructions: 'Take at the same time each day. May take 4-6 weeks to see full effects.',
        whenToSeekHelp: 'Contact your healthcare provider if you experience worsening depression, suicidal thoughts, or unusual mood changes'
      }
    };

    const classKey = drug.drugClass.toLowerCase();
    const baseGuide = baseGuides[classKey] || {};

    return {
      instructions: baseGuide.instructions || 'Take as directed by your healthcare provider.',
      commonSideEffects: this.getCommonSideEffects(drug.drugClass),
      whenToSeekHelp: baseGuide.whenToSeekHelp || 'Contact your healthcare provider if you experience any concerning symptoms.',
      foodInteractions: baseGuide.foodInteractions || drug.interactions.foods,
      timingGuidance: baseGuide.timingGuidance,
      storageInstructions: 'Store at room temperature away from moisture and heat.'
    };
  }

  private getCommonSideEffects(drugClass: string): string[] {
    const sideEffects: Record<string, string[]> = {
      'antibiotic': ['Nausea', 'Diarrhea', 'Stomach upset', 'Yeast infections'],
      'statin': ['Muscle pain', 'Headache', 'Nausea', 'Digestive problems'],
      'ace inhibitor': ['Dry cough', 'Dizziness', 'Fatigue', 'Headache'],
      'nsaid': ['Stomach upset', 'Heartburn', 'Dizziness', 'Headache'],
      'antidiabetic': ['Low blood sugar', 'Nausea', 'Diarrhea', 'Stomach upset'],
      'antidepressant': ['Nausea', 'Drowsiness', 'Dry mouth', 'Changes in appetite']
    };

    return sideEffects[drugClass.toLowerCase()] || ['Consult your pharmacist for side effect information'];
  }

  private initializeDrugData(): void {
    const drugs: DrugInfo[] = [
      {
        name: 'Amoxicillin',
        genericName: 'amoxicillin',
        drugClass: 'antibiotic',
        commonDosages: ['250mg', '500mg', '875mg'],
        interactions: {
          drugs: ['warfarin', 'methotrexate'],
          conditions: ['mononucleosis', 'kidney disease'],
          foods: []
        },
        contraindications: ['penicillin allergy'],
        pregnancyCategory: 'B'
      },
      {
        name: 'Atorvastatin',
        genericName: 'atorvastatin',
        drugClass: 'statin',
        commonDosages: ['10mg', '20mg', '40mg', '80mg'],
        interactions: {
          drugs: ['cyclosporine', 'gemfibrozil', 'niacin'],
          conditions: ['liver disease', 'kidney disease'],
          foods: ['grapefruit']
        },
        contraindications: ['active liver disease', 'pregnancy'],
        pregnancyCategory: 'X'
      },
      {
        name: 'Lisinopril',
        genericName: 'lisinopril',
        drugClass: 'ace inhibitor',
        commonDosages: ['2.5mg', '5mg', '10mg', '20mg', '40mg'],
        interactions: {
          drugs: ['potassium supplements', 'nsaids', 'lithium'],
          conditions: ['kidney disease', 'diabetes'],
          foods: []
        },
        contraindications: ['angioedema history', 'pregnancy'],
        pregnancyCategory: 'D'
      },
      {
        name: 'Metformin',
        genericName: 'metformin',
        drugClass: 'antidiabetic',
        commonDosages: ['500mg', '750mg', '1000mg'],
        interactions: {
          drugs: ['contrast dye', 'alcohol', 'cimetidine'],
          conditions: ['kidney disease', 'liver disease', 'heart failure'],
          foods: []
        },
        contraindications: ['severe kidney disease', 'metabolic acidosis'],
        pregnancyCategory: 'B',
        blackBoxWarning: 'Lactic acidosis risk in patients with kidney or liver problems'
      },
      {
        name: 'Ibuprofen',
        genericName: 'ibuprofen',
        drugClass: 'nsaid',
        commonDosages: ['200mg', '400mg', '600mg', '800mg'],
        interactions: {
          drugs: ['warfarin', 'ace inhibitors', 'lithium', 'methotrexate'],
          conditions: ['heart disease', 'kidney disease', 'stomach ulcers'],
          foods: []
        },
        contraindications: ['aspirin allergy', 'severe heart failure'],
        pregnancyCategory: 'C'
      },
      {
        name: 'Sertraline',
        genericName: 'sertraline',
        drugClass: 'antidepressant',
        commonDosages: ['25mg', '50mg', '100mg', '150mg', '200mg'],
        interactions: {
          drugs: ['maois', 'warfarin', 'nsaids', 'tramadol'],
          conditions: ['bipolar disorder', 'seizure disorder'],
          foods: []
        },
        contraindications: ['maoi use within 14 days'],
        pregnancyCategory: 'C',
        blackBoxWarning: 'Increased suicidal thinking in children and young adults'
      }
    ];

    for (const drug of drugs) {
      this.drugs.set(this.normalizeDrugName(drug.name), drug);
      if (drug.genericName) {
        this.drugs.set(this.normalizeDrugName(drug.genericName), drug);
      }
    }
  }

  private initializeInteractionRules(): void {
    this.interactionRules = [
      // High-risk interactions
      {
        drug1: 'sertraline',
        drugClass2: 'maoi',
        severity: 'high',
        summary: 'SSRI-MAOI interaction risk',
        guidance: 'This combination can cause serotonin syndrome, a potentially life-threatening condition. These medications should not be taken together.'
      },
      {
        drugClass1: 'nsaid',
        drugClass2: 'ace inhibitor',
        severity: 'medium',
        summary: 'NSAIDs may reduce ACE inhibitor effectiveness',
        guidance: 'NSAIDs can reduce the blood pressure lowering effects of ACE inhibitors and may increase kidney problems. Monitor blood pressure and kidney function.'
      },
      {
        drug1: 'warfarin',
        drug2: 'ibuprofen',
        severity: 'high',
        summary: 'Increased bleeding risk',
        guidance: 'This combination significantly increases the risk of bleeding. Use alternative pain relievers like acetaminophen when possible.'
      },
      {
        drug1: 'metformin',
        drug2: 'contrast dye',
        severity: 'high',
        summary: 'Lactic acidosis risk',
        guidance: 'Stop metformin before contrast procedures and restart only after kidney function is confirmed normal.'
      },
      {
        drugClass1: 'statin',
        drug2: 'gemfibrozil',
        severity: 'medium',
        summary: 'Increased muscle toxicity risk',
        guidance: 'This combination increases the risk of muscle problems. Consider alternative cholesterol medications or close monitoring.'
      }
    ];
  }
}

interface InteractionRule {
  drug1?: string;
  drug2?: string;
  drugClass1?: string;
  drugClass2?: string;
  severity: 'high' | 'medium' | 'low';
  summary: string;
  guidance: string;
}
