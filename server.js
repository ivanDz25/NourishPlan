const express = require('express');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/generate', async (req, res) => {
  const { clientData } = req.body;
  if (!clientData) return res.status(400).json({ error: 'Missing clientData' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });

  const { systemPrompt, userPrompt } = buildPrompt(clientData);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 20000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'Anthropic API error' });
    }

    const data = await response.json();
    let text = (data.content?.map(b => b.text || '').join('') || '');

    // Strip markdown formatting
    text = text
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s+/gm, '')
      .replace(/`{1,3}[^`]*`{1,3}/g, '')
      .replace(/^\s*[-*]\s+/gm, '- ');

    // Strip ALL AI chain-of-thought / reasoning / calculation lines
    text = text.split('\n').filter(function(line) {
      var t = line.trim();
      if (!t) return true; // keep blank lines for spacing
      var lower = t.toLowerCase();
      return !(
        /^day\s+\d+\s*(total|check|verification)/i.test(t) ||
        /let me (reduce|adjust|recalculate|change|modify|lower|pick)/i.test(t) ||
        /i (can|will|should|need to|must) (reduce|adjust|change|recalculate|lower|pick|use)/i.test(t) ||
        /just (barely|slightly|a bit|a little) (over|under|above|below)/i.test(t) ||
        /that (saves|brings|gives|puts|leaves)/i.test(t) ||
        /within.*ceiling/i.test(t) ||
        /\d+\s*[\+\-]\s*\d+.*=\s*\d+\s*(cal)?/i.test(t) ||
        /bringing.*to \d+\s*cal/i.test(t) ||
        /total\s*=\s*[\d\s\+\-]+\s*(cal|calories)/i.test(t) ||
        /\. good\.?\s*$/i.test(t) ||
        /good\.\s*$/i.test(t) ||
        /^(checking|verifying|calculating|adjusting|recalculating)/i.test(t) ||
        /under (the )?(ceiling|limit|budget|target)/i.test(t) ||
        /over (the )?(ceiling|limit|budget|target)/i.test(t) ||
        /(ceiling|budget)\. good/i.test(t) ||
        /perfect\.\s*$/i.test(t) ||
        /^\d+\s*\+\s*\d+/.test(t)
      );
    }).join('\n');

    // Fix meal label mapping for 2-meal configs
    if ((clientData.meals || '').toLowerCase().trim() === '2 meals + snacks') {
      text = text.replace(/^DINNER:/gm, 'SNACK:').replace(/^DINNER$/gm, 'SNACK');
      text = text.replace(/^BREAKFAST:/gm, 'MEAL 1:').replace(/^BREAKFAST$/gm, 'MEAL 1');
      text = text.replace(/^LUNCH:/gm, 'MEAL 2:').replace(/^LUNCH$/gm, 'MEAL 2');
    }
    if ((clientData.meals || '').toLowerCase().trim() === '2 meals/day') {
      text = text.replace(/^BREAKFAST:/gm, 'MEAL 1:').replace(/^BREAKFAST$/gm, 'MEAL 1');
      text = text.replace(/^DINNER:/gm, 'MEAL 2:').replace(/^DINNER$/gm, 'MEAL 2');
    }

    // Send email async — don't block the response
    if (clientData && clientData.email) {
      sendEmail(clientData, text).catch(function(emailErr) {
        console.error('Email send failed:', emailErr.message);
      });
    }

    res.json({ plan: text });

  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

async function sendEmail(clientData, planText) {
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || 'plans@nourishplan.co';
  const htmlBody = buildEmailHTML(clientData, planText);

  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + resendKey
    },
    body: JSON.stringify({
      from: 'NourishPlan <' + fromEmail + '>',
      to: [clientData.email],
      subject: 'Your Weekly Meal Plan is Ready, ' + clientData.name + '!',
      html: htmlBody
    })
  });
  console.log('Email sent to ' + clientData.email + ' | Status: ' + result.status);
}

function buildEmailHTML(clientData, planText) {
  const escaped = planText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const formatted = escaped
    .replace(/={3,}/g, '<hr style="border:1px solid #DDD8CC;margin:16px 0">')
    .replace(/-{3,}/g, '<hr style="border:0.5px solid #EEE;margin:8px 0">')
    .replace(/^(DAY \d+ - .+)$/gm, '<h3 style="color:#3D5A3E;font-size:15px;margin:20px 0 4px">$1</h3>')
    .replace(/^(BREAKFAST|LUNCH|DINNER|SNACK|MEAL 1|MEAL 2|MEAL 3|MEAL 4|MEAL 5):?$/gm,
      '<h3 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#3D5A3E;margin:16px 0 4px">$1</h3>')
    .replace(/^(CALORIE & MACRO TARGETS|WEEKLY GROCERY LIST|MEAL PREP TIPS)$/gm,
      '<h2 style="font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#7A7060;margin:20px 0 8px">$1</h2>')
    .replace(/\n/g, '<br>');

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="margin:0;padding:0;background:#F7F4EE;font-family:Arial,sans-serif">' +
    '<div style="max-width:640px;margin:0 auto;padding:32px 16px">' +
    '<div style="text-align:center;margin-bottom:32px">' +
    '<div style="font-size:24px;font-weight:600;color:#2C2416">Nourish<span style="color:#3D5A3E">Plan</span></div>' +
    '<div style="font-size:13px;color:#7A7060;margin-top:4px">Your personalized weekly meal plan</div>' +
    '</div>' +
    '<div style="background:#3D5A3E;border-radius:12px;padding:28px;text-align:center;margin-bottom:24px">' +
    '<div style="color:white;font-size:26px;font-weight:600;margin-bottom:4px">Hi ' + clientData.name + '</div>' +
    '<div style="color:#A8CCA8;font-size:14px">Your ' + clientData.goal + ' meal plan is ready.</div>' +
    '</div>' +
    '<div style="background:white;border:1px solid #DDD8CC;border-radius:12px;padding:24px;margin-bottom:24px;font-size:14px;line-height:1.8;color:#2C2416">' +
    formatted +
    '</div>' +
    '<div style="background:white;border:1px solid #DDD8CC;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px">' +
    '<div style="font-size:15px;font-weight:600;color:#2C2416;margin-bottom:6px">Want a fresh plan every week?</div>' +
    '<div style="font-size:13px;color:#7A7060;margin-bottom:16px">Reply to this email and we will set it up for you.</div>' +
    '<a href="https://nourishplan.onrender.com" style="display:inline-block;background:#3D5A3E;color:white;padding:12px 28px;border-radius:100px;text-decoration:none;font-size:14px;font-weight:500">Generate another plan</a>' +
    '</div>' +
    '<div style="text-align:center;font-size:12px;color:#7A7060;line-height:1.6">' +
    'NourishPlan - No groceries sold - No spam<br>' +
    'You received this because you requested a meal plan.' +
    '</div></div></body></html>';
}

const mealLabelMap = {
  '2 meals + snacks': ['BREAKFAST', 'LUNCH', 'SNACK'],
  '2 meals/day': ['BREAKFAST', 'DINNER'],
  '3 meals': ['BREAKFAST', 'LUNCH', 'DINNER'],
  '3 meals/day': ['BREAKFAST', 'LUNCH', 'DINNER'],
  '3 meals + snacks': ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'],
  'dinner only': ['DINNER'],
  '4-5 smaller meals': ['MEAL 1', 'MEAL 2', 'MEAL 3', 'MEAL 4', 'MEAL 5']
};

function buildPrompt(d) {
  const mealKey = Object.keys(mealLabelMap).find(function(k) {
    return k.toLowerCase().trim() === (d.meals || '').toLowerCase().trim();
  });
  const labels = mealLabelMap[mealKey] || ['BREAKFAST', 'LUNCH', 'DINNER'];
  const allowedLabels = labels.join(', ');
  const hasSnack = labels.includes('SNACK');
  const mealCount = labels.filter(function(l) { return l !== 'SNACK'; }).length;

  console.log('d.meals raw:', JSON.stringify(d.meals), '| matched:', mealKey, '| labels:', labels);

  const favoriteMeal = (d.biggestMeal || 'Dinner (evening)');

  const snackBlock =
    'SNACK: [Snack Name]\n' +
    'Ingredients:\n' +
    '- [ingredient] - [quantity]\n' +
    'Macros: [X] cal | [X]g protein | [X]g carbs | [X]g fat';

  function mealBlock(label) {
    return label + ': [Meal Name]\n' +
      'Ingredients:\n' +
      '- [ingredient] - [quantity for ' + d.household + ' person(s)]\n' +
      'Instructions:\n' +
      '1. [Step]\n' +
      'Macros: [X] cal | [X]g protein | [X]g carbs | [X]g fat\n' +
      'Prep time: [X] min';
  }

  const mealDayTemplate = 'DAY [number] - [DAY NAME]\n\n' +
    labels.map(function(label) {
      return label === 'SNACK' ? snackBlock : mealBlock(label);
    }).join('\n\n');

  // ── Calorie math ──
  const weight = parseFloat(d.weight) || 180;
  const age = parseFloat(d.age) || 30;
  const isMale = (d.sex || '').toLowerCase().includes('male');

  function parseHeightToCm(h) {
    h = (h || '').toString().trim();
    var ftIn = h.match(/(\d+)['\s](\d+)/);
    if (ftIn) return Math.round((parseInt(ftIn[1]) * 12 + parseInt(ftIn[2])) * 2.54);
    var ftOnly = h.match(/^(\d+)'?$/);
    if (ftOnly && parseInt(ftOnly[1]) < 8) return Math.round(parseInt(ftOnly[1]) * 30.48);
    var cm = parseFloat(h);
    if (cm > 100) return Math.round(cm);
    return 170;
  }

  const heightCm = parseHeightToCm(d.height);
  const bmr = isMale
    ? Math.round(10 * weight * 0.453592 + 6.25 * heightCm - 5 * age + 5)
    : Math.round(10 * weight * 0.453592 + 6.25 * heightCm - 5 * age - 161);

  const activityMultiplier =
    (d.activity || '').toLowerCase().includes('lightly') ? 1.375 :
    (d.activity || '').toLowerCase().includes('moderately') ? 1.55 :
    (d.activity || '').toLowerCase().includes('very') ? 1.725 :
    (d.activity || '').toLowerCase().includes('athlete') ? 1.9 : 1.2;

  const tdee = Math.round(bmr * activityMultiplier);

  let goalCalories = d.goal && d.goal.toLowerCase().includes('lose') ? tdee - 500
    : d.goal && d.goal.toLowerCase().includes('bulk') ? tdee + 300
    : tdee;

  // Explicit calorie field takes priority, then notes fallback
  if (d.calorieTarget && parseInt(d.calorieTarget) >= 800 && parseInt(d.calorieTarget) <= 5000) {
    goalCalories = parseInt(d.calorieTarget);
    console.log('Calorie override from form field:', goalCalories);
  } else {
    const allNotes = ((d.notes || '') + ' ' + (d.healthContext || '')).toLowerCase();
    const match = allNotes.match(/(\d{3,4})\s*(?:cal(?:ories?)?|kcal)/i);
    if (match) {
      const parsed = parseInt(match[1]);
      if (parsed >= 800 && parsed <= 4000) {
        goalCalories = parsed;
        console.log('Calorie override from notes:', goalCalories);
      }
    }
  }

  const isKosher = (d.restrictions || '').toLowerCase().includes('kosher');
  const isVegan = (d.restrictions || '').toLowerCase().includes('vegan');
  const isVegetarian = (d.restrictions || '').toLowerCase().includes('vegetarian');
  const isLowCarb = (d.macro || '').toLowerCase().includes('low carb') || (d.macro || '').toLowerCase().includes('keto');

  const protein = Math.round(weight * 0.453592 * 2.2);
  const fat = Math.round(goalCalories * 0.28 / 9);
  const carbs = Math.round((goalCalories - protein * 4 - fat * 9) / 4);

  const snackCals = hasSnack ? 200 : 0;
  const mealCals = goalCalories - snackCals;
  const favCals = Math.round(mealCals * 0.55);
  const otherCals = mealCount > 1 ? Math.round((mealCals - favCals) / (mealCount - 1)) : 0;
  const calDiff = Math.abs(goalCalories - tdee);
  const calDirection = goalCalories < tdee ? 'deficit' : 'surplus';

  const mealStructureInstruction = 'Each day must contain EXACTLY these meal sections in this order: ' + allowedLabels + '. Use ONLY these labels. Never add, rename, or reorder them.';

  const forbiddenNote =
    (labels.includes('BREAKFAST') ? '' : 'BREAKFAST is forbidden. ') +
    (labels.includes('LUNCH') ? '' : 'LUNCH is forbidden. ') +
    (labels.includes('DINNER') ? '' : 'DINNER is forbidden. ') +
    'Never use forbidden labels as section headers.';

  // ── Diet enforcement strings ──
  const kosherRule = isKosher
    ? '\n8. KOSHER: NEVER combine meat or poultry with dairy on the same day. If any meal has meat, zero dairy that day. If snack has dairy, that day is meat-free.'
    : '';

  const veganRule = isVegan
    ? '\n9. VEGAN — ABSOLUTE: Zero animal products. No meat, fish, eggs, dairy, honey, whey. All protein must come exclusively from: tofu, tempeh, edamame, legumes, seeds, plant-based protein powder, nutritional yeast. Any animal product is a critical failure.'
    : (isVegetarian ? '\n9. VEGETARIAN: No meat or fish. Eggs and dairy are allowed.' : '');

  const lowCarbRule = isLowCarb
    ? '\n10. LOW CARB — HARD LIMIT: Total net carbs per day must stay UNDER 50g. Avoid: rice, bread, pasta, oats, most beans, most fruit. Allowed: leafy greens, zucchini, broccoli, cauliflower, cucumber, bell pepper, nuts, seeds, avocado, tofu, tempeh, edamame. Each meal must stay under 15g net carbs.'
    : '';

  const systemPrompt =
    'You are an elite registered dietitian generating structured meal plans. Output ONLY the meal plan in the exact format specified. No commentary, no reasoning, no calculations, no self-correction text.\n\n' +
    'RULES YOU NEVER BREAK:\n\n' +
    '1. MEAL STRUCTURE: ' + mealStructureInstruction + '\n' +
    '   ' + forbiddenNote + '\n' +
    (hasSnack ? '   SNACK appears AFTER all main meals. Never label it BREAKFAST.\n' : '') +
    '\n2. MEAL COUNT: Every day has EXACTLY ' + labels.length + ' section(s): ' + allowedLabels + '.\n' +
    '\n3. CALORIE BUDGET — NON-NEGOTIABLE:\n' +
    '   Daily ceiling: ' + goalCalories + ' cal total\n' +
    '   ' + favoriteMeal + ' (favorite): ' + favCals + ' cal\n' +
    (mealCount > 1 ? '   All other main meals: ' + otherCals + ' cal each\n' : '') +
    (hasSnack ? '   Snack: 200 cal exactly\n' : '') +
    '   Size every ingredient portion to hit these targets BEFORE writing. Never write a meal at standard recipe size.\n' +
    '\n4. ONE VERSION ONLY: Write each meal label EXACTLY ONCE per day. No drafts, no iterations, no multiple versions. The first version written is the only version.\n' +
    '\n5. NO REASONING IN OUTPUT: Never write calculations, totals, self-corrections, or commentary in the output. The output contains ONLY meal plan content.\n' +
    '\n6. COMPLETE ALL DAYS: Write all ' + d.days + ' days before the grocery list.\n' +
    '\n7. PLAIN TEXT ONLY: No markdown, no asterisks, no bold, no # headers.' +
    (d.hardAllergies ? '\n   BANNED: ' + d.hardAllergies + ' — never appear anywhere.' : '') +
    kosherRule +
    veganRule +
    lowCarbRule;

  const dietEnforcement =
    (isVegan ? 'VEGAN STRICT: Only tofu, tempeh, edamame, legumes, seeds, plant protein, nutritional yeast. Zero animal products.\n' : '') +
    (isVegetarian && !isVegan ? 'VEGETARIAN: No meat or fish. Eggs and dairy OK.\n' : '') +
    (isLowCarb ? 'LOW CARB STRICT: Under 50g net carbs/day. Under 15g per meal. No rice, bread, pasta, oats, most beans.\n' : '');

  const userPrompt =
    'OUTPUT FORMAT RULE: Use ONLY these section headers each day: ' + allowedLabels + '. ' + forbiddenNote + '\n' +
    'CRITICAL: Do NOT write any calculations, totals, or reasoning in the output. Meal plan content only.\n\n' +
    'Generate a complete ' + d.days + '-day meal plan.\n\n' +
    'CLIENT:\n' +
    '- ' + (d.name || 'Client') + ' | Age: ' + d.age + ' | ' + d.sex + ' | ' + d.height + ' | ' + d.weight + ' lbs\n' +
    '- Activity: ' + d.activity + '\n' +
    '- Goal: ' + d.goal + ' | Macro style: ' + d.macro + '\n' +
    '- Household: ' + d.household + ' person(s) | ' + d.days + ' days | Budget: ' + (d.budget || '$150') + '/wk\n\n' +
    'DAILY MEAL STRUCTURE: ' + allowedLabels + '\n' +
    'BIGGEST MEAL: ' + favoriteMeal + ' → ' + favCals + ' cal\n' +
    (mealCount > 1 ? 'OTHER MEALS: ' + otherCals + ' cal each\n' : '') +
    (hasSnack ? 'SNACK: 200 cal, no cooking\n' : '') +
    '\nPROTEINS: ' + (d.proteins || 'No preference') + '\n' +
    dietEnforcement +
    'EQUIPMENT: ' + (d.equipment || 'Standard kitchen') + '\n' +
    (d.hardAllergies ? 'BANNED INGREDIENTS: ' + d.hardAllergies + '\n' : '') +
    'RESTRICTIONS: ' + (d.restrictions || 'None') + '\n' +
    'CUISINE: ' + (d.cuisine || 'No preference') + '\n' +
    'AVOID: ' + (d.dislikes || 'None') + '\n' +
    'SKILL: ' + (d.skill || 'Beginner') + '\n' +
    'REPEATS OK: ' + (d.mealRepeat || 'Somewhat') + '\n' +
    'TRACKS: ' + (d.tracking || 'No') + '\n' +
    (d.healthContext ? 'HEALTH CONTEXT: ' + d.healthContext + '\n' : '') +
    (d.notes ? 'NOTES: ' + d.notes + '\n' : '') +
    '\nCALORIE TARGETS (hard limits — size portions to meet these exactly):\n' +
    'Daily ceiling: ' + goalCalories + ' cal\n' +
    'Protein: ' + protein + 'g | Carbs: ' + carbs + 'g | Fat: ' + fat + 'g\n' +
    'Context: ' + calDiff + ' cal ' + calDirection + ' from TDEE ' + tdee + ' for ' + d.goal + '\n\n' +
    'Use this EXACT format — no deviations:\n\n' +
    mealDayTemplate + '\n\n' +
    'Write Day 1 through Day ' + d.days + '. Complete every day. Do not write the grocery list until ALL days are done.\n\n' +
    'After all days:\n\n' +
    '===================================\n' +
    'WEEKLY GROCERY LIST\n' +
    '===================================\n\n' +
    'PRODUCE:\n- [item] - [total qty for week]\n\n' +
    'PROTEIN & MEAT:\n- [item] - [total]\n\n' +
    'DAIRY & EGGS:\n- [item] - [total]\n\n' +
    'PANTRY & DRY GOODS:\n- [item] - [total]\n\n' +
    'FROZEN:\n- [item] - [total]\n\n' +
    'ESTIMATED TOTAL: $XX-$XX\n' +
    '(Budget: ' + (d.budget || '$150') + ' | ' + d.household + ' person(s), ' + d.days + ' days)\n\n' +
    '===================================\n' +
    'MEAL PREP TIPS\n' +
    '===================================\n' +
    '1. [Tip for their cooking style and equipment]\n' +
    '2. [Batch cooking suggestion]\n' +
    '3. [Storage tip]\n' +
    '4. [Budget tip]\n' +
    '5. [Macro tracking tip for their tracking level]\n\n' +
    'Allowed labels: ' + allowedLabels + ' only. Plain text only. No markdown. No reasoning text.';

  return { systemPrompt, userPrompt };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', function() {
  console.log('NourishPlan running on port ' + PORT);
});
