import { MedicineForm, PrismaClient } from '@prisma/client';
import { DEFAULT_ROUTE_BY_FORM } from '@chamber/shared';

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

/**
 * Global medicine master (spec §15): generic names only — brand names and
 * manufacturers are added per chamber, so no company is misattributed.
 * [generic, form, strength, category, defaultDose, frequencies, durations, keywords?]
 */
type Med = [string, MedicineForm, string | null, string, string | null, string[], string[], string?];
const TAB_DAYS = ['3 days', '5 days', '7 days'];
const LONG = ['1 month', '3 months', 'Continue'];
export const GLOBAL_MEDICINES: Med[] = [
  ['Paracetamol', 'TABLET', '500 mg', 'Analgesic / antipyretic', '1 tab', ['1+1+1', 'every 6 hours', 'SOS'], TAB_DAYS, 'fever pain acetaminophen napa'],
  ['Paracetamol', 'TABLET', '650 mg', 'Analgesic / antipyretic', '1 tab', ['1+1+1', 'SOS'], TAB_DAYS, 'fever pain acetaminophen'],
  ['Paracetamol', 'SUSPENSION', '120 mg/5 ml', 'Analgesic / antipyretic', '5 ml', ['1+1+1', 'every 6 hours'], TAB_DAYS, 'fever child syrup'],
  ['Ibuprofen', 'TABLET', '400 mg', 'NSAID', '1 tab', ['1+1+1', '1+0+1'], TAB_DAYS, 'pain inflammation'],
  ['Diclofenac sodium', 'TABLET', '50 mg', 'NSAID', '1 tab', ['1+0+1'], TAB_DAYS, 'pain'],
  ['Naproxen', 'TABLET', '500 mg', 'NSAID', '1 tab', ['1+0+1'], TAB_DAYS, 'pain'],
  ['Diclofenac', 'GEL', '1%', 'Topical NSAID', 'Apply locally', ['thrice daily'], TAB_DAYS, 'pain sprain'],
  ['Omeprazole', 'CAPSULE', '20 mg', 'Proton pump inhibitor', '1 cap', ['1+0+1', '1+0+0'], ['14 days', '1 month'], 'acidity gastritis ppi'],
  ['Esomeprazole', 'CAPSULE', '20 mg', 'Proton pump inhibitor', '1 cap', ['1+0+1', '1+0+0'], ['14 days', '1 month'], 'acidity gastritis ppi'],
  ['Esomeprazole', 'TABLET', '40 mg', 'Proton pump inhibitor', '1 tab', ['1+0+0'], ['14 days', '1 month'], 'acidity gerd ppi'],
  ['Pantoprazole', 'TABLET', '40 mg', 'Proton pump inhibitor', '1 tab', ['1+0+0', '1+0+1'], ['14 days', '1 month'], 'acidity ppi'],
  ['Famotidine', 'TABLET', '20 mg', 'H2 blocker', '1 tab', ['1+0+1'], ['7 days', '14 days'], 'acidity'],
  ['Antacid (aluminium + magnesium hydroxide)', 'SUSPENSION', null, 'Antacid', '10 ml', ['1+1+1'], ['7 days'], 'acidity heartburn'],
  ['Domperidone', 'TABLET', '10 mg', 'Antiemetic / prokinetic', '1 tab', ['1+1+1'], TAB_DAYS, 'vomiting nausea bloating'],
  ['Ondansetron', 'TABLET', '8 mg', 'Antiemetic', '1 tab', ['1+0+1', 'SOS'], ['3 days'], 'vomiting nausea'],
  ['Oral rehydration salts', 'SACHET', null, 'Rehydration', '1 sachet in 500 ml water', ['after each loose stool'], ['3 days'], 'ors diarrhoea dehydration saline'],
  ['Zinc sulfate', 'TABLET', '20 mg', 'Mineral supplement', '1 tab', ['1+0+0'], ['10 days'], 'diarrhoea zinc'],
  ['Metronidazole', 'TABLET', '400 mg', 'Antiprotozoal / antibiotic', '1 tab', ['1+1+1'], ['5 days', '7 days'], 'amoebiasis diarrhoea'],
  ['Amoxicillin', 'CAPSULE', '500 mg', 'Antibiotic (penicillin)', '1 cap', ['1+1+1'], ['5 days', '7 days'], 'antibiotic infection'],
  ['Amoxicillin + clavulanic acid', 'TABLET', '625 mg', 'Antibiotic (penicillin)', '1 tab', ['1+0+1'], ['5 days', '7 days'], 'antibiotic co-amoxiclav'],
  ['Azithromycin', 'TABLET', '500 mg', 'Antibiotic (macrolide)', '1 tab', ['1+0+0'], ['3 days', '5 days'], 'antibiotic'],
  ['Cefixime', 'CAPSULE', '200 mg', 'Antibiotic (cephalosporin)', '1 cap', ['1+0+1'], ['7 days', '14 days'], 'antibiotic typhoid'],
  ['Cefuroxime', 'TABLET', '500 mg', 'Antibiotic (cephalosporin)', '1 tab', ['1+0+1'], ['7 days'], 'antibiotic'],
  ['Ciprofloxacin', 'TABLET', '500 mg', 'Antibiotic (quinolone)', '1 tab', ['1+0+1'], ['5 days', '7 days'], 'antibiotic uti'],
  ['Nitrofurantoin', 'CAPSULE', '100 mg', 'Urinary antiseptic', '1 cap', ['1+0+1'], ['5 days', '7 days'], 'uti'],
  ['Doxycycline', 'CAPSULE', '100 mg', 'Antibiotic (tetracycline)', '1 cap', ['1+0+1'], ['7 days'], 'antibiotic'],
  ['Cetirizine', 'TABLET', '10 mg', 'Antihistamine', '1 tab', ['0+0+1'], ['5 days', '7 days', '14 days'], 'allergy itching sneezing'],
  ['Fexofenadine', 'TABLET', '120 mg', 'Antihistamine', '1 tab', ['1+0+0', '0+0+1'], ['7 days', '14 days'], 'allergy rhinitis'],
  ['Loratadine', 'TABLET', '10 mg', 'Antihistamine', '1 tab', ['0+0+1'], ['7 days'], 'allergy'],
  ['Desloratadine', 'TABLET', '5 mg', 'Antihistamine', '1 tab', ['0+0+1'], ['7 days', '14 days'], 'allergy urticaria'],
  ['Montelukast', 'TABLET', '10 mg', 'Leukotriene antagonist', '1 tab', ['0+0+1'], ['1 month', '3 months'], 'asthma allergy'],
  ['Salbutamol', 'INHALER', '100 mcg/puff', 'Bronchodilator', '2 puffs', ['SOS', 'every 6 hours'], ['1 month'], 'asthma wheeze inhaler'],
  ['Salbutamol', 'NEBULIZER_SOLUTION', '5 mg/ml', 'Bronchodilator', null, ['every 6 hours'], ['3 days'], 'asthma nebulisation'],
  ['Budesonide + formoterol', 'INHALER', '160/4.5 mcg', 'Inhaled corticosteroid combination', '1 puff', ['1+0+1'], LONG, 'asthma copd'],
  ['Dextromethorphan', 'SYRUP', '10 mg/5 ml', 'Cough suppressant', '10 ml', ['1+1+1'], ['5 days'], 'dry cough'],
  ['Ambroxol', 'SYRUP', '15 mg/5 ml', 'Mucolytic', '10 ml', ['1+1+1'], ['5 days', '7 days'], 'cough expectorant'],
  ['Fluticasone propionate', 'NASAL_SPRAY', '50 mcg/spray', 'Nasal corticosteroid', '2 sprays each nostril', ['1+0+0'], ['14 days', '1 month'], 'rhinitis nasal'],
  ['Xylometazoline', 'NASAL_SPRAY', '0.1%', 'Nasal decongestant', '1 spray each nostril', ['1+0+1'], ['5 days'], 'blocked nose cold'],
  ['Metformin', 'TABLET', '500 mg', 'Antidiabetic (biguanide)', '1 tab', ['1+0+1'], LONG, 'diabetes sugar'],
  ['Metformin', 'TABLET', '850 mg', 'Antidiabetic (biguanide)', '1 tab', ['1+0+1'], LONG, 'diabetes sugar'],
  ['Gliclazide', 'TABLET', '80 mg', 'Antidiabetic (sulfonylurea)', '1 tab', ['1+0+0', '1+0+1'], LONG, 'diabetes'],
  ['Glimepiride', 'TABLET', '2 mg', 'Antidiabetic (sulfonylurea)', '1 tab', ['1+0+0'], LONG, 'diabetes'],
  ['Sitagliptin', 'TABLET', '50 mg', 'Antidiabetic (DPP-4 inhibitor)', '1 tab', ['1+0+0'], LONG, 'diabetes gliptin'],
  ['Empagliflozin', 'TABLET', '10 mg', 'Antidiabetic (SGLT2 inhibitor)', '1 tab', ['1+0+0'], LONG, 'diabetes gliflozin'],
  ['Amlodipine', 'TABLET', '5 mg', 'Antihypertensive (calcium channel blocker)', '1 tab', ['1+0+0'], LONG, 'blood pressure htn'],
  ['Losartan potassium', 'TABLET', '50 mg', 'Antihypertensive (ARB)', '1 tab', ['1+0+0'], LONG, 'blood pressure htn'],
  ['Telmisartan', 'TABLET', '40 mg', 'Antihypertensive (ARB)', '1 tab', ['1+0+0'], LONG, 'blood pressure htn'],
  ['Bisoprolol', 'TABLET', '2.5 mg', 'Beta blocker', '1 tab', ['1+0+0'], LONG, 'blood pressure heart'],
  ['Bisoprolol', 'TABLET', '5 mg', 'Beta blocker', '1 tab', ['1+0+0'], LONG, 'blood pressure heart'],
  ['Hydrochlorothiazide', 'TABLET', '25 mg', 'Diuretic', '1 tab', ['1+0+0'], LONG, 'blood pressure'],
  ['Furosemide', 'TABLET', '40 mg', 'Loop diuretic', '1 tab', ['1+0+0'], ['7 days', '1 month'], 'oedema'],
  ['Atorvastatin', 'TABLET', '10 mg', 'Statin', '1 tab', ['0+0+1'], LONG, 'cholesterol lipid'],
  ['Atorvastatin', 'TABLET', '20 mg', 'Statin', '1 tab', ['0+0+1'], LONG, 'cholesterol lipid'],
  ['Rosuvastatin', 'TABLET', '10 mg', 'Statin', '1 tab', ['0+0+1'], LONG, 'cholesterol lipid'],
  ['Aspirin', 'TABLET', '75 mg', 'Antiplatelet', '1 tab', ['0+1+0'], LONG, 'heart ecosprin'],
  ['Clopidogrel', 'TABLET', '75 mg', 'Antiplatelet', '1 tab', ['0+1+0'], LONG, 'heart'],
  ['Isosorbide mononitrate', 'TABLET', '20 mg', 'Anti-anginal', '1 tab', ['1+0+1'], LONG, 'angina heart'],
  ['Levothyroxine', 'TABLET', '50 mcg', 'Thyroid hormone', '1 tab', ['1+0+0'], LONG, 'thyroid hypothyroidism'],
  ['Levothyroxine', 'TABLET', '100 mcg', 'Thyroid hormone', '1 tab', ['1+0+0'], LONG, 'thyroid hypothyroidism'],
  ['Prednisolone', 'TABLET', '5 mg', 'Corticosteroid', '1 tab', ['1+0+0'], ['5 days', '7 days'], 'steroid'],
  ['Calcium carbonate + vitamin D3', 'TABLET', '500 mg + 200 IU', 'Mineral supplement', '1 tab', ['1+0+1', '0+1+0'], ['1 month', '3 months'], 'calcium bone'],
  ['Cholecalciferol (vitamin D3)', 'CAPSULE', '40,000 IU', 'Vitamin', '1 cap', ['once weekly'], ['8 weeks'], 'vitamin d deficiency'],
  ['Ferrous fumarate + folic acid', 'CAPSULE', null, 'Haematinic', '1 cap', ['0+1+0'], ['1 month', '3 months'], 'iron anaemia'],
  ['Folic acid', 'TABLET', '5 mg', 'Vitamin', '1 tab', ['1+0+0'], ['1 month'], 'pregnancy anaemia'],
  ['Vitamin B complex', 'TABLET', null, 'Vitamin', '1 tab', ['1+0+1'], ['1 month'], 'vitamin weakness'],
  ['Multivitamin + minerals', 'TABLET', null, 'Vitamin', '1 tab', ['0+1+0'], ['1 month'], 'vitamin weakness'],
  ['Clotrimazole', 'CREAM', '1%', 'Topical antifungal', 'Apply thinly', ['1+0+1'], ['14 days', '1 month'], 'fungal ringworm'],
  ['Terbinafine', 'TABLET', '250 mg', 'Antifungal', '1 tab', ['1+0+0'], ['14 days', '1 month'], 'fungal ringworm'],
  ['Fluconazole', 'CAPSULE', '150 mg', 'Antifungal', '1 cap', ['once weekly'], ['2 weeks'], 'fungal candida'],
  ['Permethrin', 'CREAM', '5%', 'Scabicide', 'Apply whole body', ['at night'], ['1 day'], 'scabies'],
  ['Mupirocin', 'OINTMENT', '2%', 'Topical antibiotic', 'Apply locally', ['thrice daily'], ['7 days'], 'skin infection impetigo'],
  ['Hydrocortisone', 'CREAM', '1%', 'Topical corticosteroid', 'Apply thinly', ['1+0+1'], ['7 days'], 'eczema dermatitis'],
  ['Calamine', 'LOTION', null, 'Soothing lotion', 'Apply locally', ['thrice daily'], ['7 days'], 'itching rash'],
  ['Chloramphenicol', 'EYE_DROPS', '0.5%', 'Ophthalmic antibiotic', '1 drop', ['every 6 hours'], ['5 days', '7 days'], 'conjunctivitis red eye'],
  ['Moxifloxacin', 'EYE_DROPS', '0.5%', 'Ophthalmic antibiotic', '1 drop', ['thrice daily'], ['7 days'], 'conjunctivitis'],
  ['Carboxymethylcellulose', 'EYE_DROPS', '0.5%', 'Lubricant eye drops', '1 drop', ['four times daily'], ['1 month'], 'dry eye tears'],
  ['Ciprofloxacin', 'EAR_DROPS', '0.3%', 'Otic antibiotic', '2 drops', ['1+0+1'], ['7 days'], 'ear infection otitis'],
  ['Chlorhexidine', 'MOUTHWASH', '0.2%', 'Antiseptic mouthwash', '10 ml gargle', ['1+0+1'], ['7 days'], 'gum mouth'],
  ['Lactulose', 'SYRUP', '3.35 g/5 ml', 'Laxative', '15 ml', ['0+0+1'], ['7 days', '14 days'], 'constipation'],
  ['Ispaghula husk', 'SACHET', '3.5 g', 'Bulk laxative', '1 sachet in water', ['0+0+1'], ['14 days', '1 month'], 'constipation fibre'],
  ['Hyoscine butylbromide', 'TABLET', '10 mg', 'Antispasmodic', '1 tab', ['1+1+1', 'SOS'], ['3 days'], 'abdominal pain cramp'],
  ['Mebeverine', 'TABLET', '135 mg', 'Antispasmodic', '1 tab', ['1+1+1'], ['14 days', '1 month'], 'ibs'],
  ['Albendazole', 'TABLET', '400 mg', 'Anthelmintic', '1 tab', ['0+0+1'], ['1 day'], 'worm'],
  ['Sumatriptan', 'TABLET', '50 mg', 'Antimigraine', '1 tab', ['SOS'], ['1 month'], 'migraine headache'],
  ['Propranolol', 'TABLET', '10 mg', 'Beta blocker', '1 tab', ['1+0+1'], ['1 month', '3 months'], 'migraine prophylaxis anxiety tremor'],
  ['Flunarizine', 'CAPSULE', '5 mg', 'Antimigraine / antivertigo', '1 cap', ['0+0+1'], ['1 month'], 'migraine vertigo'],
  ['Betahistine', 'TABLET', '16 mg', 'Antivertigo', '1 tab', ['1+0+1'], ['14 days', '1 month'], 'vertigo dizziness'],
  ['Pregabalin', 'CAPSULE', '75 mg', 'Neuropathic pain', '1 cap', ['0+0+1', '1+0+1'], ['1 month'], 'neuropathy nerve pain'],
  ['Tamsulosin', 'CAPSULE', '0.4 mg', 'Alpha blocker', '1 cap', ['0+0+1'], LONG, 'bph prostate'],
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
  const existingMed = new Set(
    (await prisma.medicine.findMany({ where: { chamberId: null }, select: { genericName: true, form: true, strength: true } })).map((m) => `${m.genericName}|${m.form}|${m.strength ?? ''}`.toLowerCase()),
  );
  await prisma.medicine.createMany({
    data: GLOBAL_MEDICINES.filter(([g, form, strength]) => !existingMed.has(`${g}|${form}|${strength ?? ''}`.toLowerCase())).map(([genericName, form, strength, category, defaultDose, commonFrequencies, commonDurations, keywords]) => ({
      genericName,
      form,
      strength,
      category,
      route: DEFAULT_ROUTE_BY_FORM[form] ?? null,
      defaultDose,
      commonFrequencies,
      commonDurations,
      keywords: keywords ?? null,
    })),
  });
}
