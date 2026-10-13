/**
 * The German flash-trend playbook (Geno, 2026-10-08).
 *
 * Source: German_Flash_Trends_by_Reel_Type.docx — 59 numbered formats in the
 * original, 57 kept, sorted into six reel types. Picking one in the custom-card
 * composer prefills the card with its filming direction, versions and caption.
 *
 * CONDUCT — carried from the source doc, not negotiable here:
 *   #1 and #2 are left out entirely (their captions pair a child's age with a
 *   sexualised reveal). #52 and #64 carry only their safe V2 captions — the
 *   flagged V1 lines are not in this file, so nothing downstream can pick them.
 *
 * Numbering gaps (#15, #32–33, #35–39) are the source's own; #58 was used
 * twice there, so the second one is #58b. Pure data on purpose: imported by
 * the composer and the tests.
 */

export const GERMAN_FORMAT_TAG = 'german'

export type GermanFormat = {
  /** The source doc's own number — how the team already talks about them. */
  no: string
  name: string
  direction: string
  versions: string
  caption: string
}

export type GermanType = {
  id: string
  label: string
  blurb: string
  formats: GermanFormat[]
}

export const GERMAN_TYPES: GermanType[] = [
  {
    id: 'bounce',
    label: 'Bounce / Motion Hook',
    blurb: 'Chest movement is the hook and the payoff. Minimal story, high replay; facial expression carries the rest.',
    formats: [
      { no: '5', name: 'Viral Final Clip', direction: 'Film only the final clip: the initial bounce plus a subtle aftershock movement. Built for easy repurposing.', versions: 'V1 bra · V2 tight low-cut top · V3 bikini top', caption: 'No captions' },
      { no: '14', name: 'Viral Clip Format', direction: 'Same clip, different outfit each version. High energy, strong opening hook every time.', versions: 'V1 bright bikini top · V2 black bikini top · V3 dark bra', caption: 'No captions' },
      { no: '17', name: 'Cleavage + Task Movement', direction: 'Selfie clip + an everyday task that creates natural movement (dishes, protein shaker, drying a bottle). Slightly low angle. Do not force the bounce.', versions: '7 combos: shower or bedroom selfie × dishes / shaker / water bottle / cutlery', caption: '“Sending him after-shower pics — 20 mins, no answer” (7 variants)' },
      { no: '22', name: 'Bounce Reveal (Bold Colour)', direction: 'Bold outfit colour, strong eye makeup, defined lips. Finish on a dynamic bounce reveal.', versions: 'Single version', caption: 'No captions' },
      { no: '30', name: 'Heavy Hook + Reward Bounce', direction: 'First heavy bounce is the hook, last heavy bounce is the reward. Caption lands on each bell hit.', versions: 'V1 bikini top, denim shorts, cowboy hat, eye contact · V2 low-cut top, awkward glance away', caption: 'Country list (“Cowboy boots… Emotionally unavailable cowboys”)' },
      { no: '42', name: '3 Comparisons', direction: 'Three clips, bounce speed escalates each time (slow → excited → fast, hand in hair). Film horizontally.', versions: 'V1 tight light tee · V2 bra only', caption: '“He’s cute / tall / funny” · “He likes cars / sporty / reads”' },
      { no: '43', name: 'Reverse Final Viral Clip', direction: 'Short bounce clip in a low-cut top with lots of facial expression. Editor reverses it.', versions: 'V1 light tank, no bra · V2 light baggy tee, no bra', caption: 'No captions' },
      { no: '48', name: 'Boobs on the Table', direction: 'Camera propped on a table. Short clip of resting chest onto the table. No bra.', versions: 'V1 dark tube top · V2 light tube top', caption: 'No captions' },
      { no: '53', name: 'Sweeney Meme', direction: 'Low-cut top, bounce into camera. Facial expression is key.', versions: 'V1 white tank, no cover-up · V2 tank under an open-able cardigan / zip top', caption: '“Sydney Sweeney at every given moment / on a random Tuesday”' },
      { no: '56', name: 'Fast / Slow Boob Bounce', direction: 'One clip, bounce while looking off to the side. Editor reuses it at a second speed.', versions: 'V1 corset top · V2 low-cut dress', caption: '“60fps” / “120fps”' },
      { no: '65', name: '3 Clip Bounce', direction: 'Three clips, bounce speed and over-the-shoulder expression escalate. Hair stays identical.', versions: 'V1 tank, hair down · V2 bra, hair down', caption: '“Green flag / Red flag / I can fix him” · “Athlete / Nerd / Tall skinny guy”' },
    ],
  },
  {
    id: 'outfit-switch',
    label: 'Outfit Switch & Reveal',
    blurb: 'Before → after. Covered start, a transition or removal, then the reveal. The cut is the payoff.',
    formats: [
      { no: '3', name: 'Anticipation / Size Reel', direction: 'Builds anticipation toward the outfit reveal.', versions: 'V1 tight bikini top · V2 tight cleavage bra', caption: '“It’s just a [colour] bikini” / “It’s just a D cup bra”' },
      { no: '4', name: 'Tap Anticipation', direction: 'Anticipation carried by the outfit: push-up top that looks close to spilling out.', versions: 'Single version', caption: 'No captions' },
      { no: '13', name: 'Simple Outfit Variation', direction: 'Clip 1: dangle the bra in front of camera, hip slightly visible. Clip 2: small bounce in full view wearing it.', versions: 'V1 bright bikini · V2 skimpy pyjamas · V3 lingerie', caption: 'No captions' },
      { no: '16', name: 'Split Test Series', direction: 'Start with minimal cleavage, reveal a little more by the end. Fully platform-safe.', versions: 'V1 glasses vs none · V2 high vs low waisted · V3 hair up vs down', caption: 'No captions' },
      { no: '23', name: 'Two Clip Outfit Switch', direction: 'Covered → revealing transition. Must feel intentional and confident.', versions: 'V1 pyjamas → skimpy · V2 pyjamas → lingerie · V3 full-cover → bikini · V4 sweatshirt → lingerie', caption: 'No captions' },
      { no: '25', name: 'Bed Angle Reel', direction: '“X on or… off” on the bed. The camera angle is the concept. Brand accessories: buckle, hat, denim.', versions: '7 versions: hair, ponytail, hat, glasses, shirt buttoned/unbuttoned, hoodie on/off', caption: '“Hair down or… Up” / “Hat on or… Off” (7)' },
      { no: '29', name: 'Jumper Removal Reel', direction: 'Remove a top while looking straight into the lens. Cleavage and clavicle visible.', versions: 'V1 dark hoodie · V2 light baggy tee', caption: 'Word-puzzle captions (“What I really need… read it backwards”)' },
      { no: '41', name: 'Mirror Reward', direction: 'Clip 1: covered, spray the mirror and wipe to reveal, end shocked. Clip 2: in bikini/lingerie, keep wiping, wink at the reflection.', versions: 'V1 black bikini · V2 bright bikini', caption: 'No captions' },
      { no: '52', name: 'When Your ___ Have Friends Over', direction: 'Clip 1: pyjamas and messy hair through the door frame, walk out. Clip 2: back in glam, dress and heels, flirty wave.', versions: 'V1 pyjamas → dress & heels · V2 tee & gym shorts → summer dress', caption: '“When your brother invites his friends over…” (the only cleared caption for this one)' },
      { no: '54', name: 'Simple Lingerie (Comical)', direction: 'Clip 1: dangle a shoelace. Clip 2: jump-cut to fully dressed in black with the lace worn as a belt / sash.', versions: 'V1 lace around waist · V2 lace across body', caption: '“No way you wear that out in public” / “Your casual driving fit?”' },
    ],
  },
  {
    id: 'clip-bait',
    label: 'Clip Bait / Unresolved Tease',
    blurb: 'Promise a payoff, withhold it. The cut comes right before the reveal, so viewers rewatch.',
    formats: [
      { no: '6', name: 'Hair Tie Reel', direction: 'Back camera, strong eye contact. Quick flash as the shirt lifts, then step close to camera so the shirt hem stays out of frame. Editor crops if angles miss.', versions: 'V1 neutral top, bright underwear · V2 white/patterned underwear, neutral top', caption: '“Which hairstyle do you prefer?” · “Workout with hair up or down?”' },
      { no: '10', name: 'Hook + Curiosity + Reward', direction: 'Strong hook, build anticipation, wide curious eyes. Hint of cleavage, nothing explicit. Country outfit: hat, buckle, boots, denim shorts.', versions: 'V1–4 bedroom · V5–7 bathroom, back to camera, over-shoulder top removal', caption: '“Real friend: / Casino bestie: / Real friends don’t blink:” (7)' },
      { no: '11', name: 'Rewatch Loop — No Reward', direction: 'Hat on, wide curious eyes. Ending stays unresolved so there is no full payoff.', versions: 'V1 / V2 same as reference', caption: '“Me 18 yo” / “My hormones (entering the chat)”' },
      { no: '12', name: 'Shock + Stretch', direction: 'Obvious shocked expression, hold the stretch longer to build tension. Suggestive, nothing NSFW.', versions: 'V1 / V2 same as reference', caption: '“Me trying / pretending to be a morning person”' },
      { no: '26', name: 'Build Up That Never Happens', direction: 'Playsuit or summer dress, hair great from behind, face shown throughout. Build anticipation, never deliver.', versions: 'V1 short dress that lifts as the door opens · V2 gym set', caption: 'Ladders: “When he’s 20 / 25 / 28 / 35”, “Opening the door at my friend’s / boyfriend’s / situationship’s…”, by year' },
      { no: '27', name: 'Bum-Focused Build Up', direction: 'Stronger bum-focused version of #26. Film in addition to #26, not instead.', versions: 'Single version', caption: 'Reuse #26 captions' },
      { no: '45', name: 'Spoon Reward Photos', direction: 'Clip 1: kitchen, delivery bag/pans in frame, set camera and walk back. Clip 2: four lingerie photos reflected in a spoon over a plate of food.', versions: 'V1 white tank & pants, no bra · V2 baggy tee, no bra', caption: '“Sending him pics of what I ordered…” · “When he asks what’s for dinner”' },
      { no: '46', name: 'Running Reward Skit', direction: 'Clip 1: sprint at camera from far away, stop, eye roll, shoes off, walk off. Clip 2: exaggerated roll into bed with a quick flash.', versions: 'Single version', caption: '“If your knees hurt while you’re running — TRY THIS!”' },
      { no: '47', name: 'Butt-Focused Apple Clip', direction: 'Thong or bikini bottoms, laptop/iPad covering most of the frame.', versions: 'V1 g-string · V2 bikini bottoms', caption: '“Apple choosing a password for you be like…”' },
      { no: '57', name: 'Toilet Clipbait', direction: 'Shocked → happy and “down for it.” Audio and clip bait must match the reference exactly.', versions: 'V1 shorts starting to pull down · V2 skirt/dress starting to lift', caption: 'No captions' },
      { no: '58', name: 'Counting Years Clipbait', direction: 'Low-cut top, back camera, count on fingers. Facial expression is key.', versions: 'V1 stand and count · V2 walk toward camera counting', caption: '“Counting how many years older he is… Nevermind” · “…how many inches is too much”' },
      { no: '61', name: 'Car Clipbait', direction: 'In the car, pretend to take a photo. Facial expression is key.', versions: 'V1 low-cut top, chest pic · V2 skirt/dress, lift for pic', caption: '“When he asks for a 🍒 / 🍑 picture”' },
      { no: '67', name: 'Man Clip Bait', direction: 'Clip 1: open door abruptly, glass of water. Clip 2: sip and check someone out. Clip 3: jump back, spill water down chest, close door, peek back out.', versions: 'V1 white top no bra, shorts · V2 dress', caption: 'No captions' },
    ],
  },
  {
    id: 'shower',
    label: 'Shower Series',
    blurb: 'The shower setting does the suggestive work. Forgot-the-towel and caught-off-guard premises. Batch-film these together.',
    formats: [
      { no: '7', name: 'Shower / Confused Look', direction: 'Top of cleavage visible, exaggerate the confused expression.', versions: 'V1 damp hair, no water · V2 shower on, soap in hair', caption: 'No captions' },
      { no: '28', name: 'Shower Batch', direction: 'Short, clean clips. Glance off camera like you just realised you forgot your towel.', versions: 'V1 dry hair, no soap · V2 dry hair, soap and bubbles', caption: '7 “forgot my towel” captions' },
      { no: '50', name: 'Shower Clip Bait', direction: 'One clip, water running, soap on body. Increasingly shocked expression. Editor adds the product cutaways.', versions: 'V1 loose dry hair · V2 dry bun · V3 wet hair', caption: '“He said he lived alone…” · “Showering at a man’s place for the first time”' },
      { no: '58b', name: 'Shower Hangout', direction: 'Shower head and water visible. Extremely excited, then let down. (The source numbers this 58 a second time.)', versions: 'V1 dry hair · V2 wet hair', caption: '“👦🏻: we’re not hanging out i just wanted you to shower”' },
      { no: '63', name: 'Getting Out of the Shower', direction: 'Open the towel fully to one side only. Chest and private areas stay covered.', versions: 'V1 hair down · V2 wet hair clipped up', caption: 'No captions' },
    ],
  },
  {
    id: 'facial-acting',
    label: 'Facial Acting / Reaction',
    blurb: 'Performance-led. The expression sells it; the outfit is a secondary visual hook. Good lighting on the eyes.',
    formats: [
      { no: '8', name: 'Reaction / Facial Acting', direction: 'Prioritise facial acting, eyes pop with good lighting, cleavage fully visible.', versions: 'V1 low-cut tank · V2 light bra', caption: 'No captions' },
      { no: '18', name: 'Facial Acting Focus', direction: 'Fully realistic, subtle expressions. React as if someone is actually standing there.', versions: 'V1 as reference · V2 couch, new outfit · V3 in bed', caption: '“Sending him a 🌶️ pic” (3 variants)' },
      { no: '20', name: 'Awkward Summer Dress', direction: 'Shy, awkward energy while looking polished: floral summer dress, great hair, bold lips.', versions: 'Single version', caption: 'No captions' },
      { no: '21', name: 'Webcam Embarrassment', direction: 'Phone recording, bright underwear, big shocked reaction.', versions: 'V1–2 as reference · V3–4 wider angle, door behind, someone walks in', caption: '“POV: guess I’m unemployed now” (4 variants)' },
      { no: '44', name: 'Talking Word Comparison', direction: 'Repeat one line through a run of emotions. Acting is the whole reel.', versions: 'V1 low-cut tank, “It’s so big” · V2 low-cut top, “Did you just fart?”', caption: 'Supportive / Disappointed / Angry / Sarcastic / Disgusted / Flirty' },
      { no: '55', name: 'Movie Daylight', direction: 'Clip 1: point remote, confused faces, look around. Clip 2: film the TV screen as a movie starts. Editor adds the reflection.', versions: 'V1 reference pose, low-cut tank & leggings · V2 feet on sofa, baggy tee, bare legs', caption: '“POV: Trying to watch a movie in daylight”' },
      { no: '60', name: 'Sleep Coach', direction: 'Record the top half responding to the “sleep coach.” In bed, for the visual hook.', versions: 'V1 hair up · V2 hair down', caption: '“I hired a sleep coach” / “Was it worth it?”' },
    ],
  },
  {
    id: 'skit',
    label: 'Comedic Skit / POV Story',
    blurb: 'A relatable joke or POV carries the reel; the outfit rides along. Best shares and broadest reach.',
    formats: [
      { no: '9', name: 'Comedic Role Play', direction: 'Full face visible on the look-back in clip 1. Male character: tight trousers, exaggerated acting.', versions: 'V1 / V2 same as reference', caption: '“👧 Honey I’m gonna take a shower”' },
      { no: '19', name: 'Acting & Outfit Variations', direction: 'Open as “Mum” in a dress, direct eye contact with an off-camera presence, strong performance.', versions: 'Single version', caption: 'No captions' },
      { no: '24', name: 'Honey I’m Home', direction: 'Open the door, walk through with excited jumping. Playful, believable, never overacted.', versions: 'V1 black bodycon · V2 jeans & low-cut top · V3 jeans, heels, low-cut top · V4 gym clothes', caption: '“POV: You just got home after seeing him” (4)' },
      { no: '31', name: 'Trending Format (Male + Female)', direction: 'Comedic beat, then two takes: one serious, one slightly freaked out.', versions: 'Two takes', caption: 'No captions' },
      { no: '34', name: 'American Targeting Reel', direction: 'Use a prop and a strong, funny American tone. For accounts whose audience is not US-heavy yet.', versions: 'Single version', caption: 'No captions' },
      { no: '40', name: 'Viral Clip Skit', direction: 'Door frame shows height, expressive face, low-cut top as an extra hook.', versions: 'V1 tank & denim · V2 sundress · V3 gym · V4 pyjamas + coffee · V5 bikini + sunglasses', caption: 'No captions' },
      { no: '49', name: 'Girls For No Reason', direction: 'Four everyday-chore clips, each pausing to adjust inside your top. No bra.', versions: 'V1 light tank & sweats (benchmark copy of original) · V2 dark tank & shorts', caption: 'V2: “girls literally just because”' },
      { no: '51', name: 'Date Success', direction: 'One take: walk in excited, squeal, check a text, confused pause, “what?” Editor inserts the screenshot bait.', versions: 'V1 tight evening outfit · V2 tight casual daytime outfit', caption: '“Me thinking the date was a success”' },
      { no: '62', name: 'Car Skit', direction: 'Short shorts; get into the engine bay like the reference.', versions: 'V1 denim shorts · V2 short skirt/dress', caption: 'No captions' },
      { no: '64', name: 'After Sex Comparison', direction: 'Walk through the door three times: limping and messy, then disappointed head shake, then disgusted eye roll.', versions: 'V1 reference outfit, hair down · V2 dress, pulling it down', caption: '“Skinny guy / Gym bro / DJ” (the only cleared caption for this one)' },
      { no: '66', name: 'I Have a Boyfriend', direction: 'Camera starts low and rises with each line. Outdoors if possible.', versions: 'V1 shorts & tank · V2 short dress', caption: 'Salary ladder (30k → 1m+) · height ladder (5’3 → 6’0+)' },
    ],
  },
]

/** Every format, flat, for lookups. */
export const GERMAN_FORMATS: GermanFormat[] = GERMAN_TYPES.flatMap((type) => type.formats)

export function findGerman(no: string): GermanFormat | undefined {
  return GERMAN_FORMATS.find((format) => format.no === no)
}

/** The card body a picked format prefills — the doc's row as directions. */
export function germanBrief(format: GermanFormat): string {
  return [
    format.direction,
    `Versions: ${format.versions}`,
    format.caption === 'No captions' ? 'No captions on this one.' : `Caption: ${format.caption}`,
  ].join('\n\n')
}

/**
 * The doc's versions string as the composer's version rows (Geno, 2026-10-13).
 *
 * "V1 bra · V2 tight low-cut top · V3 bikini top" becomes one row per version
 * with the marker stripped — the row draws its own V1 badge. Doc lines that
 * name no outfit at all ("Single version", "Two takes", "V1 / V2 same as
 * reference") come back as one blank row, so the card takes the shared
 * wardrobe instead of wearing "Single version" as a costume.
 */
export function germanVersionRows(versions: string): { outfit: string; caption: string }[] {
  const raw = versions.trim()
  if (!raw) return [{ outfit: '', caption: '' }]
  // "V1 / V2 same as reference" names no outfit — one row, shared wardrobe.
  if (!/·/.test(raw) && /same as reference/i.test(raw)) return [{ outfit: '', caption: '' }]
  const parts = raw
    .split(/\s*·\s*/)
    .map((part) => part.replace(/^V\d+(?:\s*[–-]\s*\d+)?[a-z]?\s*/i, '').trim())
    .map((part) => (/^as reference$/i.test(part) ? 'Same as the reference' : part))
    .filter((part) => part !== '')
  // A doc line that names no outfit at all is not a wardrobe.
  if (parts.length === 0) return [{ outfit: '', caption: '' }]
  if (parts.length === 1 && /^(single version|two takes)\b/i.test(parts[0])) {
    return [{ outfit: '', caption: '' }]
  }
  return parts.slice(0, 8).map((outfit) => ({ outfit, caption: '' }))
}
