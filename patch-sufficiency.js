const fs = require('fs');
let backend = fs.readFileSync('index.js', 'utf8');

const oldSufficiency = `NEW POLICY needs client identity, one concrete asset with detail, one insurer and premium. Flag but do not invent: a market comparison if only one insurer is mentioned; KYC confirmations if not stated; for Commercial, turnover and Gross Profit if Business Interruption is mentioned with no financials; liability limits if a liability type is mentioned with no limit.`;

const newSufficiency = `NEW POLICY needs client identity, one concrete asset with detail, one insurer and premium. Flag but do not invent: a market comparison if only one insurer is mentioned; KYC confirmations if not stated; for Commercial, turnover and Gross Profit if Business Interruption is mentioned with no financials; liability limits if a liability type is mentioned with no limit. PERSONAL LINES RULES — do NOT flag any of the following as missing: income, occupation, employment status, or dependents (not required for standard personal lines RoA); premium breakdown per cover section (a single all-in premium is acceptable); confirmation that sum insured amounts are agreed vs estimated when specific rand values are clearly stated in the notes; general needs analysis documentation when assets and cover requirements are clearly described. For personal lines, limit flags to genuine FAIS gaps only: missing KYC if not mentioned, missing market comparison if only one insurer quoted on new business, missing replacement advice confirmation if switching insurers, missing excess structure if no excess mentioned at all.`;

backend = backend.replace(oldSufficiency, newSufficiency);
fs.writeFileSync('index.js', backend, 'utf8');
console.log('✓ SYSTEM_SUFFICIENCY updated — personal lines overchecking reduced');