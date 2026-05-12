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
        model: 'claude-sonnet-4-6',
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

    text = text
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s+/gm, '')
      .replace(/`{1,3}[^`]*`{1,3}/g, '')
      .replace(/^\s*[-*]\s+/gm, '- ');
    
    if ((clientData.meals || '').toLowerCase().trim() === '2 meals + snacks') {
      text = text.replace(/^DINNER:/gm, 'SNACK:').replace(/^DINNER$/gm, 'SNACK');
      text = text.replace(/^BREAKFAST:/gm, 'MEAL 1:').replace(/^BREAKFAST$/gm, 'MEAL 1');
      text = text.replace(/^LUNCH:/gm, 'MEAL 2:').replace(/^LUNCH$/gm, 'MEAL 2');
    }
    if ((clientData.meals || '').toLowerCase().trim() === '2 meals/day') {
      text = text.replace(/^BREAKFAST:/gm, 'MEAL 1:').replace(/^BREAKFAST$/gm, 'MEAL 1');
      text = text.replace(/^DINNER:/gm, 'MEAL 2:').replace(/^DINNER$/gm, 'MEAL 2');
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

  await fetch('https://api.resend.com/emails', {
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
  console.log('Email sent to ' + clientData.email);
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

  console.log('d.meals raw value:', JSON.stringify(d.meals));
  console.log('mealKey matched:', mealKey);
  console.log('labels resolved:', JSON.stringify(labels));
  console.log('hasSnack:', hasSnack);

  const favoriteMeal = (d.biggestMeal || 'Dinner (evening)');

  const snackBlock = 'SNACK: [Snack Name - simple, no cooking, ~200 cal]\n' +
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

  // Calorie math
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
  const activityMultiplier = (d.activity || '').toLowerCase().includes('lightly') ? 1.375
      : (d.activity || '').toLowerCase().includes('moderately') ? 1.55
      : (d.activity || '').toLowerCase().includes('very') ? 1.725
      : (d.activity || '').toLowerCase().includes('athlete') ? 1.9
      : 1.2;
    const tdee = Math.round(bmr * activityMultiplier);
  const goalCalories = d.goal && d.goal.toLowerCase().includes('lose')
    ? tdee - 500
    : d.goal && d.goal.toLowerCase().includes('bulk')
      ? tdee + 300
      : tdee;
  const protein = Math.round(weight * 0.453592 * 2.2);
  const fat = Math.round(goalCalories * 0.28 / 9);
  const carbs = Math.round((goalCalories - protein * 4 - fat * 9) / 4);
  const snackCals = hasSnack ? 200 : 0;
  const mealCals = goalCalories - snackCals;
  const favCals = Math.round(mealCals * 0.55);
  const otherCals = mealCount > 1 ? Math.round((mealCals - favCals) / (mealCount - 1)) : 0;
  const calDiff = Math.abs(goalCalories - tdee);
  const calDirection = goalCalories < tdee ? 'deficit' : 'surplus';

  const mealStructureInstruction = 'Each day must contain EXACTLY these meal sections in this order: ' + allowedLabels + '. Use ONLY these labels. Do not add, rename, or reorder them.';

  const forbiddenNote = (labels.includes('BREAKFAST') ? '' : 'BREAKFAST is forbidden. ') +
    (labels.includes('LUNCH') ? '' : 'LUNCH is forbidden. ') +
    (labels.includes('DINNER') ? '' : 'DINNER is forbidden. ') +
    'Never use these as section headers unless listed above.';

  const systemPrompt =
    'You are an elite registered dietitian generating structured meal plans.\n\n' +
    'RULES YOU NEVER BREAK:\n\n' +
    '1. MEAL STRUCTURE: ' + mealStructureInstruction + '\n' +
    '   CRITICAL: ' + forbiddenNote + '\n' +
    (hasSnack ? '   SNACK is an afternoon or evening snack eaten AFTER the main meals. It is never a morning meal. Never label it BREAKFAST.\n' : '') +
    '\n2. MEAL COUNT: Every day has exactly ' + labels.length + ' section(s): ' + allowedLabels + '. Never add or remove sections.\n' +
    '\n3. FAVORITE MEAL: The client selected "' + favoriteMeal + '" as their favorite meal. Make it the most satisfying and calorie-rich meal (~' + favCals + ' cal). Other meals target ~' + otherCals + ' cal each.' + (hasSnack ? ' SNACK targets exactly 200 calories.' : '') + '\n' +
    '\n4. COMPLETE ALL DAYS: Write all ' + d.days + ' days before the grocery list.\n' +
    '\n5. PLAIN TEXT ONLY: No markdown, no asterisks, no bold, no # headers.\n' +
    '\n6. BANNED INGREDIENTS: ' + (d.hardAllergies || 'None') + ' -- never appear anywhere.';

  const otherMealsLine = mealCount > 1 ? 'OTHER MEALS: approximately ' + otherCals + ' calories each' : '';
  const snackLine = hasSnack ? 'SNACK: always ~200 calories, simple, no cooking required' : '';
  const goalLower = (d.goal || '').toLowerCase();

  const userPrompt =
    'CRITICAL FORMATTING RULE: Use ONLY these section headers each day: ' + allowedLabels + '.\n' +
    forbiddenNote + '\n\n' +
    'Generate a complete ' + d.days + '-day meal plan for this client.\n\n' +
    'CLIENT:\n' +
    '- Name: ' + (d.name || 'Client') + ' | Age: ' + d.age + ' | Sex: ' + d.sex + ' | Height: ' + d.height + ' | Weight: ' + d.weight + ' lbs\n' +
    '- Activity: ' + d.activity + ' | Goal: ' + d.goal + ' | Macros: ' + d.macro + '\n' +
    '- Household: ' + d.household + ' person(s) | Days: ' + d.days + ' | Budget: ' + (d.budget || '$150') + '/wk\n\n' +
    'DAILY STRUCTURE: ' + allowedLabels + '\n' +
    'FAVORITE MEAL: ' + favoriteMeal + ' -- make this the most satisfying and calorie-rich meal (~' + favCals + ' cal)\n' +
    (otherMealsLine ? otherMealsLine + '\n' : '') +
    (snackLine ? snackLine + '\n' : '') +
    '\nPROTEINS: ' + (d.proteins || 'No preference') + '\n' +
    'EQUIPMENT: ' + (d.equipment || 'Standard kitchen') + '\n' +
    'ALLERGIES BANNED: ' + (d.hardAllergies || 'None') + '\n' +
    'RESTRICTIONS: ' + (d.restrictions || 'None') + '\n' +
    'CUISINE: ' + (d.cuisine || 'No preference') + '\n' +
    'AVOID: ' + (d.dislikes || 'None') + '\n' +
    'SKILL: ' + d.skill + ' | REPEATS OK: ' + (d.mealRepeat || 'Somewhat') + ' | TRACKS: ' + (d.tracking || 'No') + '\n' +
    'HEALTH CONTEXT: ' + (d.healthContext || 'None') + '\n' +
    'NOTES: ' + (d.notes || 'None') + '\n\n' +
    'Scale all quantities for ' + d.household + ' person(s). Macros are for the full household serving.\n\n' +
    'CALORIE & MACRO TARGETS\n' +
    'Daily calories: ' + goalCalories + ' cal\n' +
    'Protein: ' + protein + 'g | Carbs: ' + carbs + 'g | Fat: ' + fat + 'g\n' +
    'Strategy: ' + calDiff + ' calorie ' + calDirection + ' from TDEE of ' + tdee + ' to support ' + goalLower + '.\n\n' +
    'Use this exact format for every day -- no deviations:\n\n' +
mealDayTemplate + '\n\n' +
'CONCRETE EXAMPLE (follow this structure exactly):\n\n' +
'DAY 1 - MONDAY\n\n' +
'MEAL 1: Scrambled Eggs with Turkey Sausage\n' +
'Ingredients:\n- Ground turkey sausage - 1.5 lbs\n- Eggs - 8 large\n' +
'Instructions:\n1. Cook sausage. 2. Scramble eggs.\n' +
'Macros: 836 cal | 80g protein | 10g carbs | 38g fat\nPrep time: 20 min\n\n' +
'MEAL 2: Slow Cooker Beef Stew\n' +
'Ingredients:\n- Beef chuck - 2.5 lbs\n' +
'Instructions:\n1. Sear beef. 2. Add to slow cooker.\n' +
'Macros: 1022 cal | 105g protein | 20g carbs | 18g fat\nPrep time: 25 min\n\n' +
'SNACK: Hard Boiled Eggs and String Cheese\n' +
'Ingredients:\n- Hard boiled eggs - 4\n- String cheese sticks - 4\n' +
'Macros: 200 cal | 22g protein | 2g carbs | 12g fat\n\n' +
    'Write Day 1 through Day ' + d.days + ' completely. Do not skip any day. Do not write the grocery list until all ' + d.days + ' days are done.\n\n' +
    'After all days are written:\n\n' +
    '===================================\n' +
    'WEEKLY GROCERY LIST\n' +
    '===================================\n\n' +
    'PRODUCE:\n' +
    '- [item] - [total quantity for the week]\n\n' +
    'PROTEIN & MEAT:\n' +
    '- [item] - [total]\n\n' +
    'DAIRY & EGGS:\n' +
    '- [item] - [total]\n\n' +
    'PANTRY & DRY GOODS:\n' +
    '- [item] - [total]\n\n' +
    'FROZEN:\n' +
    '- [item] - [total]\n\n' +
    'ESTIMATED TOTAL: $XX-$XX\n' +
    '(Budget: ' + (d.budget || '$150') + ' | ' + d.household + ' person(s), ' + d.days + ' days)\n\n' +
    '===================================\n' +
    'MEAL PREP TIPS\n' +
    '===================================\n' +
    '1. [Tip specific to their cooking style and equipment]\n' +
    '2. [Batch cooking suggestion based on their meals]\n' +
    '3. [Storage tip]\n' +
    '4. [Budget tip]\n' +
    '5. [Macro tracking tip based on their tracking level]\n\n' +
    'Allowed meal labels: ' + allowedLabels + ' only. Plain text only. No markdown.';

  return { systemPrompt, userPrompt };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', function() {
  console.log('Meal Plan Generator running on port ' + PORT);
});
