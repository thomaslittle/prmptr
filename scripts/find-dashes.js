const fs = require('fs');
let s = fs.readFileSync('app/landing/page.tsx', 'utf8');

// Find all runs of 3+ consecutive hyphens (single hyphens are legitimate in code)
const matches = [...s.matchAll(/-{3,}/g)];
console.log('Multi-dash runs (3+):', matches.length);
for (const m of matches) {
  const start = Math.max(0, m.index - 25);
  const end = Math.min(s.length, m.index + m[0].length + 25);
  const ctx = s.slice(start, end).replace(/\n/g, '\\n');
  console.log(`  @${m.index} [${m[0].length} dashes]: ${ctx}`);
}

// Also find double-dash inside string literals (between quotes)
const strMatches = [...s.matchAll(/"([^"]*)-{2,}([^"]*)"/g)];
console.log('\nDouble-dash in strings:', strMatches.length);
for (const m of strMatches) {
  console.log(`  "${m[1]}---${m[2]}"`);
}
