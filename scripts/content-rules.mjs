// Builds the "content lock" for the backends from src/admin/schemas.ts (the field list that draws the
// admin forms), so what the admin PANEL shows and what the backend ACCEPTS can never drift apart.
//
//   npm run rules              rewrite google-apps-script/content-rules.json and the GENERATED block in Code.gs
//   npm run rules -- --check   fail (exit 1) when either is out of date; used by test:gs and the deploy workflow
//
// Run `npm run rules` after changing src/admin/schemas.ts or google-apps-script/content-lock.mjs.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const SCHEMAS = root('src/admin/schemas.ts');
const LOCK = root('google-apps-script/content-lock.mjs');
const RULES_JSON = root('google-apps-script/content-rules.json');
const CODE_GS = root('google-apps-script/Code.gs');
const BEGIN =
  '/* ===== BEGIN GENERATED: content lock (npm run rules). Do not edit by hand. ===== */';
const END = '/* ===== END GENERATED ===== */';

/** schemas.ts is plain TypeScript with no imports: transpile it in memory and load it. */
async function loadSchemas() {
  const source = await readFile(SCHEMAS, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

/** One admin field -> one backend rule (only what the validator needs). */
function rule(field) {
  const r = { label: field.label, type: field.type };
  // Fields that only appear for some values of another field (showIf) can never be mandatory.
  if (field.required && !field.showIf) r.required = true;
  for (const k of [
    'max',
    'maxItems',
    'options',
    'addOnly',
    'pattern',
    'patternFlags',
    'patternHelp',
  ]) {
    if (field[k] !== undefined) r[k] = field[k];
  }
  if (field.sub) r.sub = field.sub.map((s) => ({ key: s.key, ...rule(s) }));
  return r;
}
const fieldMap = (fields) => Object.fromEntries(fields.map((f) => [f.key, rule(f)]));

export async function buildRules() {
  const s = await loadSchemas();
  const system = (def) =>
    [def.order && 'order', def.published && 'published', 'dummy'].filter(Boolean);
  const rules = {
    // Singletons: exactly one file each; the admin can edit it but never add, rename or delete it.
    settings: {
      files: ['site'],
      fields: fieldMap(s.SETTINGS_FIELDS),
      system: [],
      developerOnly: s.DEVELOPER_ONLY.settings,
    },
    home: {
      files: ['home'],
      fields: fieldMap(s.HOME_SECTIONS.flatMap((x) => x.fields)),
      system: [],
    },
    // `published` is an ordinary checkbox field on landing pages.
    'landing-pages': { fields: fieldMap(s.LANDING_FIELDS), system: ['dummy'] },
  };
  for (const def of [
    s.COURSES,
    s.TEACHERS,
    s.RESULTS,
    s.REELS,
    s.RESOURCES,
    s.EXAM_UPDATES,
    s.TESTS,
  ]) {
    rules[def.folder] = { fields: fieldMap(def.fields), system: system(def) };
  }
  return rules;
}

/** The text that goes between the markers in Code.gs: the rule table plus the validator. */
function generatedBlock(rules, lockSource) {
  const body = lockSource
    .replace(/^\/\*\*[\s\S]*?\*\/\n/, '') // the header comment lives in content-lock.mjs
    .replace('export function cleanContent(', 'function cleanContent_(');
  const lines = Object.entries(rules).map(
    ([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`,
  );
  return [
    BEGIN,
    '// What the admin panel may write. Source: src/admin/schemas.ts + google-apps-script/content-lock.mjs.',
    'var CONTENT_RULES = {',
    lines.join(',\n'),
    '};',
    '',
    body.trimEnd(),
    END,
  ].join('\n');
}

const rules = await buildRules();
const lockSource = await readFile(LOCK, 'utf8');
const wantJson = `${JSON.stringify(rules, null, 2)}\n`;
const code = await readFile(CODE_GS, 'utf8');
const start = code.indexOf(BEGIN);
const stop = code.indexOf(END);
if (start < 0 || stop < start) {
  console.error(`Code.gs has no "${BEGIN}" ... "${END}" block.`);
  process.exit(1);
}
const wantCode =
  code.slice(0, start) + generatedBlock(rules, lockSource) + code.slice(stop + END.length);
const haveJson = await readFile(RULES_JSON, 'utf8').catch(() => '');

if (process.argv.includes('--check')) {
  const stale = [];
  if (haveJson !== wantJson) stale.push('google-apps-script/content-rules.json');
  if (code !== wantCode) stale.push('google-apps-script/Code.gs (generated block)');
  if (stale.length) {
    console.error(`Out of date: ${stale.join(', ')}.\nRun:  npm run rules`);
    process.exit(1);
  }
  console.log('content lock is up to date');
} else {
  await writeFile(RULES_JSON, wantJson);
  await writeFile(CODE_GS, wantCode);
  console.log('wrote google-apps-script/content-rules.json and the generated block in Code.gs');
}
