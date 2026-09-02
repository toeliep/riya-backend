const express = require('express');
const fs = require('fs');
const { sendWelcomeEmail, sendRoAEmail, parseRoAContent } = require('./resend_helper');
const PDFDocument = require('pdfkit');
const https = require('https');
const multerUpload = require('multer')({
  storage: require('multer').memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});
 
function transcribeWithElevenLabs(fileBuffer, filename, mimetype, languageCode) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return reject(new Error('ELEVENLABS_API_KEY not configured on server'));
    const boundary = '----RiyaVoiceBoundary' + Date.now();
    const parts = [];
    parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="model_id"\r\n\r\nscribe_v2\r\n'));
    if (languageCode) {
      parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="language_code"\r\n\r\n' + languageCode + '\r\n'));
    }
    parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + filename + '"\r\nContent-Type: ' + (mimetype || 'application/octet-stream') + '\r\n\r\n'));
    parts.push(fileBuffer);
    parts.push(Buffer.from('\r\n--' + boundary + '--\r\n'));
    const payload = Buffer.concat(parts);
    const options = {
      hostname: 'api.elevenlabs.io',
      path: '/v1/speech-to-text',
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': payload.length }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode !== 200) reject(new Error('ElevenLabs error (' + res.statusCode + '): ' + (parsed.detail || JSON.stringify(parsed)).substring(0, 300)));
          else resolve(parsed.text || '');
        } catch (e) { reject(new Error('ElevenLabs parse error: ' + e.message)); }
      });
    });
    req.on('error', e => reject(new Error('Network: ' + e.message)));
    req.write(payload);
    req.end();
  });
}
 
const app = express();
const cors = require('cors');
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
 
function forceHeadingLinebreaks(text) {
  // Fix OUTsurance name break before any other processing
  text = text.replace(/OU[\r\n\s]*T[\r\n\s]*surance/g, 'OUTsurance').replace(/OU[\r\n\s]*T[\r\n\s]*bonus/g, 'OUTbonus');
  let out = text.replace(/#{1,3}\s*(?=\d{1,2}\.\s+[A-Z])/gi, '');
  const knownTitles = [
    'FSP AND REPRESENTATIVE DETAILS',
    'CLIENT IDENTIFICATION,?\\s*KYC,?\\s*FICA AND POPIA(?:\\s+CONFIRMATION)?',
    'NEEDS ANALYSIS|BEHOEFTE-ANALISE',
    'MARKET COMPARISON|MARKVERGELYKING',
    'PRODUCT RECOMMENDED|AANBEVOLE PRODUK',
    'REMUNERATION AND CONFLICT OF INTEREST',
    'REPLACEMENT ADVICE|VERVANGINGSADVIES',
    'CLIENT ACCEPTANCE RECORD|KLIENT AANVAARDINGSREKORD'
  ];
  const titleAlt = knownTitles.join('|');
  const headingRe = new RegExp('(\\d{1,2}\\.\\s+(?:' + titleAlt + '))', 'gi');
  out = out.replace(new RegExp('([^\\n])' + '(\\d{1,2}\\.\\s+(?:' + titleAlt + '))', 'gi'), '$1\n\n$2');
  out = out.replace(headingRe, '$1\n');
  out = out.replace(/([^\n])(\d{1,2}\.\s+[A-Z][A-Z\s,&/-]{4,})/g, '$1\n\n$2');
  out = out.replace(/\b([A-Z]{2,}(?:[\s,&/-]+[A-Z]{2,})*)([A-Z][a-z])/g, '$1\n$2');
  out = out.replace(/([^\n-])-{2,3}(\n|$)/g, '$1$2');
  out = out.replace(/^-{3,}\s*$/gm, ''); 
  
  // Force line breaks before Afrikaans field labels
  var afLabels = [
    'Finansiele Diensverskaffer (FSP):',
    'FSP-Registrasienommer:',
    'Verteenwoordiger Naam:',
    'Nakoming Beampte:',
    'Beroepsaanspreeklikheidsversekering:',
    'Advies Datum:',
    'Klient Naam:',
    'Identiteitsnommer:',
    'Kontaknommer:',
    'E-posadres:',
    'Residensiele Adres:',
    'Identiteitsverifikasie:',
    'Adresbewys:',
    'POPIA-Toestemming:',
    'FICA-Status:',
    'Eisgeskiedenisverklaring:',
    'FAIS-Openbaarmaking:',
    'Adres:',
    'Versekeraar:',
    'Produkklassifikasie:',
    'Dekkingsbasis:',
    'Effektiewe Datum:',
    'Vergoeding van FSP:',
    'Belangebotsingsverklaring:',
    'Metode van Aanvaarding:',
    'Datum van Aanvaarding:',
    'MOTORVOERTUIE:',
    'MOTORVOERTUIE',
    'GEBOUE:',
    'INHOUD:',
    'GESPESIFISEERDE ITEMS:',
    'GESPESIFISEERDE VOORWERPE:',
    'STATUTERE UITSLUITINGS:',
    'BYBETALINGSTRUKTUUR:',
    'SASRIA-DEKKING:'
  ];
  afLabels.forEach(function(l) { out = out.split(l).join('\n' + l); });
  out = out.replace(/\bAanhangig\b/g, 'Uitstaande');
  out = out.replace(/\bHangende\b/g, 'Uitstaande');
  return out;
}
 
function trimToSection(text, sectionNumber) {
  const re = new RegExp('(^|\\n)\\s*' + sectionNumber + '\\.\\s+[A-Z]');
  const match = re.exec(text);
  if (match) {
    return text.slice(match.index + match[1].length).trim();
  }
  return text.trim();
}
 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
 
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
 
const SYSTEM_ROA = "You are Riya, an expert South African FAIS compliance assistant. You produce professional, FAIS-compliant Records of Advice for South African short-term insurance brokers under the FAIS Act 37 of 2002, Board Notice 80 of 2003, and General Notice 706 of 2020.\nProduce a complete, professional RoA covering ALL of the following sections:\n1. FSP and Representative Details\n2. Client Identification and KYC/FICA/POPIA confirmation\n3. Needs Analysis - detailed risk profile and identified needs per asset category\n4. Market Comparison - all three insurers compared with reasons for recommendation\n5. Product Recommended - full Section 9(1) statutory detail including exclusions, excess structure, SASRIA\n6. Remuneration and Conflict of Interest declaration\n7. Replacement Advice (if applicable)\n8. Client Acceptance Record\nBe thorough and substantive. Use clear numbered headings. Write in professional English suitable for FSCA inspection. Do not cite case law. Do NOT use markdown tables - use labeled paragraphs and bullet points instead. CRITICAL LEGAL CITATIONS — always use these exact references: Financial Intelligence Centre Act 38 of 2001 (NOT 2020, NOT 1986); FAIS Act 37 of 2002; Short-Term Insurance Act 53 of 1998; POPIA Act 4 of 2013; Board Notice 80 of 2003; General Notice 706 of 2020. CRITICAL: Do NOT insert any '---' separator lines or '##' markdown characters anywhere in the output. Only use section numbers (1. 2. 3. etc) as headings. Never add separator lines.";
 
const AGRI_GUIDANCE = " ADDITIONAL AGRICULTURAL RISK GUIDANCE - this input involves a farming/agricultural operation. Apply the following South African agri-insurance domain knowledge: NEEDS ANALYSIS must establish, where the input provides it: the type of farming operation (crop, livestock, mixed, or game farming); crop type(s) and hectares under cultivation per field, and whether dryland or irrigated (this materially changes risk); livestock type and numbers if applicable; storage/processing facilities (silos, cold storage, packhouses) and capacity; existing risk mitigation such as hail netting, irrigation backup, or security measures; historical claims/hail damage history, since this is a major underwriting factor in South African crop insurance; farm labour numbers for Employers Liability relevance; and whether the farm has broader commercial exposures beyond crop - buildings, machinery, irrigation infrastructure, business interruption. PRODUCT RECOMMENDED / SECTION 9(1) CONVENTIONS FOR CROP COVER: sum insured for crop cover is normally structured PER FIELD via a Cropping Plan (field name, crop and variety, hectares planted, sowing date, emergence date, average yield per hectare, value per ton, sum insured per field) rather than one blanket figure - reflect this structure if the input describes multiple fields or crop types. Crop cover is typically a NAMED PERIL structure with hail as the base peril, extended to include fire, lightning, flood, frost and windstorm as stated in the schedule - specify which perils are actually included based on the input, do not assume all are included unless stated. The deductible for crop cover is normally expressed as a PERCENTAGE of the value at risk, not a flat rand amount. If the cover is revenue-based rather than yield-based, note the distinction: yield cover guarantees a minimum tonnage per hectare; revenue-based cover guarantees a portion of the revenue the farmer would have earned, typically linked to Safex futures pricing - only state which basis applies if the input specifies it, otherwise do not assume. STANDARD CROP EXCLUSIONS to reference where relevant and not otherwise stated as covered: drought (never covered under standard crop policies, including irrigation equipment breakdown); Fall Army Worm and other controllable pests, diseases or weeds; consequential loss of any kind; harvested crops and crops in transit; earth movement; nuclear pollution; war and terrorism; infectious disease. SPECIAL CONDITIONS commonly required for crop cover: the insured must keep written farming log-books/records for the insurance period; the insured must offer ALL fields under cultivation for insurance, not selectively insure only high-risk fields; loss must be reported in writing within 48 hours of occurrence; the insurer has a right of inspection. BROADER FARM RISK - if the input describes exposures beyond crop cover, use the correct South African agri-insurance class names rather than generic commercial wording: Buildings Combined (farm structures); Business Interruption (specify basis if stated: Gross Profit, Gross Rentals, or Revenue); Machinery Breakdown, and resulting Loss of Profits if applicable; Deterioration of Stock (relevant for cold storage/produce); Transit - note that livestock, pedigreed animals, game and ostriches are typically insured under a SEPARATE transit class from general goods, do not merge them; Live Stock - Herd cover for livestock as an asset class in its own right, separate from crop; Spray Irrigation Systems (wheel-move and center pivot systems are a distinct equipment class from general machinery); Public Liability and Employers Liability. Only include a class if the input actually describes that exposure - do not invent buildings, machinery, or livestock cover that was not mentioned. SASRIA - state SASRIA cover concisely and confidently as a standard statutory inclusion under the Short-Term Insurance Act 53 of 1998, integrated into the quoted premium at no separate additional charge, covering riot, strike, civil commotion, malicious damage and terrorism - the same direct, one-paragraph treatment used for non-agri commercial products. Do NOT phrase this as something the insurer 'has confirmed' or attribute a specific verification statement to the insurer. Do NOT invent specific claims-handling conditions, precautionary requirements, or procedural detail for SASRIA claims that is not present in the input - if no such detail was provided, do not add any.";
 
function isAgriContent(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  const keywords = [
    'crop', 'hectare', 'livestock', 'cattle', 'maize', 'wheat', 'soya', 'sunflower',
    'dryland', 'irrigation', 'hail damage', 'harvest', 'farming', 'farm ', 'silo',
    'cropping plan', 'yield', 'game farming', 'pivot irrigation', 'agri',
    'plaas', 'boerdery', 'mielies', 'koring', 'besproeiing', 'hael', 'oes', 'vee ', 'lande'
  ];
  return keywords.some(k => t.includes(k));
}
 
function buildSystemRoa(userText, language) {  const base = language === 'af' ? SYSTEM_ROA_AF : SYSTEM_ROA;
  const agri = language === 'af' ? AGRI_GUIDANCE_AF : AGRI_GUIDANCE;
  const rules = language === 'af' ? ACCURACY_RULES_AF : ACCURACY_RULES_EN;
  if (isAgriContent(userText)) return base + agri + rules;
  return base + rules;
}
 
const SYSTEM_ROA_AF = "Jy is Riya, 'n kundige Suid-Afrikaanse FAIS-nakomingsassistent. Jy stel professionele, FAIS-konforme Rekords van Advies op vir Suid-Afrikaanse korttermynversekeringsmakelaars ingevolge die Wet op Finansiele Advies- en Tussengangersdienste, 2002 (Wet 37 van 2002), Raadskennisgewing 80 van 2003, en Algemene Kennisgewing 706 van 2020.\n\nStel 'n volledige, professionele Rekord van Advies op wat AL die volgende afdelings dek:\n1. FSP- EN VERTEENWOORDIGERBESONDERHEDE\n2. KLIENTIDENTIFIKASIE, KYC, FICA EN POPIA\n3. BEHOEFTE-ANALISE\n4. MARKVERGELYKING\n5. AANBEVOLE PRODUK\n6. VERGOEDING EN BELANGEBOTSING\n7. VERVANGINGSADVIES\n8. KLIENT AANVAARDINGSREKORD\n\nKRITIEKE TERMINOLOGIE:\n- Gebruik FSP (nie VFD nie) - die afkorting bly FSP in Afrikaans soos in Engels\n- Finansiele Diensverskaffer (FSP) vir die volledige naam\n- Verteenwoordiger Naam (nie Personeelverwysingsnommer nie)\n- Nakoming Beampte (nie Naasmakelaar nie)\n- Beroepsaanspreeklikheidsversekering (nie Beskerminginligting nie)\n- Wet op Finansiele Intelligensiesentrum, 2001 (FICA) - NIE 2020 NIE\n- Wet op Beskerming van Persoonlike Inligting, 2013 (POPIA)\n- Korttermynversekeringswet, 1998 (Wet 53 van 1998)\n- Raadskennisgewing 80 van 2003\n- SASRIA bly SASRIA\n\nAFDELING 1 - FSP- EN VERTEENWOORDIGERBESONDERHEDE\nElke veld op sy eie reel:\nFinansiele Diensverskaffer (FSP): [naam]\nFSP-Registrasienommer: [nommer]\nAdres: [adres]\nVerteenwoordiger Naam: [naam]\nNakoming Beampte: [naam en organisasie]\nBeroepsaanspreeklikheidsversekering: Bevestig van krag\nAdvies Datum: [datum]\n\nAFDELING 2 - KLIENTIDENTIFIKASIE, KYC, FICA EN POPIA\nElke veld op sy eie reel:\nKlient Naam: [naam]\nIdentiteitsnommer: [nommer]\nKontaknommer: [nommer]\nE-posadres: [e-pos]\nResidensiele Adres: [adres]\nIdentiteitsverifikasie: [status]\nAdresbewys: [status]\nPOPIA-Toestemming: [status]\nFICA-Status: [status]\nEisgeskiedenisverklaring: [status]\nFAIS-Openbaarmaking: [status]\n\nAFDELING 3 - BEHOEFTE-ANALISE\nSkryf duidelike paragrawe vir elke batekategorie. Elke voertuig, gebou, inhoud en gespesifiseerde item kry sy eie paragraaf. Gebruik vloeiende professionele Afrikaans.\n\nAFDELING 4 - MARKVERGELYKING\nVir hernuwing: verduidelik waarom geen nuwe markvergelyking vereis word nie.\nVir nuwe polis: vergelyk drie versekeraars met premies, bybetalings en redes vir aanbeveling.\n\nAFDELING 5 - AANBEVOLE PRODUK\nVersekeraar: [naam]\nProdukklassifikasie: [tipe]\nDekkingsbasis: [tipe]\nEffektiewe Datum: [datum]\nLys elke versekerde item apart met versekerde bedrag, bybetaling en dekkingsbesonderhede.\nSluit in: Statutere Uitsluitings, Bybetalingstruktuur, SASRIA-Dekking.\n\nAFDELING 6 - VERGOEDING EN BELANGEBOTSING\n[FSP naam] ontvang kommissie van [persentasie]% van die jaarlikse premie betaalbaar deur [versekeraar].\nGeen addisionele gelde word van die klient gehef nie.\nBelangebotsingsverklaring: [Verteenwoordiger naam] verklaar dat geen wesenlike belangebotsing bestaan nie.\n\nAFDELING 7 - VERVANGINGSADVIES\nVerduidelik duidelik of hierdie advies vervanging van bestaande dekking behels of nie.\n\nAFDELING 8 - KLIENT AANVAARDINGSREKORD\nMetode van Aanvaarding: [metode]\nDatum van Aanvaarding: [datum]\n\nKlient Handtekening: _________________________\nKlient Naam (drukskrif): _________________________\nDatum: _________________________\nAdviseur Handtekening: _________________________\nAdviseur Naam (drukskrif): _________________________\nDatum: _________________________\n\nTAALREELS - UITERS BELANGRIK:\n- Skryf vloeiende professionele Afrikaans soos 'n ervare makelaar\n- MOENIE woordeliks vertaal nie - dink in Afrikaans\n- Korrekte formulering: bestaande dekking blyk steeds toepaslik te wees\n- Korrekte formulering: geen wesenlike verandering in risiko is aangeteken nie\n- ALTYD paragraafbreuke tussen velde en afdelings\n- NOOIT velde saamvoeg op een reel nie\n- Gebruik slegs genommerde opskrifte - geen markdown nie";
 
const AGRI_GUIDANCE_AF = " BYKOMENDE LANDBOU-RISIKO-LEIDING - hierdie toevoer behels 'n boerdery-/landboubedryf. Pas die volgende Suid-Afrikaanse landbouversekering-vakkennis toe: gewasdekking word normaalweg PER LAND gestruktureer via 'n Bewerkingsplan; gewasdekking is tipies 'n GENOEMDE-GEVAAR-struktuur met hael as die basisgevaar; die eksesstruktuur word normaalweg as 'n PERSENTASIE uitgedruk. Standaard gewasuitsluitings: droogte, Herfsleërwurm, gevolgskade, geoeste gewasse. SASRIA-dekking is 'n standaard statutêre insluiting ingevolge die Korttermynversekeringswet, 1998.";
 
const ACCURACY_RULES_EN = " OVERRIDE RULES - THESE TAKE ABSOLUTE PRECEDENCE OVER ALL OTHER INSTRUCTIONS: RULE 1 VEHICLE USE: You MUST use the exact value from the Primary Use field in the input. If the input says Primary use: Private then Section 3 heading MUST be Motor Vehicle Insurance - Private Use and the body MUST describe private use only. Self-employed status or occupation NEVER changes this. RULE 2 VEHICLE REGISTRATION: The registration number provided in the input MUST appear verbatim in Section 5 under the vehicle details. Never write As declared by client if a registration number was given. RULE 3 GENDER: Derive title from SA ID digits 7-10. 0000-4999 equals female use Ms. 5000-9999 equals male use Mr. Never guess from name. RULE 4 COMMUNICATION: List every communication method stated. Do not reduce multiple methods to one. RULE 5 NO FABRICATION: Every fact in the RoA must come from the broker input. If it is not in the input it does not go in the RoA. RULE 6 DEFAULT USE: If no Primary Use field appears in the input, default to Personal Lines. Never infer commercial use from occupation, fleet size, or schedule data. RULE 7 NO GOODS IN TRANSIT: Never write goods in transit or GIT cover into the RoA unless the broker explicitly stated it. RULE 8 NO FABRICATED POLICY CONDITIONS: Never invent excess amounts, claims timeframes, advice validity periods, or policy conditions not stated in the input.";
 
const ACCURACY_RULES_AF = " OORHEERSENDE REELS - HIERDIE NEEM ABSOLUTE VOORKEUR BO ALLE ANDER INSTRUKSIES: REEL 1 VOERTUIGGEBRUIK: Gebruik die PRESIESE waarde van die Primere Gebruik-veld in die invoer. As die invoer se Primere gebruik: Privaat dan MOET Afdeling 3 se opskrif wees Motorvoertuigversekering - Privaat Gebruik en die inhoud MOET privaat gebruik beskryf. Selfstandige status of beroep verander dit NOOIT. REEL 2 REGISTRASIENOMMER: Die registrasienommer in die invoer MOET woordeliks in Afdeling 5 verskyn. Skryf nooit Soos verklaard deur klient as n registrasienommer verskaf is nie. REEL 3 GESLAG: Lei titel af uit SA ID syfers 7-10. 0000-4999 is vroulik gebruik Mev. 5000-9999 is manlik gebruik Mnr. Moenie uit naam raai nie. REEL 4 KOMMUNIKASIE: Lys elke kommunikasiemetode wat vermeld word. Moenie verskeie metodes tot een verminder nie. REEL 5 GEEN FABRIKASIE: Elke feit in die RvA moet uit die makelaar se invoer kom. As dit nie in die invoer is nie gaan dit nie in die RvA nie. REEL 6 VERSTEK GEBRUIK: As geen Primere Gebruik-veld in die invoer verskyn nie, gebruik Persoonlike Lyne as verstek. Moenie kommersiële gebruik aflei uit die beroep, vlootgrootte, of skedulêre data nie. REEL 7 GEEN GOEDEREVERVOER: Skryf NOOIT goederevervoerdekking of GIT-dekking in die RvA tensy die makelaar dit uitdruklik vermeld het. REEL 8 MARKVERGLYKING IN AFRIKAANS: Alle afdelings insluitend die markvergelyking moet in Afrikaans geskryf word.";
const SYSTEM_EXTRACT = "You are a South African FAIS insurance compliance assistant. Extract all available insurance and client details from the provided text. Return ONLY valid raw JSON - no preamble, no markdown, no backticks - with these exact keys: brokerName, fspNumber, advisorName, fspAddress, complianceOfficer, clientCommsMethod, clientName, clientContact, clientReg, clientEmail, clientAddress, businessNature, businessTurnover, fleetSize, fleetValue, fleetTypes, fleetTracking, gitRequired, gitLimit, gitGoods, insuranceClass, insurer, premium, sumInsured, coverBasis, exclusions, excessStructure, commission, cmp1Insurer, cmp1Premium, cmp1Excess, cmp1NotRec, cmpRecInsurer, cmpRecPremium, cmpRecExcess, cmpRecReason, cmp3Insurer, cmp3Premium, cmp3Excess, cmp3NotRec, replacement, replacementDetails, replacementReason, additionalFacts, conflictOfInterest, claimsNotes, triggerEvent, businessEmployees, publicLiabilityLimit, businessInterruptionRequired, vehicles, buildOwns, buildValue, buildSecurity, contentsSumInsured, scheduledItems, renewalPolicyNumber, renewalCurrentInsurer, renewalCurrentPremium, renewalNewPremium, renewalSumChanges, renewalRiskChange, renewalRemarketed, amendmentPolicyNumber, amendmentType, amendmentDescription, telephoneAdvice, telephoneFollowup, telephoneConfirmation, kycId, kycAddress, popiaConsent, claimsHistory, claimsNotes, faisDisclosure, existingCover, coverGaps. Use empty string for any field not found. For vehicles: extract as a JSON array of objects, each with keys: year, make, model, regNo, retailValue, primaryUse, driverAge, tracking, financed, overnightParking. Extract ALL vehicles mentioned. For buildOwns: use Yes-freehold if client owns home freehold, Yes-sectional-title if sectional title, No-renting if renting. For buildValue: extract the replacement/rebuild value as a number string. For buildSecurity: extract any security measures mentioned. For contentsSumInsured: extract contents sum insured as a number string. For advisorName: extract the name of the advising broker or representative from the input text. If no adviser name is mentioned in the input, leave this field as empty string — never use the word Riya as an adviser name. For clientReg: extract the client's South African ID number (13 digits) or company registration number (CIPC format) as a plain string with no spaces or formatting. ALWAYS extract a 13-digit number as an ID number and map it to clientReg. For clientContact: extract ONLY the phone/cell number as digits and spaces e.g. 071 882 3345 — never extract a person name into this field. For insuranceClass: if the client is a business, company, or contractor, ALWAYS start with Commercial-Lines e.g. Commercial-Lines-Motor-Plant-Equipment. If personal consumer, start with Personal-Lines. For triggerEvent: MUST be exactly one of these four values only: new, renewal, amendment, telephone. Use new if this is a new policy or new business. Use renewal if an existing policy is being renewed. Use amendment if cover is being changed. Use telephone if this is a telephone advice record. Default to new if unclear. For businessEmployees: extract number of permanent employees as a string. For publicLiabilityLimit: extract the public liability limit required as a string e.g. R10,000,000. For businessInterruptionRequired: set to Yes if business interruption cover is mentioned or required, otherwise No. For scheduledItems: extract as a semicolon-separated string of scheduled/all-risk items with values e.g. Rolex Submariner R65000; Laptop R28000. Include ALL valuable items mentioned with their values. For vehicles array: for each vehicle, set financed to YES if the text mentions finance, bond, WesBank, Absa, Nedbank, FNB, or any bank in relation to that vehicle, otherwise NO. Set overnightParking from any parking description. For clientCommsMethod: extract how the broker met or communicated with the client e.g. Home visit, Office meeting, Telephone, Email. For insuranceClass: extract the full insurance class e.g. Personal Lines - Motor, Household Contents, Buildings. For sumInsured: extract the total sum insured across all assets as a descriptive string e.g. Motor R680000 and R165000, Contents R380000, Buildings R2100000. CRITICAL RULE FOR replacement FIELD: only set replacement to YES if the text explicitly describes an existing policy being replaced, switched, or cancelled in favour of a new one (for example explicit phrases like existing policy with, currently insured with, switching from, replacing cover with). If the text describes a New Policy or does not mention any existing cover at all, replacement MUST be NO. Do not infer or assume a replacement scenario - default to NO whenever uncertain. CRITICAL RULE FOR cmpRecInsurer: this field must contain the insurer the broker explicitly marked or described as recommended, accepted, or chosen - never the insurer described as not recommended, rejected, or having reputation concerns, even if it is mentioned first or most prominently in the text. For renewalPolicyNumber: extract the existing policy number being renewed. For renewalCurrentInsurer: extract the name of the current insurer for the policy being renewed. For renewalCurrentPremium: extract the current/expiring annual premium as a number string. For renewalNewPremium: extract the renewal premium being offered as a number string. For renewalSumChanges: extract a description of any changes to sums insured since the last renewal, or state that nothing has changed if the text explicitly says so. For renewalRiskChange: this field must be set to EXACTLY one of these two strings only - No material change OR Yes — details below. DEFAULT to No material change unless the text EXPLICITLY and CLEARLY describes a specific change to the client's risk profile, such as a new address, new vehicle, new driver, or new valuables. Simply reviewing sums insured or renewing without any described change is NOT a risk profile change - if in doubt, use No material change. For renewalRemarketed: this field must be set to EXACTLY one of these two strings only - Yes — comparison below OR No — renewal competitive. Use the Yes option only if the broker obtained comparative quotes from other insurers this renewal; otherwise use the No option. For amendmentPolicyNumber: extract the existing policy number being amended. For amendmentType: extract a short description of the type of amendment, for example Adding a vehicle, Removing a vehicle, Sum insured change, or Address change. For amendmentDescription: extract a full description of the amendment including the reason for the change. For telephoneAdvice: extract a full description of the client's question or enquiry and the specific advice given by the broker on the call - this must be substantive, not a one-line summary. For telephoneFollowup: extract the follow-up action required, including any outstanding items and timelines mentioned. For telephoneConfirmation: set to \"Yes - email sent\" if an email confirmation was sent to the client, \"Yes - WhatsApp sent\" if confirmed via WhatsApp, or \"No follow-up required\" if no confirmation was mentioned as sent. For gitRequired: set to Yes if goods in transit cover is mentioned as required, a per-conveyance limit is stated, or type of goods carried is described - otherwise No. For kycId: this field must be set to EXACTLY one of these three strings only - Yes — certified copy on file OR Yes — eKYC verified OR Pending. DEFAULT to Pending unless the text EXPLICITLY states ID or CIPC registration was verified or a certified copy was obtained - do not infer verification just because KYC is mentioned generally. For kycAddress: this field must be set to EXACTLY one of these three strings only - Yes — on file, not older than 3 months OR Pending OR Not required (commercial). DEFAULT to Pending unless the text EXPLICITLY states proof of address was obtained or is on file. For popiaConsent: this field must be set to EXACTLY one of these three strings only - Yes — signed consent on file OR Yes — digital consent captured OR Pending. DEFAULT to Pending unless the text EXPLICITLY states POPIA consent was signed or captured. For claimsHistory: this field must be set to EXACTLY one of these three strings only - Yes — declared, no material claims OR Yes — claims declared (see below) OR Not yet declared. Use the no material claims option only if the text explicitly states no claims to declare; use the claims declared option only if specific claims are described; otherwise DEFAULT to Not yet declared. For claimsNotes: extract details of any specific claims declared by the client, or leave empty if none mentioned. For faisDisclosure: this field must be set to EXACTLY one of these two strings only - Yes — provided and acknowledged OR Pending. DEFAULT to Pending unless the text EXPLICITLY states the FAIS disclosure document was provided and/or acknowledged. For existingCover: extract a description of the client's existing policies, insurers, and policy numbers currently in place if mentioned, or leave empty if not mentioned. For coverGaps: extract any identified gaps or duplications in current cover mentioned in the text, or leave empty if not mentioned. IMPORTANT - MULTIPLE DOCUMENTS: the input text may contain several documents concatenated together, each preceded by a '--- FROM: filename ---' marker. You MUST read and extract relevant details from EVERY document present, not only the first or the last one. Merge details found across all documents into the single JSON output - for example, a vehicle mentioned only in one document and a policy premium mentioned only in another must both appear in the final result.";
 
const SYSTEM_SUFFICIENCY = "You are a South African FAIS insurance compliance assistant checking whether a broker input contains enough information to produce a defensible Record of Advice. You will be given the broker raw input text, the Trigger Event, and the Lines of Business. Return ONLY a valid raw JSON array of short strings, no preamble, no markdown, no backticks. Each string describes ONE specific missing piece of essential information. If everything essential is present, return exactly []. NEW POLICY needs client identity, one concrete asset with detail, one insurer and premium. Flag but do not invent: a market comparison if only one insurer is mentioned; KYC confirmations if not stated; for Commercial, turnover and Gross Profit if Business Interruption is mentioned with no financials; liability limits if a liability type is mentioned with no limit. PERSONAL LINES RULES — do NOT flag any of the following as missing: income, occupation, employment status, or dependents (not required for standard personal lines RoA); premium breakdown per cover section (a single all-in premium is acceptable); confirmation that sum insured amounts are agreed vs estimated when specific rand values are clearly stated in the notes; general needs analysis documentation when assets and cover requirements are clearly described. For personal lines, limit flags to genuine FAIS gaps only: missing KYC if not mentioned, missing market comparison if only one insurer quoted on new business, missing replacement advice confirmation if switching insurers, missing excess structure if no excess mentioned at all. RENEWAL needs an existing policy reference and a premium figure. CRITICAL: only expect a market comparison if the input explicitly says the client was re-marketed to other insurers. If the input only describes the existing insurer renewal with no competing quotes, do NOT flag the absence of a market comparison, this is correct expected behaviour. Flag what has changed since last period if nothing is mentioned. AMENDMENT needs an existing policy reference and a description of the change. Never flag missing market comparison for an amendment. If the change involves moving to a different insurer, flag this as possibly a Policy Replacement needing fuller documentation. TELEPHONE ADVICE needs a date and a description of what was discussed and advised. Do not flag missing needs analysis or market comparison unless the call covered that ground, these records are expected to be short. If Renewal has no policy reference at all, do not refuse, still generate with the gap flagged prominently.";
 
const SYSTEM_ROA_AUDIT = "You are Riya, a South African FAIS compliance auditor. You will be given a Record of Advice document that a broker has ALREADY WRITTEN THEMSELVES. Your job is ONLY to review it for FAIS Act 37 of 2002, Board Notice 80 of 2003, and General Notice 706 of 2020 compliance gaps. You do NOT rewrite, redraft, or generate a new RoA. You do NOT invent facts, insurer names, or figures that are not in the document. STEP 1 - DETECT THE TRIGGER EVENT: read the document and determine which ONE of these four trigger events it represents: New Policy, Renewal, Amendment, or Telephone Advice. Base this on explicit content - e.g. an existing policy number and prior premium being renewed means Renewal; a described change to existing cover means Amendment; a phone consultation record with no new placement means Telephone Advice; otherwise New Policy. STEP 2 - CHECK AGAINST THE REQUIREMENTS FOR THAT SPECIFIC TRIGGER, not a generic one-size-fits-all checklist: NEW POLICY requires all of: FSP/representative details with PI insurance confirmation; client identification and KYC/FICA/POPIA; a genuine needs analysis; a market comparison across insurers (or an explicit reason none was needed); full Section 9(1) product detail; remuneration and conflict of interest declaration; replacement advice section if switching from an existing insurer; client acceptance record with signature. RENEWAL requires: the existing policy reference and current premium; what has changed since last period (or confirmation nothing changed); a market comparison ONLY IF the document says the client was re-marketed to other insurers - do NOT flag a missing market comparison for a straightforward renewal with no re-marketing mentioned; remuneration/conflict of interest; client acceptance record. AMENDMENT requires: the existing policy reference; a clear description of the change and the reason for it; remuneration/conflict of interest if commission is affected; client acceptance record. Do NOT flag a missing market comparison for an amendment. If the amendment involves moving to a different insurer, flag this as needing full Replacement Advice treatment. TELEPHONE ADVICE requires: the date and a substantive description of what was discussed and advised; any follow-up action noted; client acceptance/confirmation record (this can be an email or verbal confirmation noted, not necessarily a signature). Do NOT flag missing needs analysis or market comparison for Telephone Advice unless the call itself covered that ground - these records are expected to be short. Return ONLY a valid raw JSON object, no preamble, no markdown, no backticks, with this exact structure: {\"detectedTrigger\": \"one of: New Policy, Renewal, Amendment, Telephone Advice\", \"overallAssessment\": \"one short sentence summarizing compliance posture\", \"sectionsFound\": [\"array of section names/topics the document DOES appear to cover\"], \"gaps\": [\"array of specific missing or unclear compliance elements relevant to the detected trigger type, each phrased factually starting with the section it relates to, e.g. FSP Details: Professional Indemnity Insurance confirmation not stated\"], \"riskFlags\": [\"array of higher-severity issues - a MATERIAL compliance risk such as no conflict of interest declaration at all, no client signature/acceptance record, no commission/remuneration disclosure, or a replacement scenario described with no formal replacement advice section\"]}. Be precise and evidence-based - only flag something as a gap if it is genuinely absent or unclear from the text provided, and only if it is actually required for the detected trigger type. Never assume something is missing just because it is phrased briefly. If the document is thorough and compliant for its trigger type, gaps and riskFlags should be short or empty arrays, not padded to seem more useful than they are.";
const SYSTEM_COC = "You are a South African short-term insurance assistant. Produce a professional CONFIRMATION OF INSURANCE COVER letter suitable for submission to a bank, financier, or dealer. This is NOT a Record of Advice — do not produce RoA sections, needs analysis, market comparison, remuneration declarations, or client acceptance records. Structure the letter EXACTLY as follows:\n1. Broker letterhead block: broker name, FSP number, date\n2. Recipient block: Attention line and email if provided\n3. Centred heading: CONFIRMATION OF INSURANCE COVER\n4. Opening paragraph: confirm the insured is covered under the policy named below\n5. Policy details block: Insurer, Policy Number, Inception Date, Renewal Date, Cover Type, Lines of Business\n6. Financier clause: state the interest of [financier] is noted as first payee (only if financier provided)\n7. Items insured: list each vehicle/asset with Year Make Model, Registration, VIN, Engine Number, Sum Insured, Financier per item\n8. SASRIA note: include only if SASRIA is confirmed included\n9. Closing paragraph: letter is valid subject to policy terms and conditions and payment of premiums\n10. Signature block: representative name, title, broker name, FSP number\nDo not add any section not listed above. Do not add needs analysis, market comparison, remuneration, or compliance sections. Write in formal English. Keep it concise and professional.";

const SYSTEM_ROA_AUDIT_REWRITE = "You are Riya, a South African FAIS compliance assistant. A broker has provided the TRIGGER EVENT of an existing RoA (New Policy, Renewal, Amendment, or Telephone Advice), the RoA they originally wrote themselves, and corrections or additional information addressing specific compliance gaps that were identified in that original document. Produce a complete, corrected, FAIS-compliant Record of Advice using numbered section headings appropriate to the TRIGGER EVENT: for New Policy use all of 1. FSP and Representative Details 2. Client Identification and KYC/FICA/POPIA confirmation 3. Needs Analysis 4. Market Comparison 5. Product Recommended (full Section 9(1) detail) 6. Remuneration and Conflict of Interest 7. Replacement Advice 8. Client Acceptance Record. For Renewal, keep the same 8 sections but section 4 (Market Comparison) should state 'Not applicable - renewal with no re-marketing conducted' unless the original document or corrections describe genuine re-marketing to other insurers - do not invent a market comparison. For Amendment, keep the same 8 sections but section 3 (Needs Analysis) and section 4 (Market Comparison) should be brief, focused only on the specific change being made, with Market Comparison stating not applicable unless the amendment involves switching insurers. For Telephone Advice, keep the same 8 sections but sections 3 and 4 should be brief and focused only on what was actually discussed on the call, not a full fresh needs analysis or market comparison unless the call itself covered that ground. CRITICAL RULES: Preserve every genuine fact, figure, insurer name, and client detail already present in the ORIGINAL document exactly as given - do not alter correct information. Incorporate the broker's CORRECTIONS into the appropriate section(s) to address the gaps they were provided for. Do NOT invent, assume, or fabricate any fact, name, or figure that appears in neither the original document nor the corrections. If a previously-flagged gap was NOT addressed in the corrections provided, do not fabricate content for it - instead write a clear, honest placeholder such as 'Pending - not yet confirmed by broker' in that section, so the gap remains visibly outstanding rather than silently disappearing. Write in professional English suitable for FSCA inspection. Do NOT use markdown tables, do NOT insert '---' separator lines or '##' markdown characters anywhere in the output. End Section 8 with a signature block containing exactly these lines: 'Client Signature: _________________________', 'Client Name (print): _________________________', 'Date: _________________________', a blank line, then 'Adviser Signature: _________________________', 'Adviser Name (print): _________________________', 'Date: _________________________' - unless the original document already shows a genuine completed signature/acceptance record, in which case preserve that instead of adding blank lines.";
 
 
function callClaude(apiKey, system, user, maxTokens) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens || 1500,
      system: system,
      messages: [{ role: 'user', content: user }]
    });
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode !== 200) reject(new Error('Status ' + res.statusCode + ': ' + (parsed.error && parsed.error.message || 'API error')));
          else resolve(parsed.content && parsed.content.map(b => b.text || '').join('') || '');
        } catch(e) { reject(new Error('Parse error: ' + e.message)); }
      });
    });
    req.on('error', e => reject(new Error('Network: ' + e.message)));
    req.write(payload);
    req.end();
  });
}
 
function supabaseRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'sunihvgxtqbjjuvnrpof.supabase.co',
      path: '/rest/v1/' + path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
        'Prefer': 'return=representation'
      }
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('SUPABASE RESPONSE [' + path + ']: status=' + res.statusCode + ' body=' + data);
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve([]); }
      });
    });
    req.on('error', e => reject(e));
    if (payload) req.write(payload);
    req.end();
  });
}
 
async function validateBrokerToken(token) {
  const result = await supabaseRequest('GET', 'brokers?token=eq.' + encodeURIComponent(token) + '&select=*');
  if (!result || !result.length) return null;
  return result[0];
}
 
async function deductCredit(token, roaType, broker, creditCost, internalTest) {
  const cost = creditCost || 1;
  if (!internalTest) {
    await supabaseRequest('PATCH', 'brokers?token=eq.' + encodeURIComponent(token), {
      credits: broker.credits - cost,
      credits_used: broker.credits_used + cost,
      last_used: new Date().toISOString()
    });
  }
  await supabaseRequest('POST', 'usage_log', {
    token: token,
    broker_name: broker.name,
    roa_type: roaType || 'unknown',
    source: internalTest ? 'internal_test' : 'broker'
  });
}
 
app.post('/generate-roa', async (req, res) => {
  const { user, mode, token } = req.body;
  const internalTest = !!req.body.internalTest;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const masterToken = process.env.RIYA_ACCESS_TOKEN;
 
  if (!token) return res.status(401).json({ error: 'No token provided.' });
 
  let broker = null;
  let roaType = 'personal';
  let creditCost = 2;
  if (mode === 'audit') {
    creditCost = 1;
  } else if (mode === 'coc') {
    creditCost = 2;
  } else if (mode === 'audit_rewrite') {
    const combinedAuditText = (req.body.originalRoA || user || '') + (req.body.corrections || '');
    roaType = combinedAuditText.includes('Commercial') ? 'commercial' : 'personal';
    creditCost = roaType === 'commercial' ? 3 : 2;
  } else if (mode !== 'extract' && mode !== 'sufficiency' && user) {
    roaType = user.includes('Commercial Lines') ? 'commercial' : 'personal';
    creditCost = roaType === 'commercial' ? 3 : 2;
  }
  if (token !== masterToken) {
    broker = await validateBrokerToken(token);
    if (!broker) return res.status(401).json({ error: 'Invalid token.' });
    if (broker.status !== 'active') return res.status(403).json({ error: 'Account suspended. Contact support.' });
    if (!internalTest && broker.credits <= 0) return res.status(403).json({ error: 'No credits remaining. Please top up to continue.' });
    if (!internalTest && mode !== 'extract' && mode !== 'sufficiency' && broker.credits < creditCost) {
      return res.status(403).json({ error: 'Insufficient credits (' + creditCost + ' credits required, ' + broker.credits + ' remaining). Please top up to continue.' });
    }
 
  }
 
  if (!apiKey) return res.status(500).json({ error: 'Server configuration error.' });
 
  try {
    if (mode === 'extract') {
      const fileMarkerCount = (user.match(/--- FROM: /g) || []).length;
      const inputCharCount = user.length;
      const result = await callClaude(apiKey, SYSTEM_EXTRACT, user, 4000);
      let parsedOk = false;
      let nonEmptyFieldCount = 0;
      let totalFieldCount = 0;
      try {
        const clean = result.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        parsedOk = true;
        totalFieldCount = Object.keys(parsed).length;
        nonEmptyFieldCount = Object.values(parsed).filter(v => {
          if (Array.isArray(v)) return v.length > 0;
          return v !== '' && v !== null && v !== undefined;
        }).length;
      } catch (e) {
        parsedOk = false;
      }
      console.log('EXTRACT metrics: token=' + (token || 'unknown') + ' documentsDetected=' + (fileMarkerCount || 1) + ' inputChars=' + inputCharCount + ' jsonParsedOk=' + parsedOk + ' fieldsPopulated=' + nonEmptyFieldCount + '/' + totalFieldCount);
      return res.json({ content: [{ type: 'text', text: result }] });
    }
 
    if (mode === 'sufficiency') {
      const triggerEvent = req.body.triggerEvent;
      const linesOfBusiness = req.body.linesOfBusiness;
      const sufficiencyPrompt = 'Trigger Event: ' + (triggerEvent || 'New Policy') + '\nLines of Business: ' + (linesOfBusiness || 'Personal') + '\n\nBroker input:\n' + user;
      const result2 = await callClaude(apiKey, SYSTEM_SUFFICIENCY, sufficiencyPrompt, 1000);
      const cleaned2 = result2.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
      let gaps = [];
      try { gaps = JSON.parse(cleaned2); if (!Array.isArray(gaps)) gaps = []; } catch(e) { gaps = []; }
      console.log('SUFFICIENCY metrics: token=' + (token || 'unknown') + ' trigger=' + (triggerEvent || 'unknown') + ' lines=' + (linesOfBusiness || 'unknown') + ' gapCount=' + gaps.length);
      return res.json({ gaps: gaps });
    }
 
    if (mode === 'coc') {
      const cocResult = await callClaude(apiKey, SYSTEM_COC, user, 2000);
      if (broker) {
        await deductCredit(token, 'personal', broker, 2, internalTest);
      }
      console.log('COC metrics: token=' + (token || 'unknown') + ' outputLength=' + cocResult.length);
      return res.json({ content: [{ type: 'text', text: cocResult }] });
    }
 
    if (mode === 'audit') {
      const auditResult = await callClaude(apiKey, SYSTEM_ROA_AUDIT, 'BROKER-WRITTEN RoA TO REVIEW:\n\n' + user, 1500);
      const cleanedAudit = auditResult.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
      let auditData = { detectedTrigger: 'New Policy', overallAssessment: '', sectionsFound: [], gaps: [], riskFlags: [] };
      try {
        const parsed = JSON.parse(cleanedAudit);
        auditData = {
          detectedTrigger: parsed.detectedTrigger || 'New Policy',
          overallAssessment: parsed.overallAssessment || '',
          sectionsFound: Array.isArray(parsed.sectionsFound) ? parsed.sectionsFound : [],
          gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
          riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : []
        };
      } catch(e) { /* keep defaults on parse failure */ }
      console.log('AUDIT metrics: token=' + (token || 'unknown') + ' trigger=' + auditData.detectedTrigger + ' gapCount=' + auditData.gaps.length + ' riskFlagCount=' + auditData.riskFlags.length);
      if (broker) {
        await deductCredit(token, 'audit', broker, 1, internalTest);
      }
      return res.json(auditData);
    }
 
    if (mode === 'audit_rewrite') {
      const originalRoA = req.body.originalRoA || user;
      const corrections = req.body.corrections || '';
      const detectedTrigger = req.body.detectedTrigger || 'New Policy';
      const rewriteInput = 'TRIGGER EVENT: ' + detectedTrigger + '\n\nORIGINAL BROKER-WRITTEN RoA:\n\n' + originalRoA + '\n\n--- BROKER CORRECTIONS / ADDITIONAL INFORMATION FOR FLAGGED GAPS ---\n\n' + (corrections || '(No corrections provided - preserve original content and mark unaddressed gaps as pending)');
      let rewritten = '';
      try { rewritten = await callClaude(apiKey, SYSTEM_ROA_AUDIT_REWRITE, rewriteInput, 4000); } catch(e) { rewritten = 'Error: ' + e.message; }
      rewritten = forceHeadingLinebreaks(rewritten);
 
      if (broker) {
        await deductCredit(token, roaType, broker, creditCost, internalTest);
      }
      console.log('AUDIT_REWRITE metrics: token=' + (token || 'unknown') + ' type=' + roaType + ' outputLength=' + rewritten.length);
      return res.json({ content: [{ type: 'text', text: rewritten }] });
    }
 
    // Pre-inject registration number if found in input
    const regMatch = user.match(/[Rr]egistration[:\s]+([A-Z]{2,3}\s*[\d-]+)/i);
    const regNote = regMatch ? '\n\nNOTE - VEHICLE REGISTRATION: The registration number is ' + regMatch[1].trim() + ' - this MUST appear verbatim in Section 5 vehicle details.' : '';
    const user1 = user + regNote + '\n\nGenerate ONLY sections 1 and 2. Stop after section 2. IMPORTANT: In Section 1, the Communication Method field must list ALL methods stated in the input - if both face-to-face and email are mentioned, list both. Be concise - bullet points only.\n1. FSP and Representative Details\n2. Client Identification, KYC, FICA and POPIA. Do not write anything beyond section 2 - end your response immediately after completing it, with no additional text or commentary. DO NOT include any --- separator lines or ## markdown.';
    let part1 = '';
const lang = req.body.language || 'en';
    const activeSystemRoa = buildSystemRoa(user, lang);
    try { part1 = await callClaude(apiKey, activeSystemRoa, user1, 2000); } catch(e) { part1 = 'Error: ' + e.message; }
    part1 = forceHeadingLinebreaks(part1);
    part1 = trimToSection(part1, 1);
 
    const user2 = user + '\n\n--- PRIOR SECTIONS (1 AND 2), READ SILENTLY FOR CONTEXT - DO NOT OUTPUT, REPEAT, REPRODUCE, SUMMARISE OR REFERENCE THIS BLOCK IN ANY WAY ---\n' + part1 + '\n--- END OF PRIOR SECTIONS ---\n\nYour response must begin DIRECTLY with the heading for section 3. Do not include any title, heading, restatement, or summary of sections 1 or 2 anywhere in your response. Generate ONLY sections 3 and 4. Do not generate any other sections. Be consistent with the FSP, client and trigger details already established above. Be concise - bullet points only.\n3. Needs Analysis - one short paragraph per asset class relevant to what changed or is being discussed (motor, buildings, contents, all-risk, liability). For Amendment or Telephone Advice triggers, keep this brief and focused only on the specific change or query, not a full fresh needs analysis.\n4. Market Comparison - CRITICAL RULE: only produce a genuine multi-insurer comparison if the input explicitly contains real quotes or premiums from more than one insurer. If this is an Amendment, Telephone Advice, or a Renewal with no re-marketing mentioned, and no genuine multi-insurer data is present in the input, write exactly: Market Comparison - Not applicable - this is a [trigger type] and no new market comparison was required or conducted. Do NOT invent insurer names, premiums, or a comparison that was not actually provided. Do not write anything beyond section 4 - end your response immediately after completing it, with no additional text or commentary. DO NOT include any --- separator lines or ## markdown.';
    let part2 = '';
    try { part2 = await callClaude(apiKey, activeSystemRoa, user2, 2500); } catch(e) { part2 = 'Error: ' + e.message; }
    part2 = forceHeadingLinebreaks(part2);
    part2 = trimToSection(part2, 3);
 
    const user3 = user + '\n\n--- PRIOR SECTIONS (3 AND 4), READ SILENTLY FOR CONTEXT - DO NOT OUTPUT, REPEAT, REPRODUCE, SUMMARISE OR REFERENCE THIS BLOCK IN ANY WAY ---\n' + part2 + '\n--- END OF PRIOR SECTIONS ---\n\nYour response must begin DIRECTLY with the heading for section 5. Do not include any title, heading, restatement, or summary of sections 1, 2, 3 or 4 anywhere in your response, and do not write a new document title such as "Record of Advice" again. Generate ONLY sections 5 to 8. CRITICAL: Section 5 (Product Recommended) MUST recommend the EXACT SAME insurer that was identified as recommended in the Market Comparison section above - do not introduce a different insurer or different premium figures. Be concise - bullet points only.\n5. Product Recommended - CRITICAL: if a vehicle registration number was provided in the input you MUST include it explicitly in the vehicle details. Sum insured schedule, exclusions, excess structure, SASRIA. NEVER invent policy conditions, claims timeframes, inspection requirements, key safeguarding rules, or advice validity periods that were not stated in the broker input\n6. Remuneration and Conflict of Interest\n7. Replacement Advice\n8. Client Acceptance Record - end this section with a signature block containing exactly these lines on their own: "Client Signature: _________________________", "Client Name (print): _________________________", "Date: _________________________", then a blank line, then "Adviser Signature: _________________________", "Adviser Name (print): _________________________", "Date: _________________________". End with the Riya footer. CRITICAL: In Section 1 Representative Details, use the adviser name from the Representative Name field. Never use the name Riya as the representative name. Riya is the system, not the adviser. DO NOT include any --- separator lines or ## markdown anywhere in sections 5-8.';
 
    let part3 = '';
    try { part3 = await callClaude(apiKey, activeSystemRoa, user3, 4000); } catch(e) { part3 = 'Error: ' + e.message; }
    part3 = forceHeadingLinebreaks(part3);
    part3 = trimToSection(part3, 5);
 
    // COMBINE WITHOUT SEPARATOR LINES
    let combined = (part1 + '\n\n' + part2 + '\n\n' + part3).trim();
    combined = combined.replace(/OU[\r\n\s]*T[\r\n\s]*surance/g, 'OUTsurance');
    combined = combined.replace(/OU[\r\n\s]*T[\r\n\s]*bonus/g, 'OUTbonus');
 
    // Defensive fallback: guarantee a client + adviser signature block always exists
    const finalCombined = combined.includes('Client Signature:')
      ? combined
      : combined + '\n\nClient Signature: _________________________\nClient Name (print): _________________________\nDate: _________________________\n\nAdviser Signature: _________________________\nAdviser Name (print): _________________________\nDate: _________________________';
 
    let warnings = [];
    try {
      const verifyPrompt = 'BROKER INPUT:\n' + user + '\n\nGENERATED DOCUMENT:\n' + combined + '\n\nList ONLY specific facts in the GENERATED DOCUMENT that do NOT appear anywhere in the BROKER INPUT above. Check CAREFULLY for: any insurer, company, or institution name mentioned in the document that does NOT appear in the broker input at all - this is the most serious issue, flag the entire fabricated company by name; invented insurer ratings, complaint counts, claims timeframes; specific sums insured not stated by the broker; fabricated conflict-of-interest scenarios; any invented dates, numbers, or names. Return ONLY a JSON array of short strings, each phrased as Not confirmed in your input - followed by the specific detail - rather than using the word invented or fabricated. If nothing is unconfirmed, return exactly: []';
      const verifyResult = await callClaude(apiKey, 'You are a strict fact-checker. Output ONLY a raw JSON array, nothing else.', verifyPrompt, 800);
      const cleaned = verifyResult.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
      warnings = JSON.parse(cleaned);
      if (!Array.isArray(warnings)) warnings = [];
    } catch(e) { warnings = []; }
 
    if (broker) {
      await deductCredit(token, roaType, broker, creditCost, internalTest);
    }
 
    return res.json({ content: [{ type: 'text', text: finalCombined }], warnings: warnings });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
});
 
app.post('/transcribe-voice', multerUpload.single('audio'), async (req, res) => {
  const token = req.body && req.body.token;
  const masterToken = process.env.RIYA_ACCESS_TOKEN;
 
  if (!token) return res.status(401).json({ error: 'No token provided.' });
  if (!req.file) return res.status(400).json({ error: 'No audio file received.' });
 
  if (token !== masterToken) {
    const broker = await validateBrokerToken(token);
    if (!broker) return res.status(401).json({ error: 'Invalid token.' });
    if (broker.status !== 'active') return res.status(403).json({ error: 'Account suspended. Contact support.' });
  }
 
  const allowedExt = ['.m4a', '.mp3', '.wav', '.ogg', '.mp4', '.webm'];
  const ext = '.' + (req.file.originalname.split('.').pop() || '').toLowerCase();
  if (!allowedExt.includes(ext)) {
    return res.status(400).json({ error: 'Unsupported audio format. Please upload .m4a, .mp3, .wav, or .ogg.' });
  }
 
  try {
    const languageCode = req.body && req.body.language ? req.body.language : null;
    const transcript = await transcribeWithElevenLabs(req.file.buffer, req.file.originalname, req.file.mimetype, languageCode);
 
    if (!transcript || !transcript.trim()) {
      return res.status(422).json({ error: 'No speech detected in the audio file. Please check the recording and try again.' });
    }
 
    return res.json({ transcript: transcript });
 
  } catch (e) {
    console.error('Transcription error:', e.message);
    if (e.message.indexOf('ElevenLabs error') > -1) {
      return res.status(502).json({ error: 'Transcription service is currently unavailable. Please try again shortly, or paste your notes as text instead.' });
    }
    return res.status(500).json({ error: 'Transcription failed. Please try again.' });
  }
});
 
app.post('/generate-pdf', async (req, res) => {
  const { text, clientName, fspName, triggerLabel, adviceDate, brokerToken } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });
 
  try {
    const NAVY = '#1F3B6E';
    const GOLD = '#D4A574';
 
    const doc = new PDFDocument({ margin: 45, size: 'A4' });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="RoA.pdf"');
      res.send(pdfBuffer);
    });
 
    const pageWidth = doc.page.width;
    const marginLeft = 45;
    const marginRight = 45;
    const contentWidth = pageWidth - marginLeft - marginRight;
 
    // ===== HEADER =====
    doc.rect(0, 0, pageWidth, 90).fill(NAVY);
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#FFFFFF').text('RECORD OF ADVICE', 0, 18, { align: 'center' });
    doc.fontSize(10).font('Helvetica').fillColor(GOLD).text(
      'FAIS & GCoC Compliant  |  ' + (adviceDate || new Date().toLocaleDateString('en-ZA')),
      0, 48, { align: 'center' }
    );
 
    // ===== LOGO (restored broker logo mapping) =====
    let hasLogo = false;
    try {
      const logoMap = {
        'RIYA-GOMES-001': { file: 'kensten-logo.png', width: 90, height: 45 },
        'RIYA-MARX-001': { file: '1st-insurance-logo.png', width: 100, height: 40 },
        'RIYA-CRAFFORD-0001': { file: 'twk-logo.png', width: 60, height: 60 },
        'RIYA-GROBLER-001': { file: 'galinco-logo.png', width: 110, height: 38 },
        'RIYA-TWK-001': { file: 'twk-logo.png', width: 60, height: 60 },
        'RIYA-APBCO-001': { file: 'apbco-logo.jpg', width: 90, height: 45 },
       'RIYA-LIBRA-001': { file: 'Libra-Brokers-Logo.png', width: 90, height: 60 },
        'RIYA-BUXMAN-001': { file: 'million-bux-logo.png', width: 120, height: 44 }
      };
      const logoConfig = logoMap[brokerToken];
      if (logoConfig) {
        const logoPath = __dirname + '/assets/' + logoConfig.file;
        if (fs.existsSync(logoPath)) {
                  doc.image(logoPath, pageWidth - marginRight - logoConfig.width, 8, {
            width: logoConfig.width, height: logoConfig.height, fit: [logoConfig.width, logoConfig.height]
          });
          hasLogo = true; 
        }
      }
    } catch (logoErr) {
      console.warn('Logo error:', logoErr.message);
    }
 
    doc.y = 105;
 
    // ===== ROBUST SECTION PARSING =====
    // Apply the same heading-repair used in RoA generation, so any run-on
    // heading (e.g. "DETAILSFinancial...") is split before parsing sections.
    const sanitized = text
      .replace(/(\d{1,4})\s*\n\s*(\d{1,4})(?!\.\s)/g, '$1$2')
      .replace(/OU[\r\n\s]*T[\r\n\s]*surance/g, 'OUTsurance')
      .replace(/OU[\r\n\s]*T[\r\n\s]*bonus/g, 'OUTbonus');
    const repaired = forceHeadingLinebreaks(sanitized);
    // Strip any leading whitespace and stray markdown before each line first,
    // so indentation or leftover '#'/'##' never causes a silent zero-match.
    const normalized = repaired
      .replace(/[\u2012\u2013\u2014\u2015\u2212]/g, '-')
      .replace(/[\u2012\u2013\u2014\u2015\u2212]/g, '-')
      .split('\n')
      .map(l => l.replace(/^\s+/, '').replace(/^#{1,3}\s*/, ''))
      .join('\n');
 
    const sections = [];
    const sectionRegex = /\n([1-8])\.\s+((?:FSP|CLIENT|NEEDS|MARKET|PRODUCT|REMUNERATION|REPLACEMENT|KLIENT|BEHOEFTE|MARK|AANBEVOLE|VERGOEDING|VERVANG|FSP-|FINANSIELE)[^\n]{0,80})/g;
    let match;
    const matches = [];
    while ((match = sectionRegex.exec(normalized)) !== null) {
      matches.push({
        number: match[1],
        title: match[2].trim(),
        index: match.index + (match[0].startsWith('\n') ? 1 : 0)
      });
    }
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index;
      const end = i + 1 < matches.length ? matches[i + 1].index : normalized.length;
      const headingLine = normalized.slice(start, end).split('\n')[0];
      const content = normalized.slice(start + headingLine.length, end).trim();
      sections.push({ number: matches[i].number, title: matches[i].title, content });
    }
 
    // Fail-safe: if parsing ever finds zero sections, render the raw text
    // rather than producing a blank body between header and footer.
    if (sections.length === 0) {
      doc.fontSize(9.5).font('Helvetica').fillColor('#333333').text(normalized, marginLeft, doc.y, { width: contentWidth });
    }
 
    // ===== RENDER SECTIONS =====
    for (const section of sections) {
      if (doc.y > doc.page.height - 100) { doc.addPage(); doc.y = 45; }
 
      const headerY = doc.y;
      doc.moveTo(marginLeft, headerY + 26).lineTo(pageWidth - marginRight, headerY + 26).strokeColor(GOLD).lineWidth(1).stroke();
      doc.fontSize(11).font('Helvetica-Bold').fillColor(NAVY).text(
        '  ' + section.number + '. ' + section.title.toUpperCase(),
        marginLeft, headerY + 7, { width: contentWidth }
      );
      doc.y = headerY + 34;
 
      const lines = section.content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      for (const line of lines) {
        if (doc.y > doc.page.height - 60) { doc.addPage(); doc.y = 45; }
        const isBullet = /^[•\-\*]\s+/.test(line);
        const isSubHeading = /^[A-Z][A-Za-z\s&/()-]*:\s*$/.test(line) && line.length < 70;
 
        if (isSubHeading) {
          doc.moveDown(0.3);
          doc.fontSize(10).font('Helvetica-Bold').fillColor(NAVY).text(line, marginLeft, doc.y, { width: contentWidth });
          doc.moveDown(0.2);
        } else if (isBullet) {
          doc.fontSize(9.5).font('Helvetica').fillColor('#333333').text(line, marginLeft + 12, doc.y, { width: contentWidth - 12 });
          doc.moveDown(0.3);
        } else {
          doc.fontSize(9.5).font('Helvetica').fillColor('#333333').text(line.replace(/(\d{2,4})\s+(\d{2,4})/g, '$1$2'), marginLeft, doc.y, { width: contentWidth });
          doc.moveDown(0.3);
        }
      }
      doc.moveDown(0.7);
    }
 
    // ===== FOOTER =====
    if (doc.y > doc.page.height - 60) doc.addPage();
    doc.moveDown(1);
    const footerY = doc.y;
    doc.rect(0, footerY, pageWidth, 30).fill(NAVY);
    doc.fontSize(7.5).font('Helvetica').fillColor(GOLD).text(
      'Generated by Riya  |  Africa Bloom (Pty) Ltd  |  FAIS Act 37/2002  |  BN 80/2003  |  GN 706/2020  |  5-year retention required',
      marginLeft, footerY + 10, { align: 'center', width: contentWidth }
    );
 
    doc.end();
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});
 
app.get('/credits', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required.' });
  const broker = await validateBrokerToken(token);
  if (!broker) return res.status(404).json({ error: 'Token not found.' });
  return res.json({ name: broker.name, credits: broker.credits, credits_used: broker.credits_used, status: broker.status, fsp_firm_name: broker.fsp_firm_name || '', fsp_number: broker.fsp_number || '', fsp_address: broker.fsp_address || '', compliance_officer: broker.compliance_officer || '' });
});
 
app.post('/record-acceptance', async (req, res) => {
  const { roa_token, client_name, client_email, broker_token } = req.body;
  if (!client_name || !client_email) return res.status(400).json({ error: 'Client name and email are required.' });
  try {
    await supabaseRequest('POST', 'acceptances', {
      roa_token: roa_token || null,
      client_name: client_name,
      client_email: client_email,
      broker_token: broker_token || null
    });
    return res.json({ success: true, accepted_at: new Date().toISOString() });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
});
 
app.get('/', (req, res) => res.send('Riya backend running.'));
 
const PORT = process.env.PORT || 3000;
 
app.post('/create-payment', async (req, res) => {
  const { token, bundle } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required.' });
 
  const bundles = {
    starter: { credits: 20, amount: '100.00', name: 'Riya Starter — 10 RoAs' },
    standard: { credits: 80, amount: '400.00', name: 'Riya Standard — 40 RoAs' },
    pro: { credits: 200, amount: '1000.00', name: 'Riya Pro — 100 RoAs' },
    catchup: { credits: 500, amount: '2500.00', name: 'Riya Catch-Up — 250 RoAs' }
  };
 
  const selected = bundles[bundle];
  if (!selected) return res.status(400).json({ error: 'Invalid bundle.' });
 
  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY;
 
  const paymentData = {
    merchant_id: merchantId,
    merchant_key: merchantKey,
    return_url: 'https://riya-pilot.netlify.app?payment=success',
    cancel_url: 'https://riya-pilot.netlify.app?payment=cancelled',
    notify_url: 'https://riya-backend-production.up.railway.app/payfast-webhook',
    item_name: selected.name,
    amount: selected.amount,
    custom_str1: token,
    custom_int1: selected.credits.toString()
  };
 
  const params = Object.entries(paymentData)
    .map(([k, v]) => k + '=' + encodeURIComponent(v).replace(/%20/g, '+'))
    .join('&');
 
  const payUrl = 'https://www.payfast.co.za/eng/process?' + params;
  return res.json({ url: payUrl });
});
 
app.post('/payfast-webhook', async (req, res) => {
  const { payment_status, custom_str1, custom_int1, pf_payment_id } = req.body;
 
  if (payment_status !== 'COMPLETE') return res.sendStatus(200);
 
  const token = custom_str1;
  const credits = parseInt(custom_int1 || '0');
 
  if (!token || !credits) return res.sendStatus(200);
 
  if (!pf_payment_id) {
    console.error('Webhook missing pf_payment_id - cannot verify idempotency, skipping to avoid duplicate credit risk');
    return res.sendStatus(200);
  }
 
  try {
    const existing = await supabaseRequest('GET', 'processed_payments?pf_payment_id=eq.' + encodeURIComponent(pf_payment_id) + '&select=id');
    if (existing && existing.length > 0) {
      console.log('Payment ' + pf_payment_id + ' already processed - skipping duplicate webhook call');
      return res.sendStatus(200);
    }
 
    const broker = await validateBrokerToken(token);
    if (!broker) return res.sendStatus(200);
 
    await supabaseRequest('PATCH', 'brokers?token=eq.' + encodeURIComponent(token), {
      credits: broker.credits + credits
    });
 
    await supabaseRequest('POST', 'processed_payments', {
      pf_payment_id: pf_payment_id,
      broker_token: token,
      credits_added: credits
    });
 
    console.log('Credits added: ' + credits + ' to ' + token + ' (payment ' + pf_payment_id + ')');
  } catch(e) {
    console.error('Webhook error:', e.message);
  }
 
  return res.sendStatus(200);
});
 
app.post('/create-token', async (req, res) => {
  const { name, email, token, fsp_number, plan, credits } = req.body;
  if (!name || !email || !token) return res.status(400).json({ error: 'missing fields' });
  try {
    await supabaseRequest('POST', 'brokers', {
      name: name,
      email: email,
      token: token,
      fsp_number: fsp_number || null,
      plan: plan || 'pilot',
      credits: credits || 5,
      credits_used: 0,
      status: 'active'
    });
    await sendWelcomeEmail(name, email, token);
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});
 
app.post('/send-roa-to-broker', async (req, res) => {
  try {
    const { roaContent, brokerToken, clientName, brokerName } = req.body;
    if (!roaContent || !brokerToken || !clientName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
 
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
 
    const { data: broker, error: brokerError } = await supabase
      .from('brokers')
      .select('email, name')
      .eq('token', brokerToken)
      .single();
 
    if (brokerError || !broker) {
      return res.status(400).json({ error: 'Invalid broker token' });
    }
 
    const brokerEmail = broker.email;
    const resolvedBrokerName = brokerName || broker.name || 'Adviser';
 
    const result = await sendRoAEmail(brokerEmail, clientName, resolvedBrokerName, roaContent, brokerToken);
    if (result.success) {
      return res.status(200).json({ success: true, sentTo: brokerEmail });
    } else {
      return res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
});
 
app.post('/extract-pdf', async (req, res) => {
  try {
    const { fileBase64, fileType, fileName } = req.body;
    if (!fileBase64) return res.status(400).json({ error: 'No file provided' });
 
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not configured' });
 
    if (fileType && (fileType.includes('wordprocessingml') || (fileName && fileName.toLowerCase().endsWith('.docx')))) {
      const mammoth = require('mammoth');
      const buffer = Buffer.from(fileBase64, 'base64');
      const result = await mammoth.extractRawText({ buffer });
      return res.json({ text: result.value });
    }
 
    if (fileType && (fileType.includes('text/') || (fileName && (fileName.toLowerCase().endsWith('.txt') || fileName.toLowerCase().endsWith('.csv'))))) {
      const decoded = Buffer.from(fileBase64, 'base64').toString('utf-8');
      return res.json({ text: decoded });
    }
 
    const payload = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 }
          },
          {
            type: 'text',
            text: 'Extract all text content from this insurance document. Return the extracted information as structured plain text.'
          }
        ]
      }]
    });
 
    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(payload)
        }
      };
 
      const req = https.request(options, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (response.statusCode !== 200) {
              reject(new Error(parsed.error && parsed.error.message || 'API error'));
            } else {
              const text = parsed.content && parsed.content.map(b => b.text || '').join('') || '';
              resolve(text);
            }
          } catch(e) {
            reject(new Error('Parse error: ' + e.message));
          }
        });
      });
 
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
 
    return res.json({ text: result });
 
  } catch(err) {
    console.error('PDF extraction error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});
 
app.post('/save-draft', async (req, res) => {
  const { token, draftId, clientLabel, formData } = req.body;
  if (!token) return res.status(401).json({ error: 'No token provided.' });
  if (!clientLabel || !formData) return res.status(400).json({ error: 'clientLabel and formData are required.' });
  try {
    if (draftId) {
      await supabaseRequest('PATCH', 'roa_drafts?id=eq.' + encodeURIComponent(draftId) + '&broker_token=eq.' + encodeURIComponent(token), {
        client_label: clientLabel,
        form_data: formData,
        updated_at: new Date().toISOString()
      });
      return res.json({ success: true, id: draftId });
    } else {
      const created = await supabaseRequest('POST', 'roa_drafts', {
        broker_token: token,
        client_label: clientLabel,
        form_data: formData
      });
      const newId = created && created[0] && created[0].id;
      return res.json({ success: true, id: newId });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
});
 
app.get('/list-drafts', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required.' });
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabaseRequest('DELETE', 'roa_drafts?broker_token=eq.' + encodeURIComponent(token) + '&updated_at=lt.' + encodeURIComponent(cutoff));
    const drafts = await supabaseRequest('GET', 'roa_drafts?broker_token=eq.' + encodeURIComponent(token) + '&select=id,client_label,updated_at&order=updated_at.desc');
    return res.json({ drafts: drafts || [] });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
});
 
app.get('/load-draft', async (req, res) => {
  const { token, id } = req.query;
  if (!token || !id) return res.status(400).json({ error: 'Token and id required.' });
  try {
    const result = await supabaseRequest('GET', 'roa_drafts?id=eq.' + encodeURIComponent(id) + '&broker_token=eq.' + encodeURIComponent(token) + '&select=*');
    if (!result || !result.length) return res.status(404).json({ error: 'Draft not found.' });
    return res.json({ draft: result[0] });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
});
 
app.delete('/delete-draft', async (req, res) => {
  const { token, id } = req.query;
  if (!token || !id) return res.status(400).json({ error: 'Token and id required.' });
  try {
    await supabaseRequest('DELETE', 'roa_drafts?id=eq.' + encodeURIComponent(id) + '&broker_token=eq.' + encodeURIComponent(token));
    return res.json({ success: true });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
});
 
app.listen(PORT, () => console.log('Riya backend listening on port ' + PORT));
