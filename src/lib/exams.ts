/**
 * The exams the institute prepares students for. ONE list, used by the enquiry forms, the course categories, the
 * exam-update filters, the landing pages and the free tests, so they always agree.
 *
 * google-apps-script/Code.gs and dev-server/server.mjs cannot import this file, so they carry a copy of the list;
 * `npm run test:exams` fails if any copy drifts.
 */
export const OFFERED_EXAMS = ['IAS', 'PCS', 'HPAS', 'HCS'] as const;

/** What a student can pick in a form: the exams above, or something else. */
export const EXAMS: string[] = [...OFFERED_EXAMS, 'Other'];

/** The full names, shown as captions and in search. */
export const EXAM_NAMES: Record<string, string> = {
  IAS: 'UPSC Civil Services (IAS)',
  PCS: 'Punjab Civil Services (PCS)',
  HPAS: 'Himachal Pradesh Administrative Services (HPAS)',
  HCS: 'Haryana Civil Services (HCS)',
};

/**
 * Names the website used before the four exams above. Enquiries already in the sheet carry them, and a backend that has not
 * been updated yet only knows them, so they stay valid on the receiving side. They map onto today's names.
 */
export const LEGACY_EXAMS: Record<string, string> = {
  'UPSC CSE': 'IAS',
  'Punjab PSC (PCS)': 'PCS',
  'Punjab PSC': 'PCS',
  'Punjab One Day Exams': 'Other',
  'Punjab One Day': 'Other',
  Optional: 'IAS',
  'Test series': 'IAS',
  // the issuing bodies an exam update used to be filed under
  UPSC: 'IAS',
  PPSC: 'PCS',
  PSSSB: 'Other',
  'Punjab Police': 'Other',
};

/** Today's name for an exam, whichever generation of the name it is written in ('' when it is not one of ours). */
export function examName(value: string | undefined | null): string {
  const v = (value ?? '').trim();
  if (EXAMS.includes(v)) return v;
  return LEGACY_EXAMS[v] ?? '';
}
