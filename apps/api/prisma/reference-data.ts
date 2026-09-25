import { PrismaClient } from '@prisma/client';

/**
 * Global clinical reference data (spec §16, §17, §9). Loaded in every
 * environment (not demo data). Codes follow ICD-10. Idempotent: existing
 * entries (matched by name) are left untouched so admin edits survive.
 */
export const GLOBAL_DIAGNOSES: [string, string, string, string?][] = [
  ['Acute upper respiratory infection', 'J06.9', 'Respiratory', 'urti cold flu'],
  ['Acute pharyngitis', 'J02.9', 'Respiratory', 'sore throat'],
  ['Acute bronchitis', 'J20.9', 'Respiratory', 'cough'],
  ['Pneumonia, unspecified', 'J18.9', 'Respiratory'],
  ['Asthma', 'J45.9', 'Respiratory', 'wheeze bronchial asthma'],
  ['Chronic obstructive pulmonary disease', 'J44.9', 'Respiratory', 'copd'],
  ['Allergic rhinitis', 'J30.4', 'Respiratory', 'allergy sneezing'],
  ['Pulmonary tuberculosis', 'A15.0', 'Infectious', 'tb koch'],
  ['Viral infection, unspecified', 'B34.9', 'Infectious', 'viral fever'],
  ['Fever, unspecified', 'R50.9', 'Symptoms', 'pyrexia'],
  ['Typhoid fever', 'A01.0', 'Infectious', 'enteric fever'],
  ['Dengue fever', 'A90', 'Infectious', 'dengue'],
  ['Gastroenteritis and colitis of infectious origin', 'A09', 'Gastrointestinal', 'diarrhoea diarrhea loose motion'],
  ['Gastritis, unspecified', 'K29.7', 'Gastrointestinal', 'acidity'],
  ['Gastro-oesophageal reflux disease', 'K21.9', 'Gastrointestinal', 'gerd reflux heartburn'],
  ['Dyspepsia', 'K30', 'Gastrointestinal', 'indigestion'],
  ['Irritable bowel syndrome', 'K58.9', 'Gastrointestinal', 'ibs'],
  ['Constipation', 'K59.0', 'Gastrointestinal'],
  ['Abdominal pain, unspecified', 'R10.4', 'Symptoms'],
  ['Type 2 diabetes mellitus', 'E11.9', 'Endocrine', 'dm diabetes sugar'],
  ['Hypothyroidism, unspecified', 'E03.9', 'Endocrine', 'thyroid'],
  ['Hyperlipidaemia, unspecified', 'E78.5', 'Endocrine', 'dyslipidemia cholesterol'],
  ['Obesity, unspecified', 'E66.9', 'Endocrine'],
  ['Essential (primary) hypertension', 'I10', 'Cardiovascular', 'htn high blood pressure'],
  ['Chronic ischaemic heart disease', 'I25.9', 'Cardiovascular', 'ihd cad'],
  ['Chronic kidney disease, stage 3', 'N18.3', 'Renal', 'ckd'],
  ['Urinary tract infection', 'N39.0', 'Renal', 'uti burning micturition'],
  ['Iron deficiency anaemia', 'D50.9', 'Haematology', 'anemia'],
  ['Migraine, unspecified', 'G43.9', 'Neurology', 'headache'],
  ['Headache', 'R51', 'Symptoms'],
  ['Insomnia', 'G47.0', 'Neurology', 'sleep'],
  ['Anxiety disorder, unspecified', 'F41.9', 'Mental health'],
  ['Low back pain', 'M54.5', 'Musculoskeletal', 'backache lbp'],
  ['Primary osteoarthritis of knee', 'M17.9', 'Musculoskeletal', 'oa knee pain'],
  ['Dermatitis, unspecified', 'L30.9', 'Dermatology', 'eczema'],
  ['Dermatophytosis', 'B35.9', 'Dermatology', 'ringworm fungal'],
  ['Scabies', 'B86', 'Dermatology'],
  ['Conjunctivitis', 'H10.9', 'Ophthalmology', 'red eye'],
];

export const GLOBAL_INVESTIGATIONS: [string, string | null, string, string | null, string?][] = [
  ['Complete blood count', 'CBC', 'Haematology', 'Blood'],
  ['Erythrocyte sedimentation rate', 'ESR', 'Haematology', 'Blood'],
  ['Random blood sugar', 'RBS', 'Biochemistry', 'Blood'],
  ['Fasting blood sugar', 'FBS', 'Biochemistry', 'Blood', 'Overnight fasting 8–10 hours'],
  ['Blood sugar 2 hours after breakfast', '2HABF', 'Biochemistry', 'Blood'],
  ['HbA1c', 'HbA1c', 'Biochemistry', 'Blood'],
  ['Lipid profile', null, 'Biochemistry', 'Blood', 'Fasting 12 hours'],
  ['Serum creatinine', 'S. Creatinine', 'Biochemistry', 'Blood'],
  ['Serum electrolytes', null, 'Biochemistry', 'Blood'],
  ['SGPT (ALT)', 'SGPT', 'Biochemistry', 'Blood'],
  ['SGOT (AST)', 'SGOT', 'Biochemistry', 'Blood'],
  ['Serum bilirubin', null, 'Biochemistry', 'Blood'],
  ['Serum uric acid', null, 'Biochemistry', 'Blood'],
  ['Serum TSH', 'TSH', 'Hormone', 'Blood'],
  ['Serum vitamin D', 'Vit D', 'Biochemistry', 'Blood'],
  ['C-reactive protein', 'CRP', 'Immunology', 'Blood'],
  ['Widal test', null, 'Serology', 'Blood'],
  ['Dengue NS1 antigen', 'NS1', 'Serology', 'Blood'],
  ['HBsAg', null, 'Serology', 'Blood'],
  ['Blood grouping & Rh typing', null, 'Haematology', 'Blood'],
  ['Blood culture & sensitivity', 'Blood C/S', 'Microbiology', 'Blood'],
  ['Urine routine examination', 'Urine R/E', 'Clinical pathology', 'Urine'],
  ['Urine culture & sensitivity', 'Urine C/S', 'Microbiology', 'Urine', 'Mid-stream clean-catch sample'],
  ['Stool routine examination', 'Stool R/E', 'Clinical pathology', 'Stool'],
  ['Chest X-ray P/A view', 'CXR', 'Radiology', null],
  ['X-ray knee (AP/lateral)', null, 'Radiology', null],
  ['Electrocardiogram', 'ECG', 'Cardiology', null],
  ['Echocardiogram', 'Echo', 'Cardiology', null],
  ['Ultrasonography of whole abdomen', 'USG W/A', 'Radiology', null, 'Full bladder'],
  ['Spirometry', 'PFT', 'Respiratory', null],
];

export const GLOBAL_COMPLAINTS = [
  'Fever', 'Cough', 'Headache', 'Abdominal pain', 'Chest pain', 'Shortness of breath', 'Vomiting', 'Nausea', 'Diarrhoea',
  'Sore throat', 'Runny nose', 'Body ache', 'Joint pain', 'Back pain', 'Dizziness', 'Weakness', 'Loss of appetite',
  'Burning micturition', 'Skin rash', 'Itching', 'Palpitation', 'Constipation', 'Heartburn', 'Weight loss',
  'Sleep disturbance', 'Anxiety', 'Swelling of legs', 'Blurred vision', 'Ear pain', 'Numbness',
];

/** Default examination fields. Chambers can add their own or override by key. */
export const GLOBAL_VITALS: { key: string; label: string; unit: string | null; type: 'NUMBER' | 'BLOOD_PRESSURE' | 'TEXT'; min?: number; max?: number; decimals?: number; sort: number }[] = [
  { key: 'bp', label: 'Blood pressure', unit: 'mmHg', type: 'BLOOD_PRESSURE', sort: 10 },
  { key: 'pulse', label: 'Pulse', unit: 'bpm', type: 'NUMBER', min: 20, max: 250, sort: 20 },
  { key: 'temperature', label: 'Temperature', unit: '°F', type: 'NUMBER', min: 90, max: 110, decimals: 1, sort: 30 },
  { key: 'respiratory_rate', label: 'Respiratory rate', unit: '/min', type: 'NUMBER', min: 5, max: 80, sort: 40 },
  { key: 'spo2', label: 'SpO₂', unit: '%', type: 'NUMBER', min: 50, max: 100, sort: 50 },
  { key: 'weight', label: 'Weight', unit: 'kg', type: 'NUMBER', min: 0.5, max: 350, decimals: 1, sort: 60 },
  { key: 'height', label: 'Height', unit: 'cm', type: 'NUMBER', min: 30, max: 250, sort: 70 },
  { key: 'rbs', label: 'Random blood sugar', unit: 'mmol/L', type: 'NUMBER', min: 1, max: 40, decimals: 1, sort: 80 },
];

export async function syncReferenceData(prisma: PrismaClient) {
  const existingDx = new Set((await prisma.diagnosisCatalog.findMany({ where: { chamberId: null }, select: { name: true } })).map((d) => d.name.toLowerCase()));
  await prisma.diagnosisCatalog.createMany({
    data: GLOBAL_DIAGNOSES.filter(([name]) => !existingDx.has(name.toLowerCase())).map(([name, code, category, keywords]) => ({ name, code, category, keywords: keywords ?? null })),
  });
  const existingInv = new Set((await prisma.investigationCatalog.findMany({ where: { chamberId: null }, select: { name: true } })).map((d) => d.name.toLowerCase()));
  await prisma.investigationCatalog.createMany({
    data: GLOBAL_INVESTIGATIONS.filter(([name]) => !existingInv.has(name.toLowerCase())).map(([name, shortName, category, sampleType, instructions]) => ({
      name,
      shortName,
      category,
      sampleType,
      instructions: instructions ?? null,
    })),
  });
  const existingCc = new Set((await prisma.complaintCatalog.findMany({ where: { chamberId: null }, select: { name: true } })).map((d) => d.name.toLowerCase()));
  await prisma.complaintCatalog.createMany({ data: GLOBAL_COMPLAINTS.filter((n) => !existingCc.has(n.toLowerCase())).map((name) => ({ name })) });
  const existingV = new Set((await prisma.vitalDefinition.findMany({ where: { chamberId: null }, select: { key: true } })).map((v) => v.key));
  await prisma.vitalDefinition.createMany({
    data: GLOBAL_VITALS.filter((v) => !existingV.has(v.key)).map((v) => ({
      key: v.key,
      label: v.label,
      unit: v.unit,
      type: v.type,
      minValue: v.min ?? null,
      maxValue: v.max ?? null,
      decimals: v.decimals ?? 0,
      sortOrder: v.sort,
    })),
  });
}
