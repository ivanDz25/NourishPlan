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
  console.log('MEALS VALUE:', clientData.meals);
  console.log('HAS2MEALS:', (clientData.meals || '').toLowerCase().includes('2 meal'));

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
        messages: [
          { role: 'user', content: userPrompt }
        ]
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
      .replace(/^\s*[-*]\s+/gm, '• ');

    if (clientData.email && process.env.RESEND_API_KEY) {
      sendEmail(clientData, text).catch(err => console.error('Email error:', err));
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
      'Authorization': `Bearer ${resendKey}`
    },
    body: JSON.stringify({
      from: `NourishPlan <${fromEmail}>`,
      to: [clientData.email],
      subject: `Your Weekly Meal Plan is Ready, ${clientData.name} 🥗`,
      html: htmlBody
    })
  });
  console.log(`Email sent to ${clientData.email}`);
}

function buildEmailHTML(clientData, planText) {
  const escaped = planText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const formatted = escaped
    .replace(/═+/g, '<hr style="border:1px solid #DDD8CC;margin:16px 0">')
    .replace(/─+/g, '<hr style="border:0.5px solid #EEE;margin:8px 0">')
.replace(/^(DAY \d+ —.+)$/gm, '<h3 style="color:#3D5A3E;font-size:15px;margin:20px 0 4px">$1</h3>')
.replace(/^(BREAKFAST|LUNCH|DINNER|SNACK|MEAL 1|MEAL 2|MEAL 3|MEAL 4|MEAL 5)$/gm,
  '<h3 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#3D5A3E;margin:16px 0 4px">$1</h3>')
.replace(/^(CALORIE & MACRO TARGETS|WEEKLY GROCERY LIST|MEAL PREP TIPS)$/gm,
  '<h2 style="font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#7A7060;margin:20px 0 8px">$1</h2>')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F4EE;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:32px 16px">
    <div style="text-align:center;margin-bottom:32px">
      <div style="font-size:24px;font-weight:600;color:#2C2416">Nourish<span style="color:#3D5A3E">Plan</span></div>
      <div style="font-size:13px;color:#7A7060;margin-top:4px">Your personalized weekly meal plan</div>
    </div>
    <div style="background:#3D5A3E;border-radius:12px;padding:28px;text-align:center;margin-bottom:24px">
      <div style="color:#C8DFC8;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px">Ready to cook</div>
      <div style="color:white;font-size:26px;font-weight:600;margin-bottom:4px">Hi ${clientData.name} 👋</div>
      <div style="color:#A8CCA8;font-size:14px">Your ${clientData.goal} meal plan is ready.</div>
    </div>
    <div style="background:white;border:1px solid #DDD8CC;border-radius:12px;padding:20px;margin-bottom:24px">
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#7A7060;margin-bottom:12px">Your targets</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:80px;background:#F7F4EE;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:11px;color:#7A7060">Goal</div>
          <div style="font-size:13px;font-weight:600;color:#2C2416;margin-top:2px">${clientData.goal}</div>
        </div>
        <div style="flex:1;min-width:80px;background:#F7F4EE;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:11px;color:#7A7060">Macros</div>
          <div style="font-size:13px;font-weight:600;color:#2C2416;margin-top:2px">${clientData.macro.split('(')[0].trim()}</div>
        </div>
        <div style="flex:1;min-width:80px;background:#F7F4EE;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:11px;color:#7A7060">Budget</div>
          <div style="font-size:13px;font-weight:600;color:#2C2416;margin-top:2px">${clientData.budget}/wk</div>
        </div>
        <div style="flex:1;min-width:80px;background:#F7F4EE;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:11px;color:#7A7060">Household</div>
          <div style="font-size:13px;font-weight:600;color:#2C2416;margin-top:2px">${clientData.household} person(s)</div>
        </div>
      </div>
    </div>
    <div style="background:white;border:1px solid #DDD8CC;border-radius:12px;padding:24px;margin-bottom:24px;font-size:14px;line-height:1.8;color:#2C2416">
      ${formatted}
    </div>
    <div style="background:white;border:1px solid #DDD8CC;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px">
      <div style="font-size:15px;font-weight:600;color:#2C2416;margin-bottom:6px">Want a fresh plan every week?</div>
      <div style="font-size:13px;color:#7A7060;margin-bottom:16px">Reply to this email and we'll set it up for you.</div>
      <a href="https://nourishplan.onrender.com" style="display:inline-block;background:#3D5A3E;color:white;padding:12px 28px;border-radius:100px;text-decoration:none;font-size:14px;font-weight:500">Generate another plan</a>
    </div>
    <div style="text-align:center;font-size:12px;color:#7A7060;line-height:1.6">
      NourishPlan · No groceries sold · No spam<br>
      You received this because you requested a meal plan.
    </div>
  </div>
</body>
</html>`;
}

const mealLabelMap = {
  '2 meals + snacks': ['MEAL 1', 'MEAL 2', 'SNACK'],
  '3 meals': ['BREAKFAST', 'LUNCH', 'DINNER'],
  '3 meals + snacks': ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'],
  '4-5 smaller meals': ['MEAL 1', 'MEAL 2', 'MEAL 3', 'MEAL 4', 'MEAL 5']
};

function buildPrompt(d) {
 console.log('d.meals raw value:', JSON.stringify(d.meals));
 console.log('labels resolved:', labels);
 console.log('hasSnack:', hasSnack);
  const labels = mealLabelMap[d.meals] || ['MEAL 1', 'MEAL 2', 'MEAL 3'];
  const allowedLabels = labels.join(', ');
  const hasSnack = labels.includes('SNACK');
  const mealCount = labels.filter(l => l !== 'SNACK').length;
  const mealStructureInstruction = `Each day must contain EXACTLY these meal sections in this order: ${allowedLabels}. Use ONLY these labels. Do not add, rename, or reorder them.`;
  const favoriteMeal = (d.biggestMeal || 'Dinner (evening)');

  const isSnack = (label) => label === 'SNACK';
  const mealDayTemplate = `DAY [number] — [DAY NAME]

${labels.map(label => isSnack(label)
  ? `${label}: [Snack Name — simple, no cooking, ~200 cal]
Ingredients:
- [ingredient] — [quantity]
Macros: [X] cal | [X]g protein | [X]g carbs | [X]g fat`
  : `${label}: [Meal Name]
Ingredients:
- [ingredient] — [quantity for ${d.household} person(s)]
Instructions:
1. [Step]
Macros: [X] cal | [X]g protein | [X]g carbs | [X]g fat
Prep time: [X] min`
).join('\n')}`;

  // Calorie math
  const weight = parseFloat(d.weight) || 180;
  const age = parseFloat(d.age) || 30;
  const isMale = (d.sex || '').toLowerCase().includes('male');
  const bmr = isMale
    ? Math.round(10 * weight * 0.453592 + 6.25 * 170 - 5 * age + 5)
    : Math.round(10 * weight * 0.453592 + 6.25 * 170 - 5 * age - 161);
  const tdee = Math.round(bmr * 1.2);
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

const systemPrompt =
`You are an elite registered dietitian generating structured meal plans.

RULES YOU NEVER BREAK:

1. MEAL STRUCTURE: ${mealStructureInstruction}
   CRITICAL: The words BREAKFAST, LUNCH, and DINNER are FORBIDDEN unless they appear in the labels above. Do not use them as section headers under any circumstances.
   ${hasSnack ? 'The label SNACK must appear exactly once per day. Never substitute BREAKFAST for SNACK.' : ''}

2. MEAL COUNT: Every day has exactly ${labels.length} section(s): ${allowedLabels}. Never add or remove sections.

3. FAVORITE MEAL: The client selected "${favoriteMeal}" as their favorite meal. Make it the most generous, satisfying, and calorie-rich meal of the day. Target approximately ${favCals} calories for this meal. Other meals target approximately ${otherCals} calories each.${hasSnack ? ' SNACK targets exactly 200 calories.' : ''}

4. COMPLETE ALL DAYS: Write all ${d.days} days in full before writing the grocery list. Never skip ahead.

5. PLAIN TEXT ONLY: No markdown, no asterisks, no bold, no # headers. Use bullet symbol for lists and ═ for dividers.

6. BANNED INGREDIENTS: ${d.hardAllergies || 'None'} — never appear in any meal or the grocery list.`;

  const userPrompt = `Generate a complete ${d.days}-day meal plan for this client.

CLIENT:
- Name: ${d.name || 'Client'} | Age: ${d.age} | Sex: ${d.sex} | Height: ${d.height} | Weight: ${d.weight} lbs
- Activity: ${d.activity} | Goal: ${d.goal} | Macros: ${d.macro}
- Household: ${d.household} person(s) | Days: ${d.days} | Budget: ${d.budget || '$150'}/wk

DAILY STRUCTURE: ${allowedLabels}
FAVORITE MEAL: ${favoriteMeal} — make this the most satisfying and calorie-rich meal (~${favCals} cal)
${mealCount > 1 ? `OTHER MEALS: approximately ${otherCals} calories each` : ''}
${hasSnack ? 'SNACK: always ~200 calories, simple, no cooking required' : ''}

PROTEINS: ${d.proteins || 'No preference'}
EQUIPMENT: ${d.equipment || 'Standard kitchen'}
ALLERGIES BANNED: ${d.hardAllergies || 'None'}
RESTRICTIONS: ${d.restrictions || 'None'}
CUISINE: ${d.cuisine || 'No preference'}
AVOID: ${d.dislikes || 'None'}
SKILL: ${d.skill} | REPEATS OK: ${d.mealRepeat || 'Somewhat'} | TRACKS: ${d.tracking || 'No'}
HEALTH CONTEXT: ${d.healthContext || 'None'}
NOTES: ${d.notes || 'None'}

Scale all quantities for ${d.household} person(s). Macros are for the full household serving.

CALORIE & MACRO TARGETS
Daily calories: ${goalCalories} cal
Protein: ${protein}g | Carbs: ${carbs}g | Fat: ${fat}g
Strategy: ${Math.abs(goalCalories - tdee)} calorie ${goalCalories < tdee ? 'deficit' : 'surplus'} from TDEE of ${tdee} to support ${d.goal.toLowerCase()}.

Use this exact format for every day — no deviations:

${mealDayTemplate}

Write Day 1 through Day ${d.days} completely. Do not skip any day. Do not write the grocery list until all ${d.days} days are done.

After all days are written:

═══════════════════════════════════════
WEEKLY GROCERY LIST
═══════════════════════════════════════

PRODUCE:
- [item] — [total quantity for the week]

PROTEIN & MEAT:
- [item] — [total]

DAIRY & EGGS:
- [item] — [total]

PANTRY & DRY GOODS:
- [item] — [total]

FROZEN:
- [item] — [total]

ESTIMATED TOTAL: $XX-$XX
(Budget: ${d.budget || '$150'} | ${d.household} person(s), ${d.days} days)

═══════════════════════════════════════
MEAL PREP TIPS
═══════════════════════════════════════
1. [Tip specific to their cooking style and equipment]
2. [Batch cooking suggestion based on their meals]
3. [Storage tip]
4. [Budget tip]
5. [Macro tracking tip based on their tracking level]

Allowed meal labels: ${allowedLabels} only. Plain text only. No markdown.`;

  return { systemPrompt, userPrompt };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Meal Plan Generator running on port ${PORT}`);
});
