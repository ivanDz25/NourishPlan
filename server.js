const express = require('express');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Generate plan + send email
app.post('/generate', async (req, res) => {
  const { clientData } = req.body;

  if (!clientData) {
    return res.status(400).json({ error: 'Missing clientData' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured. Add ANTHROPIC_API_KEY to Replit Secrets.' });
  }

  const prompt = buildPrompt(clientData);

  try {
    // Generate plan
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 20000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'Anthropic API error' });
    }

    const data = await response.json();
let text = data.content?.map(b => b.text || '').join('') || '';
    
    // Strip markdown that slips through
    text = text
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s+/gm, '')
      .replace(/`{1,3}[^`]*`{1,3}/g, '')
      .replace(/^[-]{3,}$/gm, '─────────────────────────')
      .replace(/^\s*[-*]\s+/gm, '• ');

    // Send email async — don't block the response
    if (clientData.email && process.env.RESEND_API_KEY) {
      sendEmail(clientData, text).catch(err => console.error('Email error:', err));
    }

    res.json({ plan: text });

  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Send plan via Resend
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
  // Convert plain text plan to readable HTML for email
  const escaped = planText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const formatted = escaped
    .replace(/═+/g, '<hr style="border:1px solid #DDD8CC;margin:16px 0">')
    .replace(/─+/g, '<hr style="border:0.5px solid #EEE;margin:8px 0">')
    .replace(/^(DAY \d+ —.+)$/gm, '<h3 style="color:#3D5A3E;font-size:15px;margin:20px 0 4px">$1</h3>')
    .replace(/^(MEAL \d+:.+)$/gm, '<strong style="color:#2C2416">$1</strong>')
    .replace(/^(CALORIE & MACRO TARGETS|7-DAY MEAL PLAN|WEEKLY GROCERY LIST|MEAL PREP TIPS)$/gm,
      '<h2 style="font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#7A7060;margin:20px 0 8px">$1</h2>')
    .replace(/\n/g, '<br>');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F4EE;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:32px 16px">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px">
      <div style="font-size:24px;font-weight:600;color:#2C2416">Nourish<span style="color:#3D5A3E">Plan</span></div>
      <div style="font-size:13px;color:#7A7060;margin-top:4px">Your personalized weekly meal plan</div>
    </div>

    <!-- Hero -->
    <div style="background:#3D5A3E;border-radius:12px;padding:28px;text-align:center;margin-bottom:24px">
      <div style="color:#C8DFC8;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px">Ready to cook</div>
      <div style="color:white;font-size:26px;font-weight:600;margin-bottom:4px">Hi ${clientData.name} 👋</div>
      <div style="color:#A8CCA8;font-size:14px">Your ${clientData.goal} meal plan is ready. Everything you need is below.</div>
    </div>

    <!-- Macro summary -->
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

    <!-- Plan content -->
    <div style="background:white;border:1px solid #DDD8CC;border-radius:12px;padding:24px;margin-bottom:24px;font-size:14px;line-height:1.8;color:#2C2416">
      ${formatted}
    </div>

    <!-- CTA -->
    <div style="background:white;border:1px solid #DDD8CC;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px">
      <div style="font-size:15px;font-weight:600;color:#2C2416;margin-bottom:6px">Want a fresh plan every week?</div>
      <div style="font-size:13px;color:#7A7060;margin-bottom:16px">Reply to this email and we'll set it up for you.</div>
      <a href="https://mealplanreplitzip--iediaz61.replit.app" style="display:inline-block;background:#3D5A3E;color:white;padding:12px 28px;border-radius:100px;text-decoration:none;font-size:14px;font-weight:500">Generate another plan</a>
    </div>

    <!-- Footer -->
    <div style="text-align:center;font-size:12px;color:#7A7060;line-height:1.6">
      NourishPlan · No groceries sold · No spam<br>
      You received this because you requested a meal plan.
    </div>
  </div>
</body>
</html>`;
}

function buildPrompt(d) {
return `You are an elite registered dietitian and meal prep specialist with 15 years of experience working with families and individuals to hit specific body composition goals. Your meal plans are known for being practical, realistic, and precisely calibrated to the client's lifestyle, equipment, household size, and macro targets.

Your job is to generate a complete, detailed ${d.days}-day meal plan for the client below. Every meal must be something a real person would actually cook and eat. Quantities must be scaled exactly for ${d.household} person(s). Macros must be calculated accurately — not estimated loosely.

RULES YOU NEVER BREAK:
- Every ingredient quantity is scaled for ${d.household} person(s) — never write generic single-serving amounts
- Macros are calculated per the full household serving shown, not per person
- Hard allergies listed are completely absent from every meal and the grocery list — no exceptions
- Only use proteins the client listed as preferred
- Only use cooking methods their equipment supports
- If biggest meal is ${d.biggestMeal}, that meal gets the most calories and protein that day
- If repeat tolerance is low, every meal across the week is unique
- If macro tracking level is detailed, give precise gram-level numbers; if beginner, round to nearest 5g
- Meals must be practical — real cook times, real techniques, nothing requiring restaurant equipment
CLIENT PROFILE:
- Name: ${d.name || 'Client'}
- Age: ${d.age} | Sex: ${d.sex} | Height: ${d.height} | Weight: ${d.weight} lbs
- Activity level: ${d.activity}
- Goal: ${d.goal}
- Macro preference: ${d.macro}
- Household size: ${d.household} person(s)
- Meals per day: ${d.meals}
- Days to cover: ${d.days} days/week
- Weekly grocery budget: ${d.budget || '$150'}

FOOD PREFERENCES:
- Preferred proteins: ${d.proteins || 'No preference'}
- Dietary style/restrictions: ${d.restrictions || 'None'}
- Hard allergies (AVOID COMPLETELY): ${d.hardAllergies || 'None'}
- Cuisine preferences: ${d.cuisine || 'No preference'}
- Foods to avoid (preference): ${d.dislikes || 'None'}

COOKING SETUP:
- Kitchen equipment: ${d.equipment || 'Standard kitchen'}
- Cooking skill/time: ${d.skill}
- Biggest meal of day: ${d.biggestMeal || 'No preference'}
- Okay with meal repeats: ${d.mealRepeat || 'Somewhat'}
- Currently tracks macros: ${d.tracking || 'No'}

ADDITIONAL NOTES: ${d.notes || 'None'}
HEALTH CONTEXT: ${d.healthContext || 'None'}

PERSONALIZATION RULES:
- Only use proteins the client listed as preferred
- Only use cooking methods compatible with their equipment
- If biggest meal is dinner, put more calories/protein there
- If they dislike repeats, ensure every meal is unique
- If they track carefully, be very precise with macro numbers
- If they are a beginner tracker, keep meals simple and easy to log
- Hard allergies must be completely absent from ALL meals and the grocery list
- Scale all quantities for ${d.household} person(s)
- If HEALTH CONTEXT is provided, treat it as a primary dietary filter. Adjust every meal to support the stated condition — anti-inflammatory, gut-friendly, kidney-friendly, nerve-supportive, etc. as appropriate. This overrides generic preferences where there is conflict.

OUTPUT FORMAT — follow exactly:

WEEKLY MEAL PLAN FOR ${(d.name || 'CLIENT').toUpperCase()}
Generated: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
═══════════════════════════════════════

CALORIE & MACRO TARGETS
Daily calories: [calculate TDEE from stats and adjust for goal]
Protein: Xg | Carbs: Xg | Fat: Xg
Strategy note: [1 sentence on approach for their specific goal]

═══════════════════════════════════════
${d.days}-DAY MEAL PLAN
═══════════════════════════════════════

Generate exactly ${d.days} days starting Monday. Do not generate more days than this number.

For each day, use EXACTLY this format with no deviations:

DAY [number] — [DAY NAME]
=====================================

BREAKFAST: [Meal Name Here]
Ingredients:
- [ingredient] — [quantity, scaled for ${d.household} person(s)]
- [ingredient] — [quantity]
Instructions:
1. [Step one — be specific, include temps, times, techniques]
2. [Step two]
3. [Continue until dish is complete — typically 4-7 steps]
Macros: [X] cal | [X]g protein | [X]g carbs | [X]g fat
Prep time: [X] min

LUNCH: [Meal Name Here]
Ingredients:
- [ingredient] — [quantity]
Instructions:
1. [Step one]
Macros: [X] cal | [X]g protein | [X]g carbs | [X]g fat
Prep time: [X] min

DINNER: [Meal Name Here]
Ingredients:
- [ingredient] — [quantity]
Instructions:
1. [Step one]
Macros: [X] cal | [X]g protein | [X]g carbs | [X]g fat
Prep time: [X] min

SNACK: [Snack Name Here]
Ingredients:
- [ingredient] — [quantity]
Instructions:
1. [Step one]
Macros: [X] cal | [X]g protein | [X]g carbs | [X]g fat
Prep time: [X] min

═══════════════════════════════════════
WEEKLY GROCERY LIST
═══════════════════════════════════════

PRODUCE:
• [item] — [total quantity needed for the week]

PROTEIN & MEAT:
• [item] — [total quantity]

DAIRY & EGGS:
• [item] — [total quantity]

PANTRY & DRY GOODS:
• [item] — [total quantity]

FROZEN:
• [item] — [total quantity]

ESTIMATED TOTAL: $XX–$XX
(Budget target: ${d.budget || '$150'} | ${d.household} person(s), ${d.days} days)

═══════════════════════════════════════
MEAL PREP TIPS
═══════════════════════════════════════
1. [Specific tip for this client's cooking style and equipment]
2. [Batch cooking suggestion based on their meals and repeat preference]
3. [Storage/prep tip]
4. [Budget-stretching tip relevant to their grocery list]
5. [Macro tracking tip calibrated to their tracking experience level]

CRITICAL FORMATTING RULES — follow exactly:
- Use PLAIN TEXT ONLY. Zero markdown. No **, no ##, no --, no >, no backticks.
- Use the exact divider characters shown above (═ and ─), nothing else.
- Bullet points use • only.
- Numbers use digits only (e.g. 180g not **180g**).
- Do not bold, italicize, or underline anything.
- Do not add extra commentary outside the format above.
- Meal labels MUST use ONLY these exact words: BREAKFAST, LUNCH, DINNER, SNACK — nothing else.
- NEVER use time-of-day labels like (Morning), (Late Morning), (Evening), (Midday), (Afternoon).
- NEVER use MEAL 1, MEAL 2 numbering.
- NEVER put the meal type in parentheses.
- Format MUST be exactly: BREAKFAST: [Meal Name] on a single line, then Ingredients: on the next line.
- Example correct: BREAKFAST: Scrambled Eggs with Turkey Sausage
- Example wrong: MEAL 1 (Breakfast): (Breakfast): Scrambled Eggs
Be thorough and specific. Real quantities, real macro numbers. No vague amounts.`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Meal Plan Generator running on port ${PORT}`);
});
