// The rule for when the Home hero shows its text (src/lib/hero.ts). Pure logic, no build needed.
//   npm run test:hero
import { HERO_TEXT_MODES, heroShowsText } from '../src/lib/hero.ts';

let pass = 0;
let fail = 0;
const check = (cond, name) => {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`);
};

console.log('Automatic (the default)');
check(heroShowsText('Automatic', true) === false, 'a video plays clean: no text');
check(heroShowsText('Automatic', false) === true, 'a poster picture only: the text is shown');
check(
  heroShowsText(undefined, true) === false,
  'content saved before this setting existed behaves as Automatic (video: no text)',
);
check(heroShowsText(undefined, false) === true, '...and with no video the text is shown');
check(
  heroShowsText('', true) === false && heroShowsText(null, false) === true,
  'an empty or missing value is Automatic',
);
check(
  heroShowsText('something odd', true) === false,
  'an unknown value is treated as Automatic, never as an error',
);

console.log('\nThe admin can override it');
check(heroShowsText('Always show', true) === true, '"Always show" puts the text over a video too');
check(heroShowsText('Always show', false) === true, '"Always show" over a picture');
check(heroShowsText('Always hide', true) === false, '"Always hide" over a video');
check(
  heroShowsText('Always hide', false) === false,
  '"Always hide" turns the text off even with only a picture',
);

console.log('\nThe admin choices');
check(
  HERO_TEXT_MODES.join('|') === 'Automatic|Always show|Always hide',
  'the three choices, Automatic first',
);

console.log(`\n${fail ? 'FAILED' : 'PASSED'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
