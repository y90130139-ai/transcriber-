"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEXICONS = exports.TOPIC_WORDS = exports.HOOK_WORDS = exports.PERSONA_WORDS = exports.FORMAT_WORDS = void 0;
exports.FORMAT_WORDS = {
    grwm: ['get ready with me', 'grwm', 'getting ready with me', 'doing my makeup', 'get ready with'],
    storytime: ['story time', 'storytime', 'let me tell you', 'so basically', 'long story short', 'you will not believe'],
    'q-and-a': ['q and a', 'q&a', 'you asked', 'someone asked me', 'answering your questions', 'you guys asked'],
    'day-in-life': ['day in my life', 'day in the life', 'my whole day', 'a day with me'],
    'fit-check': ['fit check', 'outfit of the day', 'ootd', "what i'm wearing", 'this outfit'],
    'try-on': ['try on', 'try-on', 'trying on', 'haul', 'unboxing'],
    gym: ['gym', 'workout', 'leg day', 'reps', 'lifting', 'deadlift', 'squats', 'at the gym'],
    'pov-skit': ['pov', 'point of view', 'when your'],
    comedy: ['joke', 'i am crying', "i'm crying", 'funniest', 'made me laugh', 'lmao'],
    reaction: ['reacting to', 'my reaction', 'react to', 'reaction video'],
    'lip-sync': ['lip sync', 'lipsync', 'lip syncing'],
    bts: ['behind the scenes', 'bts', 'how i shot', 'setting up the shot'],
    promo: ['link in bio', 'link in my bio', 'use code', 'discount code', 'my page', 'subscribe', 'onlyfans', 'sign up', 'dm me', 'check me out'],
    advice: ["here's how", 'here is how', 'how to', 'pro tip', 'the trick is', 'my advice', 'you should try'],
    rant: ['so tired of', 'can we talk about', 'i hate when', 'why do people', 'sick of', 'rant'],
    collab: ['my friend', 'collab', 'featuring', 'with my girl', 'we filmed'],
    teaser: ['full video', 'coming soon', 'part two', 'part 2', 'wait for part', 'teaser', 'preview'],
    'street-interview': ['excuse me', 'can i ask you', 'what do you think about', 'random question', 'asking strangers', 'do you mind if'],
    'rage-bait': ['unpopular opinion', 'i said what i said', 'hot take', 'controversial', 'fight me', "don't @ me", "you're wrong", 'delusional'],
    'snap-banner': ['snapchat', 'add me on snap', 'my snap', 'sc:', 'snap:'],
    dance: ['dance', 'dancing', 'choreo', 'this trend', 'the routine'],
    // The three the manual starts every creator on — Talking (Car Confessions),
    // Thirst Traps, Captions — could not be named here before, and nor could the
    // categories it says to research: mirror, reveal, confession.
    mirror: ['mirror selfie', 'in the mirror', 'mirror pic', 'mirror check'],
    reveal: ['wait for it', 'the reveal', 'watch till the end', 'wait till the end', 'before and after', 'glow up'],
    confession: ['i have a confession', 'confession', 'i never told anyone', 'i have to admit', 'can i be honest', 'nobody knows this'],
    'car-confession': ['car confession', 'in my car', 'sitting in my car', 'car talk', 'in the car'],
    'thirst-trap': ['thirst trap'],
    'text-overlay': [],
    'talking-head': [],
    skit: [],
};
exports.PERSONA_WORDS = {
    fitness: ['gym', 'workout', 'lifting', 'macros', 'training', 'reps', 'protein'],
    gfe: ['babe', 'baby', 'miss you', 'goodnight', 'my love', 'sweetheart'],
    domme: ['obey', 'kneel', 'good boy', 'on your knees', 'mistress', 'femdom'],
    'brat-sub': ['brat', 'make me', 'yes daddy', 'submissive'],
    findom: ['tribute', 'paypig', 'findom', 'my wallet', 'drain my'],
    'cosplay-gaming': ['cosplay', 'anime', 'genshin', 'gamer', 'twitch', 'streaming', 'valorant', 'league of legends'],
    'alt-goth': ['goth', 'emo', 'alt girl', 'metal', 'black lipstick'],
    'e-girl': ['egirl', 'e-girl', 'discord', 'my server'],
    'milf-mature': ['milf', 'mom of', 'mommy', 'my kids', 'cougar'],
    latina: ['latina', 'colombiana', 'mexicana', 'venezolana', 'dominicana', 'boricua', 'mi amor', 'papi chulo', 'en espanol', 'en español', 'hablo espanol', 'hispanic'],
    'toxic-gf': ['toxic', 'my ex', 'blocked him', 'his phone', 'jealous', 'we broke up', 'he cheated', 'crazy girlfriend', 'psycho girlfriend', 'red flag', 'delulu', 'left me on read'],
    pregnant: ['pregnant', 'my bump', 'baby bump', 'weeks pregnant', 'due date', 'expecting', 'maternity', 'third trimester'],
    postpartum: ['postpartum', 'gave birth', 'after the baby', 'newborn', 'post baby body', 'baby weight'],
    // 'pumping' and 'nursing' on their own belong to the gym and to nursing school,
    // so they are qualified rather than dropped.
    lactation: ['lactating', 'lactation', 'breastfeeding', 'breast milk', 'pumping milk', 'my milk', 'nursing my'],
    petite: ['petite', 'tiny', 'five foot', "5'0", 'so small'],
    'curvy-bbw': ['curvy', 'bbw', 'thick', 'plus size'],
    // Whole-word matching keeps 'butt' off 'button' and 'tits' off 'titles'.
    // Persona still needs two hits, so a single passing mention will not stick.
    'big-boobs': ['boobs', 'boobies', 'tits', 'titties', 'busty', 'cleavage', 'chesty'],
    'big-booty': ['booty', 'butt', 'twerk', 'thicc', 'bubble butt', 'cheeks'],
    'bimbo-hyperfem': ['bimbo', 'barbie', 'so pink', 'hyperfem'],
    tomboy: ['tomboy', 'one of the guys', 'skater'],
    inked: ['tattoo', 'tattoos', 'tatted', 'piercing', 'piercings'],
    'sports-cheer': ['cheer', 'soccer', 'volleyball', 'jersey', 'game day', 'basketball'],
    'uniform-roleplay': ['nurse', 'schoolgirl', 'maid outfit', 'uniform', 'cop', 'flight attendant'],
    feet: ['feet', 'toes', 'soles', 'my feet'],
    asmr: ['asmr', 'whisper', 'tingles', 'tapping'],
    couples: ['my boyfriend', 'my husband', 'my partner', 'we both'],
    'luxury-glam': ['designer', 'louis vuitton', 'chanel', 'luxury', 'private jet', 'penthouse'],
    'soft-cottagecore': ['cottage', 'my garden', 'baking', 'picking flowers', 'linen'],
    trans: ['trans', 't-girl', 'transitioning'],
    amateur: ['just my phone', 'no filter', 'unedited', 'no makeup'],
    faceless: ['faceless', 'never show my face', 'no face', 'you never see my face'],
    'girl-next-door': [],
};
/** Openers that decide how the first three seconds work. */
exports.HOOK_WORDS = {
    question: ['who', 'what', 'when', 'where', 'why', 'how', 'do', 'does', 'did', 'is', 'are',
        'can', 'could', 'would', 'should', 'have', 'has', 'am', 'will', 'would'],
    address: ['you', 'your', "you're", 'yall', "y'all", 'hey', 'hi', 'guys', 'listen', 'babe', 'girl', 'bro'],
    contrast: ['everyone thinks', 'nobody tells you', "you'd think", 'but actually', 'instead of',
        'the truth is', 'most people', 'everybody says', 'no one talks about', 'i used to',
        "i can't date", 'i prefer', 'the only', 'nobody', 'no one', 'everyone',
        'vs', 'versus'],
    transition: ['wait for it', 'watch this', 'three two one', '3 2 1', 'before and after', 'keep watching', 'watch till the end'],
    midThought: ['and', 'so', 'but', 'because', 'then', 'anyway', 'also', 'wait', 'okay', 'ok'],
    /** An opening that starts straight into a first-person statement. */
    firstPerson: ['i', "i'm", 'im', "i've", 'my', 'me', 'we', 'having', 'being'],
    /** Openers that name a scenario instead of making a claim about it.
     *
     *  `POV:` is explicit and needs no gate. The other two are the same move
     *  without the label: a `when …` clause with nothing to answer, and a person
     *  caught mid-action — `me watching`, `my boss seeing`. All three ask the
     *  viewer to recognise themselves, which is a different job from a question
     *  or a text claim and is why they get their own tag. */
    povLabel: ['pov'],
    /** Who a scenario clause is hung on. People only: `me watching` is a scene,
     *  and the same rule on any noun would make `my coffee going cold` one too. */
    povSubject: ['me', 'my', 'him', 'his', 'her', 'us', 'we', 'our', 'them', 'their'],
    /** Words that end in -ing without being a verb, so `my morning routine` is
     *  not read as somebody caught mid-action. */
    notGerunds: ['thing', 'things', 'nothing', 'something', 'anything', 'everything',
        'morning', 'evening', 'during', 'ceiling', 'sibling', 'darling',
        'string', 'spring', 'clothing', 'wedding', 'ring', 'king', 'wing'],
    /** Who a caption's closing beat points at.
     *
     *  The most common hook shape in this corpus is two beats where the second
     *  one is short and names a person: `how normal people cross their legs:` /
     *  `me:`, or `Women showing basic communication skills and empathy` /
     *  `Men: Sex?`. Both are comparisons. Read beat-by-beat they look like
     *  questions, because `how` opens one and the other ends in a question mark,
     *  and the question branch used to win outright.
     *
     *  Whole words only, and only against a beat short enough to be a punchline
     *  rather than a sentence — `Even though I'm a 41yo mom I'm still the reason
     *  someone is...` names a person too, and is not this shape. */
    selfReference: ['i', "i'm", 'im', 'me', 'my', 'mine', 'we', 'us', 'our',
        'he', 'him', 'his', 'she', 'her', 'hers', 'they', 'them',
        'you', 'your', "you're", 'men', 'women', 'girls', 'guys',
        'boys', 'meanwhile'],
};
/** What a video is ABOUT.
 *
 * The axis that was missing until 2026-09-22: 43 golf reels sat in the library
 * with nothing saying they were golf, so the golf model got generic tests.
 * Phrases are deliberately specific — "tee off" rather than "tee", "shot" only
 * with a golf word beside it — because a topic that over-fires routes a
 * stranger's reel to a model whose whole account is the subject.
 *
 * `relatable` and `unknown` are never keyed here: the first is what is left
 * when a reel is funny and about nothing (decided in autotag), the second is
 * what is left when nothing at all matched.
 */
exports.TOPIC_WORDS = {
    golf: ['golf', 'golfing', 'golf course', 'driving range', 'putt', 'putting', 'birdie', 'bogey',
        'par 3', 'par 5', 'tee off', 'tee box', 'fairway', 'caddie', 'golf cart', 'my swing',
        'topgolf', 'nine holes', '18 holes', 'golf sim'],
    cars: ['my car', 'his car', 'the car', 'truck', 'mustang', 'bmw', 'corvette', 'porsche', 'jeep',
        'drifting', 'car meet', 'horsepower', 'stick shift', 'test drive', 'new whip', 'engine',
        'dealership', 'road trip'],
    gym: ['gym', 'workout', 'leg day', 'deadlift', 'squats', 'bench press', 'reps', 'personal trainer',
        'pre workout', 'lifting', 'at the gym', 'cardio', 'my split', 'pilates', 'crossfit'],
    gaming: ['gaming', 'gamer', 'twitch', 'stream', 'anime', 'cosplay', 'call of duty', 'fortnite',
        'minecraft', 'valorant', 'xbox', 'playstation', 'my setup', 'speedrun', 'manga'],
    chess: ['chess', 'checkmate', 'grandmaster', 'poker', 'blackjack', 'texas holdem', 'casino',
        'board game', 'dungeons and dragons', 'card game'],
    food: ['recipe', 'cooking', 'i cooked', 'air fryer', 'restaurant', 'this meal', 'taste test',
        'my coffee', 'starbucks', 'dinner', 'breakfast', 'meal prep', 'baking', 'margarita'],
    travel: ['airport', 'my flight', 'hotel room', 'this trip', 'vacation', 'airbnb', 'road tripping',
        'landed in', 'travelling', 'traveling', 'cruise', 'passport', 'tourist'],
    pets: ['my dog', 'my cat', 'puppy', 'kitten', 'my horse', 'vet', 'shelter dog', 'good boy',
        'she is a rescue', 'my pup'],
    medical: ['nurse', 'nursing', 'scrubs', 'night shift', 'my patients', 'the er', 'hospital',
        'clinicals', 'nursing school', 'med surg', 'charting'],
    college: ['college', 'campus', 'my dorm', 'finals', 'my professor', 'lecture', 'sorority',
        'freshman', 'student loans', 'my major', 'exam'],
    motherhood: ['my kids', 'my son', 'my daughter', 'mom life', 'toddler', 'school run', 'my baby',
        'being a mom', 'single mom', 'nap time', 'daycare'],
    outdoors: ['fishing', 'caught a fish', 'hunting', 'camping', 'hiking', 'the lake', 'kayak',
        'campfire', 'four wheeler', 'atv', 'the cabin', 'deer season'],
    'sports-fan': ['game day', 'my team', 'touchdown', 'super bowl', 'nfl', 'nba', 'football game',
        'baseball game', 'hockey', 'the playoffs', 'my jersey', 'tailgate'],
    music: ['concert', 'festival', 'the dj', 'the club', 'my playlist', 'this song is', 'karaoke',
        'rave', 'front row', 'night out', 'the bar last night'],
    trivia: ['did you know', 'fun fact', 'fact:', 'most people do not know', 'here is why',
        'the reason is', 'in history', 'scientists', 'studies show', 'actually means'],
    work: ['my boss', 'my shift', 'my job', 'quit my job', 'nine to five', '9 to 5', 'corporate',
        'paycheck', 'my coworker', 'side hustle', 'work from home', 'clocked in', 'minimum wage'],
    dating: ['my ex', 'first date', 'talking stage', 'situationship', 'my boyfriend', 'red flag',
        'dating apps', 'hinge', 'tinder', 'he texted', 'love bombing', 'ghosted me'],
};
exports.LEXICONS = {
    format: exports.FORMAT_WORDS,
    persona: exports.PERSONA_WORDS,
    topic: exports.TOPIC_WORDS,
};
