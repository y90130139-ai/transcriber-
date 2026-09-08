/** Where she is, rather than which IANA string she is in.
 *
 * A model's timezone is not trivia: it decides which week her link opens to and
 * whether a plan reads as overdue on her phone. Typing `America/New_York` by
 * hand is a silent way to get that wrong, so the sheet asks for a place and
 * this file does the translation.
 *
 * Not the whole tz database — a curated list of places a model might actually
 * be. States that genuinely straddle a line appear twice rather than being
 * quietly rounded to their bigger half.
 */

export const DEFAULT_ZONE = 'America/New_York'

export type Place = { label: string; zone: string }
export type Region = { region: string; places: Place[] }

const UNITED_STATES: Place[] = [
  { label: 'Alabama (Central)', zone: 'America/Chicago' },
  { label: 'Alaska', zone: 'America/Anchorage' },
  { label: 'Arizona (no daylight saving)', zone: 'America/Phoenix' },
  { label: 'Arkansas (Central)', zone: 'America/Chicago' },
  { label: 'California (Pacific)', zone: 'America/Los_Angeles' },
  { label: 'Colorado (Mountain)', zone: 'America/Denver' },
  { label: 'Connecticut (Eastern)', zone: 'America/New_York' },
  { label: 'Delaware (Eastern)', zone: 'America/New_York' },
  { label: 'District of Columbia (Eastern)', zone: 'America/New_York' },
  { label: 'Florida (Eastern)', zone: 'America/New_York' },
  { label: 'Florida — panhandle (Central)', zone: 'America/Chicago' },
  { label: 'Georgia (Eastern)', zone: 'America/New_York' },
  { label: 'Hawaii', zone: 'Pacific/Honolulu' },
  { label: 'Idaho (Mountain)', zone: 'America/Denver' },
  { label: 'Idaho — the panhandle (Pacific)', zone: 'America/Los_Angeles' },
  { label: 'Illinois (Central)', zone: 'America/Chicago' },
  { label: 'Indiana (Eastern)', zone: 'America/New_York' },
  { label: 'Indiana — the corners (Central)', zone: 'America/Chicago' },
  { label: 'Iowa (Central)', zone: 'America/Chicago' },
  { label: 'Kansas (Central)', zone: 'America/Chicago' },
  { label: 'Kansas — far west (Mountain)', zone: 'America/Denver' },
  { label: 'Kentucky — Louisville, Lexington (Eastern)', zone: 'America/New_York' },
  { label: 'Kentucky — the west (Central)', zone: 'America/Chicago' },
  { label: 'Louisiana (Central)', zone: 'America/Chicago' },
  { label: 'Maine (Eastern)', zone: 'America/New_York' },
  { label: 'Maryland (Eastern)', zone: 'America/New_York' },
  { label: 'Massachusetts (Eastern)', zone: 'America/New_York' },
  { label: 'Michigan (Eastern)', zone: 'America/New_York' },
  { label: 'Michigan — western UP (Central)', zone: 'America/Chicago' },
  { label: 'Minnesota (Central)', zone: 'America/Chicago' },
  { label: 'Mississippi (Central)', zone: 'America/Chicago' },
  { label: 'Missouri (Central)', zone: 'America/Chicago' },
  { label: 'Montana (Mountain)', zone: 'America/Denver' },
  { label: 'Nebraska (Central)', zone: 'America/Chicago' },
  { label: 'Nebraska — the west (Mountain)', zone: 'America/Denver' },
  { label: 'Nevada (Pacific)', zone: 'America/Los_Angeles' },
  { label: 'New Hampshire (Eastern)', zone: 'America/New_York' },
  { label: 'New Jersey (Eastern)', zone: 'America/New_York' },
  { label: 'New Mexico (Mountain)', zone: 'America/Denver' },
  { label: 'New York (Eastern)', zone: 'America/New_York' },
  { label: 'North Carolina (Eastern)', zone: 'America/New_York' },
  { label: 'North Dakota (Central)', zone: 'America/Chicago' },
  { label: 'North Dakota — the southwest (Mountain)', zone: 'America/Denver' },
  { label: 'Ohio (Eastern)', zone: 'America/New_York' },
  { label: 'Oklahoma (Central)', zone: 'America/Chicago' },
  { label: 'Oregon (Pacific)', zone: 'America/Los_Angeles' },
  { label: 'Pennsylvania (Eastern)', zone: 'America/New_York' },
  { label: 'Puerto Rico', zone: 'America/Puerto_Rico' },
  { label: 'Rhode Island (Eastern)', zone: 'America/New_York' },
  { label: 'South Carolina (Eastern)', zone: 'America/New_York' },
  { label: 'South Dakota (Central)', zone: 'America/Chicago' },
  { label: 'South Dakota — the west (Mountain)', zone: 'America/Denver' },
  { label: 'Tennessee — Nashville, Memphis (Central)', zone: 'America/Chicago' },
  { label: 'Tennessee — Knoxville, Chattanooga (Eastern)', zone: 'America/New_York' },
  { label: 'Texas (Central)', zone: 'America/Chicago' },
  { label: 'Texas — El Paso (Mountain)', zone: 'America/Denver' },
  { label: 'Utah (Mountain)', zone: 'America/Denver' },
  { label: 'Vermont (Eastern)', zone: 'America/New_York' },
  { label: 'Virginia (Eastern)', zone: 'America/New_York' },
  { label: 'Washington (Pacific)', zone: 'America/Los_Angeles' },
  { label: 'West Virginia (Eastern)', zone: 'America/New_York' },
  { label: 'Wisconsin (Central)', zone: 'America/Chicago' },
  { label: 'Wyoming (Mountain)', zone: 'America/Denver' },
]

const CANADA: Place[] = [
  { label: 'British Columbia', zone: 'America/Vancouver' },
  { label: 'Alberta', zone: 'America/Edmonton' },
  { label: 'Saskatchewan (no daylight saving)', zone: 'America/Regina' },
  { label: 'Manitoba', zone: 'America/Winnipeg' },
  { label: 'Ontario', zone: 'America/Toronto' },
  { label: 'Quebec', zone: 'America/Toronto' },
  { label: 'Nova Scotia, New Brunswick', zone: 'America/Halifax' },
  { label: 'Newfoundland', zone: 'America/St_Johns' },
]

const LATIN_AMERICA: Place[] = [
  { label: 'Mexico — Mexico City, Guadalajara', zone: 'America/Mexico_City' },
  { label: 'Mexico — Tijuana', zone: 'America/Tijuana' },
  { label: 'Mexico — Cancún', zone: 'America/Cancun' },
  { label: 'Dominican Republic', zone: 'America/Santo_Domingo' },
  { label: 'Colombia', zone: 'America/Bogota' },
  { label: 'Peru', zone: 'America/Lima' },
  { label: 'Chile', zone: 'America/Santiago' },
  { label: 'Argentina', zone: 'America/Argentina/Buenos_Aires' },
  { label: 'Brazil — São Paulo, Rio', zone: 'America/Sao_Paulo' },
]

const EUROPE: Place[] = [
  { label: 'United Kingdom', zone: 'Europe/London' },
  { label: 'Ireland', zone: 'Europe/Dublin' },
  { label: 'Portugal', zone: 'Europe/Lisbon' },
  { label: 'Spain', zone: 'Europe/Madrid' },
  { label: 'France', zone: 'Europe/Paris' },
  { label: 'Netherlands', zone: 'Europe/Amsterdam' },
  { label: 'Germany', zone: 'Europe/Berlin' },
  { label: 'Italy', zone: 'Europe/Rome' },
  { label: 'Poland', zone: 'Europe/Warsaw' },
  { label: 'Czechia, Hungary, Austria', zone: 'Europe/Prague' },
  { label: 'Romania, Bulgaria, Greece', zone: 'Europe/Bucharest' },
  { label: 'Ukraine', zone: 'Europe/Kyiv' },
  { label: 'Turkey', zone: 'Europe/Istanbul' },
  { label: 'Russia — Moscow', zone: 'Europe/Moscow' },
]

const REST: Place[] = [
  { label: 'South Africa', zone: 'Africa/Johannesburg' },
  { label: 'Nigeria', zone: 'Africa/Lagos' },
  { label: 'Kenya', zone: 'Africa/Nairobi' },
  { label: 'Egypt', zone: 'Africa/Cairo' },
  { label: 'Morocco', zone: 'Africa/Casablanca' },
  { label: 'United Arab Emirates', zone: 'Asia/Dubai' },
  { label: 'India', zone: 'Asia/Kolkata' },
  { label: 'Thailand', zone: 'Asia/Bangkok' },
  { label: 'Vietnam', zone: 'Asia/Ho_Chi_Minh' },
  { label: 'Indonesia — Jakarta', zone: 'Asia/Jakarta' },
  { label: 'Singapore, Malaysia', zone: 'Asia/Singapore' },
  { label: 'Philippines', zone: 'Asia/Manila' },
  { label: 'China', zone: 'Asia/Shanghai' },
  { label: 'South Korea', zone: 'Asia/Seoul' },
  { label: 'Japan', zone: 'Asia/Tokyo' },
  { label: 'Australia — Sydney, Melbourne', zone: 'Australia/Sydney' },
  { label: 'Australia — Brisbane', zone: 'Australia/Brisbane' },
  { label: 'Australia — Adelaide', zone: 'Australia/Adelaide' },
  { label: 'Australia — Perth', zone: 'Australia/Perth' },
  { label: 'New Zealand', zone: 'Pacific/Auckland' },
]

export const REGIONS: Region[] = [
  { region: 'United States', places: UNITED_STATES },
  { region: 'Canada', places: CANADA },
  { region: 'Latin America', places: LATIN_AMERICA },
  { region: 'Europe', places: EUROPE },
  { region: 'Rest of the world', places: REST },
]

/** Every place the picker offers, flattened. Exported because `intake.ts`
 *  has to read a place out of a sentence she typed rather than off a select. */
export const ALL_PLACES: Place[] = REGIONS.flatMap((entry) => entry.places)

const ALL = ALL_PLACES

/** Is this zone one the picker can represent? A model saved before the picker
 *  existed — or by hand — must not have her zone silently rewritten. */
export const isKnownZone = (zone: string): boolean => ALL.some((place) => place.zone === zone)

/** The first place that uses this zone, for showing what is currently set. */
export function placeFor(zone: string): string | null {
  return ALL.find((place) => place.zone === zone)?.label ?? null
}

/** What time it is where she is, right now. The one thing that proves the
 *  picker chose the place actually meant. */
export function timeIn(zone: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date())
  } catch {
    return null
  }
}

/* ---------------------------------------------------------------------------
 * Places are not zones, and the select has to key on the place.
 *
 * Thirty US entries share `America/New_York`. A controlled <select> whose
 * `value` is the zone selects the *first* option matching it, so choosing
 * "New York (Eastern)" dispatched `America/New_York`, found state already on
 * `America/New_York`, re-rendered, and snapped the display back to
 * "Connecticut (Eastern)". Texas fell back to Alabama the same way. The saved
 * zone was right the whole time — the picker just could not show what was
 * picked, which is the only job a picker has.
 *
 * So the option value is the label, and `models.place` remembers it. The zone
 * stays the thing everything downstream reads; the place is a display fact
 * that also happens to be what the operator actually chose.
 * ------------------------------------------------------------------------ */

/** The zone a place sits in, or null if the label is not one of ours. */
export function zoneForPlace(label: string): string | null {
  return ALL.find((place) => place.label === label)?.zone ?? null
}

/** Is this label one the picker offers? Guards a stored place that was written
 *  before a list edit removed or renamed its entry. */
export const isKnownPlace = (label: string): boolean => zoneForPlace(label) !== null

/**
 * Which place to show for a model, preferring what she was actually set to.
 *
 * `place` is null for every model saved before this column existed, and for
 * any zone typed by hand. Falling back to `placeFor(zone)` keeps those working
 * — it just shows the first place sharing the zone, which is what the picker
 * did for everyone before. Once she is saved again the real choice sticks.
 */
export function displayPlace(place: string | null, zone: string): string | null {
  if (place && isKnownPlace(place)) return place
  return placeFor(zone)
}
