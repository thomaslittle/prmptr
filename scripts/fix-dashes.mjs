import fs from 'node:fs';
let s = fs.readFileSync('app/landing/page.tsx', 'utf8');

// Fix footer provider separators (in span elements)
s = s.replace(/Anthropic -{2,} ?OpenAI/g, 'Anthropic \u00B7 OpenAI');
s = s.replace(/Groq -{2,} ?Cerebras -{2,} ?LM Studio/g, 'Groq \u00B7 Cerebras \u00B7 LM Studio');
s = s.replace(/Groq -{2,} ?Cerebras/g, 'Groq \u00B7 Cerebras');

// Fix Groq line break remnant
s = s.replace(/Groq -{3,}/g, 'Groq, ');

// Fix comment section dividers — collapse any 5+ dash runs around section names
const SECTIONS = ['HERO','WAVEFORM BAND','THE PROBLEM','LOCAL FIRST','THE APP','APPROACH','CAPABILITIES','FAQ','FINAL CTA','FOOTER'];
for (const name of SECTIONS) {
    const esc = name.replace(/ /g, '\\s+');
    const pat1 = new RegExp('-{10,}\\s+' + esc + '\\s+-{5,}', 'g');
    s = s.replace(pat1, '\u2550\u2550\u2550 ' + name + ' \u2550\u2550\u2550');
    const pat2 = new RegExp(esc + '\\s+-{10,}', 'g');
    s = s.replace(pat2, name + ' \u2550\u2550\u2550');
}

// Clean up remaining standalone long-dash comment dividers
s = s.replace(/\{\/\* -{15,}\s*\*\/\}/g, '');
s = s.replace(/-{20,}/g, '\u2550\u2550\u2550');

fs.writeFileSync('app/landing/page.tsx', s, 'utf8');
const remaining = [...s.matchAll(/-{4,}/g)];
console.log('Remaining 4+ dash runs:', remaining.length);
for (const m of remaining) {
    const ctx = s.slice(Math.max(0,m.index-20), m.index+m[0].length+20).replace(/\n/g,'\\n');
    console.log('  @' + m.index + ': ' + ctx);
}
