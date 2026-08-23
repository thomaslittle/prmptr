import fs from 'node:fs';
let s = fs.readFileSync('app/landing/page.tsx', 'latin1');

// Fix multi-byte UTF-8 sequences mangled through cp1252/latin1 round-trips.
// Each pattern matches what a specific UTF-8 sequence looks like when
// every byte is independently mapped through latin1.
const fixes = [
  // U+2014 em-dash: E2 80 94
  [/\u00E2\u0080\u0094/g, '\u2014'],
  // U+2013 en-dash: E2 80 93
  [/\u00E2\u0080\u0093/g, '\u2013'],
  // U+00B7 middle dot: C2 B7
  [/\u00C2\u00B7/g, '\u00B7'],
  // U+00A9 copyright: C2 A9
  [/\u00C2\u00A9/g, '\u00A9'],
  // U+2019 right single quote: E2 80 99
  [/\u00E2\u0080\u0099/g, '\u2019'],
  // U+2026 ellipsis: E2 80 A6
  [/\u00E2\u0080\u00A6/g, '\u2026'],
  // U+201C left dquote: E2 80 9C
  [/\u00E2\u0080\u009C/g, '\u201C'],
  // U+201D right dquote: E2 80 9D
  [/\u00E2\u0080\u009D/g, '\u201D'],
];

let count = 0;
for (const [re, rep] of fixes) {
  const m = s.match(re);
  if (m) { count += m.length; s = s.replace(re, rep); }
}

// Nuke any remaining non-ASCII to safe hyphen (comments only at this point)
s = s.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '-');

fs.writeFileSync('app/landing/page.tsx', s, 'utf8');
console.log(`Fixed ${count} sequences; sanitized remaining non-ascii`);
