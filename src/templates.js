/** Pre-configured site templates ("starter kits") and the shared engine
    that applies a site spec — template or AI-generated — to a company.

    A site spec is a plain object:
      { site_title?, site_description?, theme?, accent_color?, heading_font?,
        layout?,
        content_types?: [{key?, name, name_plural?, schema: [{label, kind, options?}]}],
        pages: [{title, body, format?}],
        posts: [{title, excerpt, body, tags?, format?}],
        items?: [{type, title, body, excerpt?, fields?, tags?}] }

    Applying a spec is an admin action, so starter content is inserted
    directly as `published` — the same right an admin exercises in the
    editor. Manager-authored edits to that content still go through the
    normal approval workflow afterwards. Custom content types are created
    first (existing keys are left untouched) so typed items validate
    against them. */

const { getDb, slugify, uniqueSlug } = require('./db');
const { getType, normalizeSchema, validateFields, BUILTIN_TYPES } = require('./content-types');

// Keep in sync with THEMES / HEADING_FONTS in src/routes/public.js.
const VALID_THEMES = [
  'default', 'paper', 'forest', 'ocean', 'mint', 'lavender',
  'midnight', 'slate', 'noir', 'sunset', 'terminal',
];
const VALID_FONTS = ['sans', 'serif', 'mono'];
const VALID_LAYOUTS = ['cards', 'list'];
const VALID_FORMATS = ['markdown', 'text', 'html', 'image', 'embed'];

const SETTING_KEYS = ['site_title', 'site_description', 'theme', 'accent_color', 'heading_font', 'layout'];

const TEMPLATES = [
  // ---------- Food & Hospitality ----------
  {
    key: 'cafe',
    name: 'Café & coffee shop',
    category: 'Food & Hospitality',
    description: 'A warm neighborhood storefront — paper theme, serif headings, menu page ready.',
    settings: { theme: 'paper', heading_font: 'serif', layout: 'cards', accent_color: '#b45309', site_description: 'Your neighborhood spot.' },
    pages: [
      { title: 'Menu', body: "## Coffee\n\n- Espresso — 3.50\n- Cappuccino — 4.50\n- Batch brew — 3.00\n- Seasonal single origin — ask us\n\n## Food\n\n- Morning bun — 4.00\n- Toast, jam, butter — 5.00\n- The good sandwich — 9.50\n\n*Everything baked in-house each morning.*" },
      { title: 'Visit', body: "**Hours**\n\n- Mon–Fri: 7am – 4pm\n- Sat–Sun: 8am – 5pm\n\n**Find us**\n\n123 Example Street — look for the striped awning. Bikes welcome, dogs adored." },
    ],
    posts: [
      { title: 'We are open', tags: ['News'], excerpt: 'The doors are open, the espresso is dialed in, and the first batch is out of the oven.', body: "# Come say hello\n\nAfter months of build-out, we're open.\n\nFirst week: every drink comes with something small and sweet from the oven, on us. Tell your neighbors." },
      { title: "This month's roast", tags: ['Coffee'], excerpt: 'A washed Ethiopian — bright, floral, and dangerously easy to drink.', body: "On the brew bar this month: a **washed Ethiopia Yirgacheffe**.\n\n- Tasting notes: jasmine, lemon, honey\n- Process: washed\n- Best as: pour-over, or black batch brew\n\nBeans available by the bag at the counter." },
    ],
  },
  {
    key: 'restaurant',
    name: 'Restaurant',
    category: 'Food & Hospitality',
    description: 'Dinner-service warmth — menu, reservations, and private dining, in a sunset theme.',
    settings: { theme: 'sunset', heading_font: 'serif', layout: 'list', accent_color: '#fb923c', site_description: 'Seasonal cooking, open fire, good company.' },
    pages: [
      { title: 'Menu', body: "*The menu changes with the market. A recent evening:*\n\n## To start\n\n- Sourdough, cultured butter — 6\n- Burrata, blood orange, chili crisp — 14\n- Charred leeks, romesco — 12\n\n## Mains\n\n- Half chicken off the fire, salsa verde — 26\n- Squash agnolotti, brown butter, sage — 22\n- Whole sea bream, fennel, lemon — 31\n\n## To finish\n\n- Basque cheesecake — 10\n- Chocolate tart, olive oil, sea salt — 11" },
      { title: 'Reservations', body: "We hold half the room for walk-ins; the rest books out about two weeks ahead.\n\n- **Book online** or call us at (555) 010-0000\n- Parties of 7+ — email us and we'll plan it properly\n- Cancellations: 24 hours' notice, please\n\n**Hours**: Tue–Sat, 5pm–11pm. Kitchen closes at 10." },
      { title: 'Private dining', body: "The back room seats 18 beneath the old skylight — long table, set menu, your own server.\n\nWe host birthdays, weddings-adjacent dinners, and the occasional very serious business deal. Write to events@example.com with a date and a headcount." },
    ],
    posts: [
      { title: 'The autumn menu is here', tags: ['Menu'], excerpt: 'Squash, quince, and the return of the braises.', body: "The market turned, and the menu turned with it.\n\nNew this season: squash agnolotti in brown butter, a quince tarte tatin, and the short-rib braise regulars have been asking about since March. The tomatoes have left us. They'll be back." },
      { title: 'Meet our new head chef', tags: ['News'], excerpt: 'Fifteen years of open-fire cooking, and strong opinions about anchovies.', body: "This month we welcome a new head chef to the pass — fifteen years across three kitchens, a devotion to open-fire cooking, and strong opinions about anchovies (for them).\n\nThe menu will evolve slowly. The chicken stays. The chicken always stays." },
    ],
  },
  {
    key: 'hotel',
    name: 'Boutique hotel',
    category: 'Food & Hospitality',
    description: 'Rooms as structured content — rates, views, booking links — plus a guest journal.',
    settings: { theme: 'midnight', heading_font: 'serif', layout: 'cards', accent_color: '#d4af37', site_description: 'Eleven rooms above the harbor.' },
    content_types: [
      {
        key: 'room',
        name: 'Room',
        name_plural: 'Rooms',
        schema: [
          { label: 'Sleeps', kind: 'number' },
          { label: 'Price per night (USD)', kind: 'number' },
          { label: 'View', kind: 'select', options: 'Garden, Sea, City' },
          { label: 'Book link', kind: 'url' },
        ],
      },
    ],
    items: [
      { type: 'room', title: 'The Garden Room', excerpt: 'Quiet, green, and ground-floor — our most restful double.', fields: { sleeps: 2, price_per_night_usd: 180, view: 'Garden', book_link: 'https://example.com/book/garden-room' }, body: "A calm double at the back of the house, opening onto the walled garden. King bed, rainfall shower, and the kind of quiet you forgot cities could have.\n\n- King bed, linen sheets\n- Walled-garden access\n- Breakfast included" },
      { type: 'room', title: 'The Lighthouse Suite', excerpt: 'Two rooms, one long view of the water.', fields: { sleeps: 4, price_per_night_usd: 320, view: 'Sea', book_link: 'https://example.com/book/lighthouse-suite' }, body: "The corner suite on the top floor: a bedroom, a sitting room, and the sea filling every window. Sunrise happens to you here whether you planned it or not.\n\n- Separate sitting room with sofa bed\n- Freestanding bath with a view\n- Breakfast included" },
      { type: 'room', title: 'The Attic Hideaway', excerpt: 'Sloped ceilings, city rooftops, our best-kept secret.', fields: { sleeps: 2, price_per_night_usd: 150, view: 'City', book_link: 'https://example.com/book/attic' }, body: "Up the last flight of stairs: a snug double under the eaves with rooftop views and the best reading chair in the building. Not for the tall, beloved by everyone else.\n\n- Queen bed\n- Reading nook and rooftop view\n- Breakfast included" },
    ],
    pages: [
      { title: 'Amenities', body: "## Around the house\n\n- **Breakfast**, baked in-house, 7–10:30 daily — included with every room\n- **Honesty bar** in the library, open late\n- **Walled garden** with morning sun\n- Bikes to borrow, maps we've scribbled on\n\n## Good to know\n\n- Check-in 3pm · check-out 11am\n- No pets except very good dogs (ask us)\n- The whole house can be taken over for events" },
      { title: 'Find us', body: "We're the blue door at the top of Harbor Lane — ten minutes' walk from the station, two from the water.\n\n**By train**: hourly service from the city; we'll collect your bags.\n**By car**: parking behind the house, first come first served.\n\nHarbor Lane 11 · (555) 010-0011 · stay@example.com" },
    ],
    posts: [
      { title: 'A slow-season guide to the coast', tags: ['Guides'], excerpt: 'The town is quieter, the sea is louder, and everything good stays open.', body: "The crowds leave in October. Here's why we think that's when you should arrive:\n\n1. **The walks** — the cliff path, empty, in low golden light\n2. **The food** — the fish doesn't know it's off-season\n3. **The fires** — every pub lights theirs in November\n\nRooms are quieter to book, too. We'll leave that with you." },
    ],
  },

  // ---------- Services ----------
  {
    key: 'clinic',
    name: 'Medical clinic',
    category: 'Services',
    description: 'A calm, clear practice site — services, insurance, and visiting details.',
    settings: { theme: 'mint', heading_font: 'sans', layout: 'cards', accent_color: '#0d9488', site_description: 'Primary care, without the waiting room dread.' },
    pages: [
      { title: 'Services', body: "## What we do\n\n- **Primary care** — checkups, chronic-condition management, referrals\n- **Same-day sick visits** — call before 10am, be seen today\n- **Vaccinations** — flu, travel, and childhood schedules\n- **Lab work** — drawn in-clinic, results in your portal within 48 hours\n\nWe keep 30-minute appointment slots. You will not be rushed." },
      { title: 'Insurance & billing', body: "We accept most major insurance plans — call with your card handy and we'll confirm in two minutes.\n\n**Self-pay** patients get simple flat pricing:\n\n| Visit | Price |\n|---|---|\n| Standard visit | $120 |\n| Extended visit | $180 |\n| Lab draw | from $25 |\n\nNo surprise bills. Estimates in writing before anything unusual." },
      { title: 'Visit us', body: "**Hours**\n\n- Mon–Fri: 8am – 6pm\n- Sat: 9am – 1pm (urgent visits)\n\n**Location**: 40 Cedar Avenue, Suite 2 — street parking and a ramp entrance.\n\nNew patients: bring ID, your insurance card, and a medication list. Or just bring yourself, and we'll figure it out." },
    ],
    posts: [
      { title: 'Flu season: what to know this year', tags: ['Health'], excerpt: 'Shots are in, walk-ins welcome on Saturdays through November.', body: "Flu shots are in stock as of this week.\n\n- **Walk-in Saturdays** through November, 9am–1pm\n- Free with most insurance; $30 self-pay\n- High-dose vaccine available for patients 65+\n\nGet it before the office holiday party, not after." },
    ],
  },
  {
    key: 'salon',
    name: 'Salon & spa',
    category: 'Services',
    description: 'Soft lavender look with a full price list and booking page.',
    settings: { theme: 'lavender', heading_font: 'serif', layout: 'cards', accent_color: '#7c3aed', site_description: 'Come in tangled, leave lighter.' },
    pages: [
      { title: 'Services & prices', body: "## Hair\n\n| Service | From |\n|---|---|\n| Cut & finish | $65 |\n| Color, single process | $110 |\n| Balayage | $180 |\n| Blowout | $45 |\n\n## Spa\n\n| Service | From |\n|---|---|\n| Classic facial (60 min) | $95 |\n| Deep-tissue massage (60 min) | $110 |\n| Manicure / pedicure | $35 / $55 |\n\nFirst visit? Mention it — consultations are free and unhurried." },
      { title: 'Book an appointment', body: "**Online**: book through our booking link any time.\n\n**By phone**: (555) 010-0022, Tue–Sat 9–6.\n\nRunning late? Text us — we hold your slot for 15 minutes. Life happens.\n\n**Gift cards** available in any amount, beautifully wrapped, dangerously easy to buy." },
    ],
    posts: [
      { title: 'Winter skin, handled', tags: ['Tips'], excerpt: 'Three things your face wants from you between November and March.', body: "The heating is on and your skin has noticed. Three things that actually help:\n\n1. **Shorter, cooler showers** — sorry\n2. **A thicker moisturizer at night** — your summer one is not enough\n3. **One good facial a season** — we rebuild the barrier, you keep it\n\nBook the winter facial and we'll send you home with a sample routine." },
    ],
  },
  {
    key: 'fitness',
    name: 'Fitness studio',
    category: 'Services',
    description: 'A bold dark studio site with a structured class schedule.',
    settings: { theme: 'noir', heading_font: 'sans', layout: 'list', accent_color: '#22c55e', site_description: 'Strength, intervals, and no mirrors culture.' },
    content_types: [
      {
        key: 'class',
        name: 'Class',
        name_plural: 'Classes',
        schema: [
          { label: 'Day', kind: 'select', options: 'Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday' },
          { label: 'Time', kind: 'text' },
          { label: 'Coach', kind: 'text' },
          { label: 'Level', kind: 'select', options: 'All levels, Beginner, Advanced' },
        ],
      },
    ],
    items: [
      { type: 'class', title: 'Strength Foundations', excerpt: 'The barbell basics, coached properly.', fields: { day: 'Monday', time: '18:00', coach: 'Sam', level: 'Beginner' }, body: "Squat, hinge, press, pull — the four patterns everything else is built on. Small group, light loads, heavy attention to form.\n\nBring shoes with a flat sole. We provide everything else, including patience." },
      { type: 'class', title: 'Sunrise Intervals', excerpt: '45 minutes, done before your first meeting.', fields: { day: 'Wednesday', time: '06:30', coach: 'Ana', level: 'All levels' }, body: "Rowers, bikes, and sleds in rotating blocks. Scaled to whatever you have in the tank at 6:30am — which we understand may not be much.\n\nCoffee downstairs afterward is not optional. It's tradition." },
      { type: 'class', title: 'Open Lifting', excerpt: 'The platform is yours; a coach is on the floor.', fields: { day: 'Saturday', time: '10:00', coach: 'Marcus', level: 'Advanced' }, body: "Three hours of open platforms for members who know their way around a barbell. A coach is always on the floor for technique checks and spotting.\n\nChalk permitted. Deadlift playlists tolerated." },
    ],
    pages: [
      { title: 'Memberships', body: "| Plan | Price | Includes |\n|---|---|---|\n| Drop-in | $22 | Any single class |\n| 8 classes / month | $120 | Rollover up to 4 |\n| Unlimited | $165 | Everything, incl. open gym |\n\nNo joining fees, no 12-month traps. Pause any month, twice a year." },
      { title: 'The space', body: "2,000 square feet, six platforms, no mirrors.\n\nWe built the studio around coaching, not machines: barbells, dumbbells to 50kg, rowers, bikes, sleds, and a turf strip. Showers, lockers, and good water pressure.\n\nFirst class is free. Come see it." },
    ],
    posts: [
      { title: 'New: Saturday open lifting', tags: ['News'], excerpt: 'Three hours of open platforms with a coach on the floor.', body: "By popular demand: Saturday mornings are now **open lifting**, 10am–1pm.\n\nIncluded in unlimited memberships, $15 for everyone else. See the Classes list for details." },
    ],
  },
  {
    key: 'law',
    name: 'Law firm',
    category: 'Services',
    description: 'A composed slate-and-serif site for a practice — areas, people, insights.',
    settings: { theme: 'slate', heading_font: 'serif', layout: 'list', accent_color: '#38bdf8', site_description: 'Counsel for people and small companies.' },
    pages: [
      { title: 'Practice areas', body: "## What we handle\n\n- **Business & commercial** — formation, contracts, disputes\n- **Employment** — for employees and small employers alike\n- **Property & leases** — commercial and residential\n- **Wills & estates** — plain-language planning\n\nIf your matter isn't listed, ask — we'll either take it or send you to someone excellent who will." },
      { title: 'Our people', body: "We are deliberately small: three attorneys, one paralegal, no leverage model.\n\nThe person you meet first is the person who handles your matter. Our rates are on one page and our engagement letters are in plain English — we think that predicts how we'll treat everything else." },
      { title: 'Contact', body: "**Initial consultations** are 30 minutes and free. Come with documents if you have them, questions if you don't.\n\n- (555) 010-0033\n- counsel@example.com\n- 8 Court Square, third floor\n\nWe reply to every inquiry within one business day." },
    ],
    posts: [
      { title: 'What the new lease rules mean for small tenants', tags: ['Insights'], excerpt: 'Three changes that matter, and one that only sounds like it does.', body: "The amended lease regulations take effect next quarter. For small commercial tenants, three things matter:\n\n1. **Notice periods lengthen** — for both sides\n2. **Deposit caps** now apply under a certain floor area\n3. **Renewal rights** get a clearer default\n\nThe widely reported fourth change affects only anchor tenants in enclosed malls. If that's you, call us. If you're not sure whether that's you, it isn't." },
    ],
  },
  {
    key: 'auto',
    name: 'Auto repair',
    category: 'Services',
    description: 'A no-nonsense garage site — services, pricing, and hours up front.',
    settings: { theme: 'default', heading_font: 'sans', layout: 'list', accent_color: '#dc2626', site_description: 'Honest wrenching since forever.' },
    pages: [
      { title: 'Services & pricing', body: "## The usual suspects\n\n| Service | Price |\n|---|---|\n| Oil change (synthetic) | $69 |\n| Brake pads, per axle | from $180 |\n| Diagnostics | $95, waived if we do the work |\n| Pre-purchase inspection | $150 |\n| Tires | quoted same-day |\n\nEverything above is parts + labor, out the door. If we open it up and find something else, you get a call and a photo **before** we touch it." },
      { title: 'Hours & location', body: "**Hours**\n\n- Mon–Fri: 7:30am – 5:30pm\n- Sat: 8am – noon\n\n**Drop-off**: key slot by the office door, any hour. Leave a note, we'll call by 9.\n\n14 Industry Road — behind the bakery, follow the smell of both." },
    ],
    posts: [
      { title: 'Winter checklist for your car', tags: ['Tips'], excerpt: 'Five checks now that beat a tow in January.', body: "Every year, the same five things strand people. Check them now:\n\n1. **Battery** — if it's over 4 years old, test it (we test free)\n2. **Tires** — tread and pressure both drop with the temperature\n3. **Coolant** — it's called antifreeze for a reason\n4. **Wipers** — a $20 fix for a $200 problem\n5. **Washer fluid** — the winter-rated kind\n\nTen minutes in the bay, all five checked. No appointment needed on Saturdays." },
    ],
  },
  {
    key: 'trades',
    name: 'Contractor & trades',
    category: 'Services',
    description: 'A solid site for builders, plumbers, and electricians — projects and quotes.',
    settings: { theme: 'forest', heading_font: 'sans', layout: 'list', accent_color: '#166534', site_description: 'Built right, on schedule, tidy site.' },
    pages: [
      { title: 'What we do', body: "## Services\n\n- **Kitchens & bathrooms** — full renovations, start to finish\n- **Extensions & lofts** — plans to plaster\n- **General carpentry** — doors, floors, built-ins\n- **Emergency call-outs** — burst pipes and blown boards, same day\n\nLicensed and insured. References from the last five jobs, not the best five." },
      { title: 'Get a quote', body: "Send photos and a rough description to quotes@example.com, or call (555) 010-0044.\n\n**How quoting works here:**\n\n1. We visit and measure — free, no obligation\n2. You get a written, itemized quote within 3 days\n3. The price holds for 60 days\n\nWe'd rather lose a job than pad a quote. It shows in how long our clients keep our number." },
    ],
    posts: [
      { title: 'Project notes: the Hilltop kitchen', tags: ['Projects'], excerpt: 'Six weeks, one load-bearing surprise, and a very happy cook.', body: "Just wrapped: a full kitchen renovation on Hilltop Road.\n\n- **Scope**: wall removal, rewire, new everything\n- **Timeline**: six weeks, as quoted\n- **The surprise**: the 'partition' wall wasn't — a steel beam solved it, and the change order was signed before lunch\n\nThe client's verdict: 'I'd forgotten kitchens could have this much light.'" },
    ],
  },

  // ---------- Property ----------
  {
    key: 'realestate',
    name: 'Real estate agency',
    category: 'Property',
    description: 'Listings as structured content — price, beds, baths, status — on an ocean theme.',
    settings: { theme: 'ocean', heading_font: 'sans', layout: 'cards', accent_color: '#0e7490', site_description: 'Homes in the neighborhoods we actually live in.' },
    content_types: [
      {
        key: 'property',
        name: 'Property',
        name_plural: 'Properties',
        schema: [
          { label: 'Price (USD)', kind: 'number' },
          { label: 'Bedrooms', kind: 'number' },
          { label: 'Bathrooms', kind: 'number' },
          { label: 'Floor area', kind: 'text' },
          { label: 'Status', kind: 'select', options: 'For sale, Under offer, Sold' },
          { label: 'Enquire link', kind: 'url' },
        ],
      },
    ],
    items: [
      { type: 'property', title: 'Sunlit corner flat on Alder Street', excerpt: 'Two beds, two exposures, five minutes from the park.', fields: { price_usd: 325000, bedrooms: 2, bathrooms: 1, floor_area: '68 m²', status: 'For sale', enquire_link: 'https://example.com/enquire/alder-street' }, body: "A proper corner flat: windows on two sides, morning light in the kitchen, evening light in the sitting room.\n\n- Renovated kitchen (2024)\n- Secure bike storage\n- Five minutes' walk to the park and the Saturday market\n\nViewings Thursday evenings and Saturday mornings." },
      { type: 'property', title: 'The Mill House', excerpt: 'Four bedrooms, original beams, and the stream at the end of the garden.', fields: { price_usd: 740000, bedrooms: 4, bathrooms: 3, floor_area: '210 m²', status: 'Under offer', enquire_link: 'https://example.com/enquire/mill-house' }, body: "A converted mill on the edge of the village — beams, stone, and a garden that ends at the stream.\n\n- Kitchen-diner across the full width\n- Study with separate entrance (works as an office)\n- Double garage, workshop wiring\n\nCurrently under offer; register interest in case the chain breaks." },
      { type: 'property', title: 'Compact starter on Birch Lane', excerpt: 'One smart bedroom, low fees, ready to move in.', fields: { price_usd: 198000, bedrooms: 1, bathrooms: 1, floor_area: '41 m²', status: 'For sale', enquire_link: 'https://example.com/enquire/birch-lane' }, body: "The best-kept one-bed on the lane: repainted this spring, new boiler last winter, nothing to do but move in.\n\n- Low service charge\n- Residents' parking\n- Freshly painted throughout\n\nFirst-time buyers: we'll walk you through every step, jargon-free." },
    ],
    pages: [
      { title: 'Sell with us', body: "## What listing here looks like\n\n1. **Honest valuation** — backed by street-level data, not wishful thinking\n2. **Real photography** — shot in the light your home deserves\n3. **Weekly updates** — every viewing, every piece of feedback\n\nFlat fee, no tie-in period. If we're not performing, you can leave — nobody ever has." },
      { title: 'About the agency', body: "Two partners, one office, fifteen years on the same high street.\n\nWe list fewer homes than the chains and sell a higher percentage of them. Every property on this site is one we'd walk into ourselves — because we did, notebook in hand, before we agreed to list it." },
    ],
    posts: [
      { title: 'Market notes: spring', tags: ['Market'], excerpt: 'Stock is up, pricing is honest again, and good homes still move in a fortnight.', body: "What we're seeing on the ground this spring:\n\n- **More stock** than any spring in three years\n- **Realistic pricing** returning — the aspirational listings of last year are quietly relisting 8% lower\n- **Well-presented homes still sell in two weeks**\n\nIf you're waiting for the 'perfect' moment: this is roughly what one looks like." },
    ],
  },

  // ---------- Creative & Retail ----------
  {
    key: 'portfolio',
    name: 'Portfolio',
    category: 'Creative & Retail',
    description: 'A striking showcase — noir theme, serif headings, card layout.',
    settings: { theme: 'noir', heading_font: 'serif', layout: 'cards', accent_color: '#f43f5e', site_description: 'Selected work.' },
    pages: [
      { title: 'About', body: "I design and build things. This site collects the work I'm proudest of.\n\nCurrently **available for select projects** — reach out through the contact page." },
      { title: 'Contact', body: "The fastest way to reach me is email: **studio@example.com**\n\nFor project inquiries, include a sentence about scope and timeline and I'll reply within two days." },
    ],
    posts: [
      { title: 'Case study: the rebrand', tags: ['Case study'], excerpt: 'Twelve weeks from brief to launch — what worked and what I would do differently.', body: "# The brief\n\nA twenty-year-old company, a brand that had drifted. The ask: make it feel like the company its customers already believed it was.\n\n## The work\n\n- Research: 14 customer interviews\n- Identity: type, color, motion\n- Rollout: site, product, packaging\n\n## The result\n\nRecognition up, and — the metric I care about — the sales team started sending the deck unprompted." },
      { title: 'Side project: a tiny tool', tags: ['Side project'], excerpt: 'Built in a weekend, used every day since.', body: "Some projects are for clients. This one was for me: a small utility that removes one daily annoyance.\n\nBuilt in a weekend, refined over months. The lesson: **small scope, sharp edge**." },
    ],
  },
  {
    key: 'photography',
    name: 'Photography studio',
    category: 'Creative & Retail',
    description: 'A dark, image-first studio site with pricing and booking.',
    settings: { theme: 'noir', heading_font: 'serif', layout: 'cards', accent_color: '', site_description: 'Portraits, weddings, and the occasional storm.' },
    pages: [
      { title: 'Pricing & booking', body: "## Sessions\n\n| Session | Price | Includes |\n|---|---|---|\n| Portrait (1 hr) | $250 | 15 edited images |\n| Family (90 min) | $350 | 25 edited images |\n| Wedding | from $2,400 | Full day, two shooters |\n\nDates book 2–3 months out for weekends. A signed contract and a deposit hold yours.\n\n**Booking**: studio@example.com with your date and what you have in mind." },
      { title: 'About the studio', body: "I've photographed people for twelve years and I'm still not tired of the moment someone forgets the camera is there — that's the frame we're waiting for.\n\nNatural light where possible, honest retouching always: you, on a very good day, not someone else." },
    ],
    posts: [
      { title: 'From the archive: coastal light', tags: ['Journal'], excerpt: 'Why the ten minutes after a storm clears are worth the soaked shoes.', body: "Everyone photographs golden hour. The frames I keep coming back to happen in the ten minutes **after a storm clears** — the sky still bruised, the light suddenly clean.\n\nYou can't schedule it. You can only be out in the rain slightly before it makes sense to be. The soaked shoes are part of the price, and the price is fair." },
    ],
  },
  {
    key: 'retail',
    name: 'Retail & boutique',
    category: 'Creative & Retail',
    description: 'A friendly shop site — visit info, new arrivals, shipping and returns.',
    settings: { theme: 'paper', heading_font: 'sans', layout: 'cards', accent_color: '#b45309', site_description: 'Good things, chosen slowly.' },
    pages: [
      { title: 'Visit the shop', body: "**Hours**\n\n- Tue–Sat: 10am – 6pm\n- Sun: 11am – 4pm\n- Mondays we're at the flea market, buying\n\n**Find us**: 27 Little Lane, between the bookshop and the florist. Cards and cash; dogs get a biscuit." },
      { title: 'Shipping & returns', body: "## Shipping\n\n- Local delivery (by bike): free over $40\n- Domestic: $6 flat, 2–4 days\n- We wrap everything as a gift because everything should be\n\n## Returns\n\n30 days, no interrogation. If it didn't work in your home, it'll work in someone else's — bring it back and choose again." },
    ],
    posts: [
      { title: 'New in: the spring shipment', tags: ['New arrivals'], excerpt: 'Ceramics from a two-person studio, linen in four colors, and the good candles are back.', body: "The spring shipment landed this week:\n\n- **Ceramics** from a two-person studio we visited in February — each piece slightly, correctly, different\n- **Linen** in four colors including the grey-green everyone asked about\n- **The good candles are back.** We bought triple. It will not be enough.\n\nFirst pick goes to whoever's quickest through the door Saturday." },
    ],
  },
  {
    key: 'agency',
    name: 'Studio & agency',
    category: 'Creative & Retail',
    description: 'A confident services site — offerings, selected work, and a clear way in.',
    settings: { theme: 'default', heading_font: 'sans', layout: 'list', accent_color: '#4f46e5', site_description: 'Strategy, design, and shipped work.' },
    pages: [
      { title: 'Services', body: "## What we do\n\n- **Brand & identity** — positioning, naming, visual systems\n- **Websites & product** — designed and built in-house\n- **Ongoing design partnership** — a senior team on retainer\n\nWe take on four clients a quarter. Small on purpose: the people who pitch you are the people who do the work." },
      { title: 'Start a project', body: "Tell us three things at hello@example.com:\n\n1. What you're making\n2. When it needs to exist\n3. Roughly what you've budgeted\n\nYou'll get a straight answer within two days — including 'we're not the right fit, but here's who is' when that's the truth." },
    ],
    posts: [
      { title: 'Case study: rebuilding a 20-year-old brand', tags: ['Case study'], excerpt: 'Research, identity, rollout — and the metric that actually moved.', body: "## The problem\n\nTwo decades of growth, a brand assembled by accretion. Nobody could say what the company looked like — including the company.\n\n## The work\n\nFourteen stakeholder interviews, a repositioning the CEO could recite cold, and an identity system with exactly as many rules as it needed.\n\n## The result\n\nSix months later: sales cycle down 20%, and the sales team sends the brand deck **unprompted**. That's the metric we design for." },
    ],
  },
  {
    key: 'music',
    name: 'Band & musician',
    category: 'Creative & Retail',
    description: 'Tour dates as structured content, releases, and a sunset-dark stage look.',
    settings: { theme: 'sunset', heading_font: 'mono', layout: 'list', accent_color: '#fb923c', site_description: 'Loud songs about quiet things.' },
    content_types: [
      {
        key: 'show',
        name: 'Show',
        name_plural: 'Shows',
        schema: [
          { label: 'Date', kind: 'date' },
          { label: 'City', kind: 'text' },
          { label: 'Venue', kind: 'text' },
          { label: 'Tickets', kind: 'url' },
        ],
      },
    ],
    items: [
      { type: 'show', title: 'The Basement — hometown opener', excerpt: 'The tour starts where everything started.', fields: { date: '2026-09-18', city: 'Springfield', venue: 'The Basement', tickets: 'https://example.com/tickets/basement' }, body: "First night of the tour, in the room where we played our third-ever show. Doors 8, support from friends, curfew ignored within reason." },
      { type: 'show', title: 'Riverside Hall', excerpt: 'The big room. Bring everyone.', fields: { date: '2026-09-26', city: 'Fairview', venue: 'Riverside Hall', tickets: 'https://example.com/tickets/riverside' }, body: "Our first time headlining Riverside. We're bringing the full production and both new songs that survived rehearsal. Doors 7:30." },
      { type: 'show', title: 'Harbor Festival — main stage', excerpt: 'Sunset slot on the water.', fields: { date: '2026-10-04', city: 'Port Ellen', venue: 'Harbor Festival', tickets: 'https://example.com/tickets/harbor' }, body: "Festival closer, sunset slot, on the water. If the weather holds it'll be the photo from this tour. If it doesn't, it'll be the story." },
    ],
    pages: [
      { title: 'Music', body: "## Releases\n\n- **Quiet Things** (LP, 2026) — ten songs, forty minutes, no skips intended\n- **Porch Tapes** (EP, 2024) — four songs recorded where the title suggests\n- **First Light** (single, 2023) — where it started\n\nEverywhere you stream, and on vinyl at shows while the boxes last." },
      { title: 'About', body: "Four people, one van, songs written in kitchens and finished in soundchecks.\n\nFor booking, press, or to tell us the second record is better than the first (it is): band@example.com." },
    ],
    posts: [
      { title: 'New single out now', tags: ['Releases'], excerpt: "'Landline' is out everywhere today — the first song from the autumn record.", body: "**'Landline' is out today**, everywhere you listen.\n\nIt's the first song from the record we tracked in January — the one with the string section we could suddenly afford (thanks, sync license). The full album lands this autumn. The tour dates are already up." },
    ],
  },

  // ---------- Community & Education ----------
  {
    key: 'nonprofit',
    name: 'Nonprofit & charity',
    category: 'Community & Education',
    description: 'Mission-forward and clear — programs, impact stories, and how to help.',
    settings: { theme: 'forest', heading_font: 'sans', layout: 'list', accent_color: '', site_description: 'Practical help, measured honestly.' },
    pages: [
      { title: 'Our mission', body: "We exist to close one specific gap: neighbors with time and skills, and neighbors who need exactly those.\n\n**What that means in practice:** a tool library, a repair café every second Saturday, and a visiting program for isolated older residents.\n\nSmall, local, measurable. We publish our numbers — the flattering ones and the others." },
      { title: 'Programs', body: "## Running now\n\n- **The Tool Library** — 400+ tools, free membership, Tuesday–Saturday\n- **Repair Café** — 2nd Saturday monthly; bring the broken thing\n- **Neighbors Visiting** — trained volunteers, weekly visits, real friendships\n\n## How to join in\n\nVolunteer two hours a month, or donate — every program above runs on both." },
      { title: 'Donate', body: "**What your money does:**\n\n| Amount | Funds |\n|---|---|\n| $25 | One tool, repaired and recirculated |\n| $100 | A month of repair-café materials |\n| $500 | Training for two visiting volunteers |\n\nOne-off or monthly, every amount helps. Donations are tax-deductible; receipts are instant; our accounts are public." },
    ],
    posts: [
      { title: 'The 2026 impact report, in one page', tags: ['Impact'], excerpt: '1,900 tools lent, 240 repairs, 61 weekly friendships — and what we got wrong.', body: "The full report is a PDF; here's the honest single page:\n\n- **1,900 tool loans** (up 30%)\n- **240 repairs** completed at the café — an estimated 1.8 tonnes kept from landfill\n- **61 weekly visiting matches** — our waitlist, however, doubled\n\n**What we got wrong:** we under-recruited visiting volunteers all spring. That's the headline goal for next year, and you can be part of fixing it." },
    ],
  },
  {
    key: 'school',
    name: 'School & courses',
    category: 'Community & Education',
    description: 'Courses as structured content — dates, duration, price, enrollment links.',
    settings: { theme: 'ocean', heading_font: 'serif', layout: 'list', accent_color: '', site_description: 'Small classes, working teachers.' },
    content_types: [
      {
        key: 'course',
        name: 'Course',
        name_plural: 'Courses',
        schema: [
          { label: 'Starts', kind: 'date' },
          { label: 'Duration', kind: 'text' },
          { label: 'Price (USD)', kind: 'number' },
          { label: 'Enroll link', kind: 'url' },
        ],
      },
    ],
    items: [
      { type: 'course', title: 'Foundations of Watercolor', excerpt: 'Eight evenings from first wash to a finished landscape.', fields: { starts: '2026-09-15', duration: '8 weeks, Tue evenings', price_usd: 240, enroll_link: 'https://example.com/enroll/watercolor' }, body: "Start with washes and end with a landscape you'd frame. Materials list provided; the first evening's supplies are on us.\n\nTaught by a working illustrator. Maximum twelve students — everyone gets desk-side time weekly." },
      { type: 'course', title: 'Practical Woodworking', excerpt: 'Six Saturdays, one finished side table, all fingers retained.', fields: { starts: '2026-10-03', duration: '6 Saturdays', price_usd: 380, enroll_link: 'https://example.com/enroll/woodworking' }, body: "Learn the hand tools first, the machines second, and leave with a side table you built from rough lumber.\n\nAll tools and timber included. Safety module first morning — non-negotiable, briefly boring, permanently useful." },
    ],
    pages: [
      { title: 'About the school', body: "Every course here is taught by someone who does the thing for a living — illustrators, joiners, developers, bakers.\n\nClasses cap at twelve. There are no lecture halls, no recorded videos, and nowhere to hide at the back: you'll make things from week one." },
      { title: 'Enrollment & FAQ', body: "**How to enroll**: each course page has an enroll link; a deposit holds your seat.\n\n**Refunds**: full refund to 14 days before start; after that we'll move you to the next cohort instead.\n\n**Gift enrollment**: wildly popular, occasionally risky. Gift cards let them choose their own course." },
    ],
    posts: [
      { title: 'Autumn term is open for enrollment', tags: ['News'], excerpt: 'Watercolor and woodworking are back — both sold out last term.', body: "Autumn enrollment opened this morning.\n\nBoth returning courses sold out last term, so if you were on a waitlist you have a 48-hour head start — check your email. Everyone else: the course list is live, and the woodworking side tables have gotten genuinely good." },
    ],
  },
  {
    key: 'events',
    name: 'Events & weddings',
    category: 'Community & Education',
    description: 'A soft, elegant planner site — services, process, and stories.',
    settings: { theme: 'lavender', heading_font: 'serif', layout: 'cards', accent_color: '', site_description: 'Days worth remembering, planned calmly.' },
    pages: [
      { title: 'What we plan', body: "## Celebrations\n\n- **Weddings** — full planning or final-month coordination\n- **Milestones** — big birthdays, anniversaries, retirements that deserve better than a conference room\n- **Company gatherings** — offsites and parties people don't dread\n\nWe take a limited number of dates each year so that on yours, you're the only client." },
      { title: 'How it works', body: "1. **Coffee first** — an hour, free, no slideshow\n2. **The plan** — venues, vendors, budget, one shared timeline\n3. **The day** — we arrive first, leave last, and handle everything in between\n\nYou'll get one honest budget line for us and real numbers for everything else. Surprises belong in the toasts, not the invoices." },
    ],
    posts: [
      { title: 'A hillside wedding, start to finish', tags: ['Stories'], excerpt: 'Ninety guests, one field, zero power outlets — and the best dance floor of the year.', body: "September's favorite: ninety guests on a hillside with no venue, no power, and no plan B ever needed.\n\n- **The tent** went up Thursday; the generator hid behind the hedge\n- **Dinner** came off two fire pits, family-style\n- **The dance floor** was plywood, string lights, and conviction\n\nRain was forecast twice. It read the room and stayed away." },
    ],
  },

  // ---------- Product & Publishing ----------
  {
    key: 'marketing',
    name: 'Product site',
    category: 'Product & Publishing',
    description: 'A crisp company site — card layout, bold accent, announcement-ready.',
    settings: { theme: 'default', heading_font: 'sans', layout: 'cards', accent_color: '#4f46e5', site_description: 'The modern way to get it done.' },
    pages: [
      { title: 'About', body: "We started this company because the existing tools made easy things hard.\n\n**Our promise:** software that respects your time.\n\n## The team\n\nWe're a small, senior team that ships every week. We're default-remote and default-transparent." },
      { title: 'Pricing', body: "## Simple pricing\n\n| Plan | Price | For |\n|------|-------|-----|\n| Starter | Free | Trying it out |\n| Pro | $12/user/mo | Growing teams |\n| Enterprise | Let's talk | The big leagues |\n\nEvery plan includes every feature. Paid plans add seats, support, and SSO." },
      { title: 'Contact', body: "**Sales** — sales@example.com\n\n**Support** — support@example.com, answered within one business day\n\n**Everything else** — hello@example.com" },
    ],
    posts: [
      { title: 'Introducing our product', tags: ['Announcements'], excerpt: 'After a year of building, we are live. Here is what we made and why.', body: "# We're live\n\nToday we're opening the doors to everyone.\n\n## What it does\n\n- Sets up in minutes, not weeks\n- Works with the tools you already use\n- Priced so the whole team can be on it\n\n## What's next\n\nThis is day one. The [changelog](/) is where we'll announce everything that ships." },
      { title: 'Changelog: week one', tags: ['Changelog'], excerpt: 'Faster onboarding, two integrations, and a batch of fixes.', body: "## New\n\n- Two-minute guided onboarding\n- Integrations: Slack and GitHub\n\n## Improved\n\n- Dashboard loads 40% faster\n\n## Fixed\n\n- A dozen small paper cuts, reported by you" },
    ],
  },
  {
    key: 'docs',
    name: 'Documentation',
    category: 'Product & Publishing',
    description: 'A developer docs site — list layout, mono headings, terminal theme.',
    settings: { theme: 'terminal', heading_font: 'mono', layout: 'list', accent_color: '', site_description: 'Guides, reference, and examples.' },
    pages: [
      { title: 'Getting started', body: "## Install\n\n```bash\nnpm install your-package\n```\n\n## First steps\n\n```js\nconst thing = require('your-package');\nthing.start();\n```\n\nThat's it — you're running. Read the guides below for the full tour." },
      { title: 'API reference', body: "## `start(options)`\n\nBoots the service.\n\n| Option | Type | Default | Description |\n|--------|------|---------|-------------|\n| `port` | number | `3000` | Port to listen on |\n| `quiet` | boolean | `false` | Suppress startup logs |\n\n## `stop()`\n\nGraceful shutdown. Returns a promise that resolves when in-flight work drains." },
      { title: 'FAQ', body: "**Is it production-ready?**\nYes — versioned releases, semver, and a test suite.\n\n**How do I report a bug?**\nOpen an issue with a minimal reproduction. Minimal is the magic word.\n\n**Can I contribute?**\nPlease. Start with issues labeled `good first issue`." },
    ],
    posts: [
      { title: 'v1.0 release notes', tags: ['Releases'], excerpt: 'The API is stable. Here is everything in the first major release.', body: "# v1.0.0\n\nThe API is now **stable** — no breaking changes without a major version.\n\n## Highlights\n\n- Complete rewrite of the core loop: 3× faster\n- First-class TypeScript types\n- New plugin system\n\n## Upgrading\n\n```bash\nnpm install your-package@1\n```\n\nSee the migration guide for the two renamed options." },
    ],
  },
  {
    key: 'changelog',
    name: 'Changelog & updates',
    category: 'Product & Publishing',
    description: 'A product update feed — midnight theme, list layout, release-note posts.',
    settings: { theme: 'midnight', heading_font: 'sans', layout: 'list', accent_color: '#60a5fa', site_description: 'Every improvement, as it ships.' },
    pages: [
      { title: 'About this changelog', body: "We ship continuously and write it all down here. Follow along by [RSS](/feed.xml).\n\n**Versioning:** dates, not numbers. Every entry is something you can use today." },
    ],
    posts: [
      { title: 'New: dark mode', tags: ['New'], excerpt: 'The most-requested feature is live for everyone.', body: "## Dark mode is here\n\nFlip it in **Settings → Appearance**, or let it follow your system preference.\n\nThanks to the hundreds of you who asked — keep the requests coming." },
      { title: 'Improved: search is 5× faster', tags: ['Improved'], excerpt: 'A rebuilt index makes every query feel instant.', body: "We rebuilt the search index from scratch:\n\n- Median query: **38ms → 7ms**\n- Typo tolerance: now on by default\n- Filters combine properly\n\nNo action needed — it's already live." },
      { title: 'Fixed: a batch of paper cuts', tags: ['Fixed'], excerpt: 'Eleven small annoyances, gone.', body: "This week was a cleanup week:\n\n- Keyboard focus no longer escapes modals\n- Timezones respected in every date picker\n- Nine more, each reported by exactly one very persistent user\n\nKeep reporting the small stuff — we read all of it." },
    ],
  },
  {
    key: 'blog',
    name: 'Personal blog',
    category: 'Product & Publishing',
    description: 'A clean writing home — list layout, serif headings, warm paper theme.',
    settings: { theme: 'paper', heading_font: 'serif', layout: 'list', accent_color: '#b45309', site_description: 'Essays and notes, published occasionally.' },
    pages: [
      { title: 'About', body: "I write here about the things I'm learning and making. New posts land when they're ready — subscribe by [RSS](/feed.xml) and they'll find you.\n\nEverything on this site is my own opinion." },
      { title: 'Now', body: "A [now page](https://nownownow.com/about) — what I'm focused on at this moment:\n\n- Writing more, shorter\n- Reading: *The Making of the Atomic Bomb*\n- One ambitious project I'm not ready to talk about yet\n\n*Updated when things change.*" },
    ],
    posts: [
      { title: 'Hello, world', tags: ['Meta'], excerpt: 'Why this site exists, and what to expect.', body: "Every blog needs a first post, and this is mine.\n\nI'm starting this site to think in public. Expect essays, working notes, and the occasional strong opinion, loosely held.\n\n> The best time to start writing was ten years ago. The second best time is now.\n\nIf you want to follow along, there's an [RSS feed](/feed.xml)." },
      { title: 'What I read this month', tags: ['Reading'], excerpt: 'Three books, one regret, and a recommendation.', body: "## The list\n\n1. **A book I loved** — couldn't put it down\n2. **A book I respected** — dense but worth it\n3. **A book I abandoned** — life is short\n\nThe monthly reading post is a habit I'm stealing from better bloggers. It keeps me honest about actually finishing things." },
    ],
  },

  // ---------- More Food & Hospitality ----------
  {
    key: 'bakery',
    name: 'Bakery',
    category: 'Food & Hospitality',
    description: 'Morning-warm and simple — what came out of the oven, and when to come get it.',
    settings: { theme: 'paper', heading_font: 'serif', layout: 'cards', accent_color: '#b45309', site_description: 'Bread out at eight, gone by noon.' },
    pages: [
      { title: "What's baking", body: "## Every day\n\n- Country sourdough — 6.50\n- Baguette — 3.50\n- Morning buns — 4.00\n- Chocolate chip cookies, sea salt — 2.50\n\n## By the day\n\n- **Wednesday**: rye day\n- **Friday**: challah, braided and shiny\n- **Weekends**: croissants (plain, almond, the good chocolate)\n\nLarge orders and whole cakes: two days' notice, one phone call." },
      { title: 'Visit', body: "**Hours**: Wed–Sun, 8am until sold out — which is usually early afternoon and we're only slightly sorry.\n\n5 Mill Street, the shop with the flour dust on the windows. Follow the smell." },
    ],
    posts: [
      { title: 'The rye is back', tags: ['News'], excerpt: 'By popular demand, Wednesday is rye day again.', body: "We rested the rye over the summer (the starter deserved a holiday). It's back: **every Wednesday**, a dense, dark loaf with caraway, out of the oven at nine.\n\nIt keeps for a week and toasts like a dream. The regulars know to reserve one; now you do too." },
    ],
  },
  {
    key: 'brewery',
    name: 'Bar & brewery',
    category: 'Food & Hospitality',
    description: 'A taproom site with the tap list as structured content — style, ABV, price.',
    settings: { theme: 'midnight', heading_font: 'sans', layout: 'cards', accent_color: '#f59e0b', site_description: 'Small-batch beer, long communal tables.' },
    content_types: [
      {
        key: 'tap',
        name: 'Tap',
        name_plural: 'On tap',
        schema: [
          { label: 'Style', kind: 'text' },
          { label: 'ABV %', kind: 'number' },
          { label: 'Price', kind: 'number' },
        ],
      },
    ],
    items: [
      { type: 'tap', title: 'Harbor Lights', excerpt: 'Our flagship pale — citrus up front, clean finish.', fields: { style: 'Pale Ale', abv: 5.2, price: 7 }, body: "The one that pays the rent: a bright, citrusy pale ale that plays well with everything on the food menu. First beer we ever brewed here, still the last one standing at closing." },
      { type: 'tap', title: 'Fog Bank', excerpt: 'Hazy, soft, dangerously drinkable.', fields: { style: 'Hazy IPA', abv: 6.8, price: 8 }, body: "Double dry-hopped and pillow-soft. Mango and pine, almost no bitterness, and a body like orange juice's cooler sibling. Rotates hop varieties batch to batch — ask what this one is." },
      { type: 'tap', title: 'Night Shift', excerpt: 'A dry stout for people who think they don’t like stouts.', fields: { style: 'Dry Stout', abv: 4.4, price: 7 }, body: "Black as the harbor at midnight, light as a session beer. Coffee and cocoa from the malt alone. The nitro pour takes ninety seconds; they're worth it." },
    ],
    pages: [
      { title: 'Visit the taproom', body: "**Hours**\n\n- Wed–Fri: 4pm – 11pm\n- Sat: noon – 11pm\n- Sun: noon – 8pm\n\nLong tables, board games, a rotating food truck out front (see the board for who's parked). Kids and dogs welcome until 8." },
      { title: 'Private events', body: "The barrel room seats 40 for private events — tastings, birthdays, the office party that people actually attend.\n\nFlat room fee, beer by consumption, food truck arranged on request. Write to events@example.com." },
    ],
    posts: [
      { title: 'Fresh batch: Fog Bank v12', tags: ['Releases'], excerpt: 'This round: Citra and Nelson. The haze abides.', body: "Fog Bank batch twelve goes on tap Friday — this round hopped with **Citra and Nelson Sauvin**, so expect white grape over the usual mango.\n\nCrowlers filled while it lasts, which history suggests is nine days." },
    ],
  },
  {
    key: 'foodtruck',
    name: 'Food truck',
    category: 'Food & Hospitality',
    description: 'A moving kitchen — weekly stops as structured content, menu, and catering.',
    settings: { theme: 'sunset', heading_font: 'sans', layout: 'list', accent_color: '#fb923c', site_description: 'Follow the truck. The tacos are worth it.' },
    content_types: [
      {
        key: 'stop',
        name: 'Stop',
        name_plural: 'This week',
        schema: [
          { label: 'Day', kind: 'select', options: 'Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday' },
          { label: 'Location', kind: 'text' },
          { label: 'Hours', kind: 'text' },
        ],
      },
    ],
    items: [
      { type: 'stop', title: 'Tech quarter — Plaza corner', excerpt: 'The lunch rush stop. Come before noon or embrace the line.', fields: { day: 'Tuesday', location: 'Plaza corner, 4th & Main', hours: '11:30 – 14:00' }, body: "Our biggest stop of the week. Pre-order on the app by 11 if your lunch break is real; the line moves fast but it moves long." },
      { type: 'stop', title: 'Brewery yard', excerpt: 'Tacos and taproom beer — civilization, achieved.', fields: { day: 'Friday', location: 'Harbor Brewing yard', hours: '17:00 – 21:00' }, body: "Friday nights we park at the brewery. Their beer, our al pastor, everyone wins. Last orders 8:45, no exceptions, the fryer needs its sleep." },
      { type: 'stop', title: 'Saturday market', excerpt: 'Breakfast tacos until the eggs run out.', fields: { day: 'Saturday', location: 'Farmers market, river entrance', hours: '08:00 – 13:00' }, body: "The weekend special: breakfast tacos with eggs from the farm two stalls over. When they sell out of eggs, we sell out of breakfast — it's a small, delicious economy." },
    ],
    pages: [
      { title: 'Menu', body: "## Tacos (3 for 12)\n\n- **Al pastor** — the reason we bought a truck\n- **Baja fish** — beer-battered, cabbage, lime crema\n- **Mushroom** — chili-roasted, even carnivores concede\n\n## Sides\n\n- Elote — 5\n- Chips, salsa roja — 4\n\nEverything gluten-aware, most things gluten-free. Ask at the window." },
      { title: 'Catering', body: "The truck comes to you: weddings, office parties, anything with 30+ hungry people and somewhere to park.\n\nFlat travel fee + per-head pricing, tacos unlimited within reason. Book a month out for weekends: truck@example.com." },
    ],
    posts: [],
  },

  // ---------- More Services ----------
  {
    key: 'barbershop',
    name: 'Barbershop',
    category: 'Services',
    description: 'Sharp and simple — cuts, prices, walk-in policy, done.',
    settings: { theme: 'noir', heading_font: 'mono', layout: 'list', accent_color: '#f43f5e', site_description: 'Good cuts, no fuss, decent conversation.' },
    pages: [
      { title: 'Cuts & prices', body: "| Service | Price | Time |\n|---|---|---|\n| Cut | $32 | 30 min |\n| Cut & beard | $45 | 45 min |\n| Skin fade | $38 | 40 min |\n| Buzz | $20 | 15 min |\n| Kids (under 12) | $22 | 30 min |\n\nCard or cash. Tips go to the person holding the clippers." },
      { title: 'Walk-ins & booking', body: "**Walk-ins** always welcome — the board in the window shows the current wait.\n\n**Bookings** open a week ahead, online only, and Saturday slots go by Wednesday. You know what to do.\n\nTue–Fri 10–7, Sat 9–5. Closed Sun–Mon, as is right." },
    ],
    posts: [
      { title: 'Second chair, now open', tags: ['News'], excerpt: 'We hired. Waits just got shorter.', body: "After a year of the board saying '45 min', there's a second chair — ten years' experience and strong opinions about scissor work over clippers.\n\nWalk-in waits are back under twenty minutes. The conversation quality, already excellent, has somehow improved." },
    ],
  },
  {
    key: 'dental',
    name: 'Dental practice',
    category: 'Services',
    description: 'A reassuring practice site — treatments, first-visit info, and pricing that hides nothing.',
    settings: { theme: 'default', heading_font: 'sans', layout: 'cards', accent_color: '#0ea5e9', site_description: 'Gentle dentistry, honest pricing, zero lectures.' },
    pages: [
      { title: 'Treatments', body: "## Routine\n\n- **Exam & clean** — $95, twice a year keeps everything boring (the goal)\n- **X-rays** — $40, only when actually needed\n\n## When something hurts\n\n- Fillings from $140 (white, always)\n- Root canal from $600 — with numbing that works and a playlist of your choosing\n- Crowns from $850\n\nWritten estimates before any work beyond a clean. No surprises is practice policy." },
      { title: 'Your first visit', body: "New patients get a longer first slot: full exam, x-rays if needed, a clean, and an honest conversation about what (if anything) needs doing.\n\n**Nervous?** Say so when you book — we go slower, explain everything, and nobody here has ever lectured anyone about flossing. Results over guilt." },
    ],
    posts: [
      { title: 'Now open Saturdays', tags: ['News'], excerpt: 'One Saturday a month, for teeth that refuse to observe business hours.', body: "By request: we now open the **first Saturday of each month**, 9–2.\n\nSlots are for working humans whose molars sabotage them on weekends. They book out fast — the online calendar has the next three months open." },
    ],
  },
  {
    key: 'vet',
    name: 'Veterinary clinic',
    category: 'Services',
    description: 'Warm and practical — services, emergencies, and what to expect at a visit.',
    settings: { theme: 'forest', heading_font: 'sans', layout: 'cards', accent_color: '#166534', site_description: 'For the family members with more legs.' },
    pages: [
      { title: 'Services', body: "## Everyday care\n\n- Wellness exams & vaccinations\n- Dental cleaning (yes, they need it too)\n- Microchipping & travel paperwork\n\n## When it's serious\n\n- In-house lab and imaging — results same visit\n- Surgery, from routine spays to the complicated stuff\n- **Emergencies**: call first, then come — (555) 010-0055, staffed until 10pm\n\nCats get the quiet exam room. It matters more than you'd think." },
      { title: 'Your visit', body: "**Bring**: previous records if you have them, a treat they love, and the carrier they hate.\n\n**Costs**: exam $60; estimates in writing before anything else. We'll always tell you the pragmatic option alongside the gold-standard one — you know your animal and your budget.\n\nParking out front; anxious dogs can wait in the car and skip the lobby drama — just call from outside." },
    ],
    posts: [
      { title: 'Tick season starts now', tags: ['Health'], excerpt: 'Earlier every year — get ahead of it this month.', body: "The first ticks of the season showed up on patients this week — three weeks earlier than last year.\n\nPrevention beats removal: chewables cover a month, collars up to eight. Both stocked, both cheaper than the alternative. Book a two-minute pickup, no exam needed for current patients." },
    ],
  },
  {
    key: 'yoga',
    name: 'Yoga studio',
    category: 'Services',
    description: 'A calm schedule-first studio site with class listings.',
    settings: { theme: 'lavender', heading_font: 'serif', layout: 'list', accent_color: '#7c3aed', site_description: 'Breathe in, book in.' },
    content_types: [
      {
        key: 'class',
        name: 'Class',
        name_plural: 'Schedule',
        schema: [
          { label: 'Day', kind: 'select', options: 'Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday' },
          { label: 'Time', kind: 'text' },
          { label: 'Teacher', kind: 'text' },
          { label: 'Style', kind: 'select', options: 'Vinyasa, Yin, Restorative' },
        ],
      },
    ],
    items: [
      { type: 'class', title: 'Morning Vinyasa', excerpt: 'Wake the body up properly.', fields: { day: 'Monday', time: '07:00', teacher: 'Maya', style: 'Vinyasa' }, body: "A steady, breath-led flow to start the week — strong enough to count as exercise, kind enough for a Monday. All levels; modifications offered throughout." },
      { type: 'class', title: 'Candlelit Yin', excerpt: 'Long holds, low light, deep release.', fields: { day: 'Wednesday', time: '19:30', teacher: 'Tom', style: 'Yin' }, body: "Five poses, five minutes each, gravity doing the work. The room is candlelit, the playlist is ambient, and the last ten minutes are widely considered the best sleep aid in town." },
      { type: 'class', title: 'Sunday Restorative', excerpt: 'Bolsters, blankets, and nowhere to be.', fields: { day: 'Sunday', time: '17:00', teacher: 'Maya', style: 'Restorative' }, body: "The week's gentlest hour: fully supported poses, guided breathing, optional eye pillows. If you fall asleep, that's not failure — that's the curriculum working." },
    ],
    pages: [
      { title: 'Pricing', body: "| Pass | Price |\n|---|---|\n| Drop-in | $18 |\n| 10-class pass | $150 (never expires) |\n| Monthly unlimited | $95 |\n\nFirst class free, mats included, no contracts. Students and seniors: 20% off everything." },
      { title: 'The studio', body: "One sunlit room above the bookshop, cork floors, plants we mostly keep alive.\n\nArrive ten minutes early, especially your first time. Props provided; bring water and whatever week you've had — both welcome." },
    ],
    posts: [],
  },
  {
    key: 'accounting',
    name: 'Accounting & bookkeeping',
    category: 'Services',
    description: 'A trust-first practice site — services, pricing, and deadline reminders.',
    settings: { theme: 'slate', heading_font: 'sans', layout: 'list', accent_color: '#38bdf8', site_description: 'Numbers handled. Sleep restored.' },
    pages: [
      { title: 'Services & pricing', body: "## For small businesses\n\n- **Monthly bookkeeping** — from $250/mo: reconciled, categorized, reported\n- **Payroll** — from $75/mo, filings included\n- **Year-end accounts & tax** — from $900\n\n## For individuals\n\n- Personal returns from $220\n- Rental income, side businesses, the crypto folder you're afraid of — bring it all\n\nFixed quotes upfront. The clock only runs when we've agreed what it's attached to." },
      { title: 'How we work', body: "1. **A free 30-minute call** — you talk, we listen, we quote\n2. **Clean handover** — we fetch records from your bank, your old accountant, or the shoebox\n3. **A monthly rhythm** — books closed by the 10th, a one-page summary in plain English\n\nYou'll never be surprised by your own numbers again. That's the entire product." },
    ],
    posts: [
      { title: 'Quarterly deadlines, calendared', tags: ['Deadlines'], excerpt: 'The three dates that matter this quarter, plus what to send us when.', body: "This quarter's dates for small-business clients:\n\n- **15th next month** — estimated payments due (we'll send your figure a week prior)\n- **End of month** — payroll filings (handled, if you're on our payroll plan)\n- **30 days after quarter-close** — sales tax\n\nClients: everything above is already in motion. Everyone else: this is what having an accountant feels like." },
    ],
  },
  {
    key: 'itservices',
    name: 'IT services & MSP',
    category: 'Services',
    description: 'A competent, calm managed-IT site — plans, response times, no jargon walls.',
    settings: { theme: 'terminal', heading_font: 'mono', layout: 'list', accent_color: '', site_description: 'Your IT department, minus the department.' },
    pages: [
      { title: 'Plans', body: "| Plan | Per user/mo | Includes |\n|---|---|---|\n| Essentials | $45 | Helpdesk, patching, backups, antivirus |\n| Standard | $75 | + device management, email security, onboarding/offboarding |\n| Complete | $110 | + 24/7 response, compliance reporting, vCIO reviews |\n\nMonth to month. Offboarding is documented and graceful — we're confident you'll stay because leaving is easy." },
      { title: 'Response times', body: "We publish them because we hit them:\n\n| Severity | First response | Example |\n|---|---|---|\n| Critical | 15 min, 24/7 | Server down, ransomware suspicion |\n| High | 1 business hr | Someone can't work |\n| Normal | 4 business hrs | Something's annoying |\n\nLast quarter's actuals: 9 min / 41 min / 2.1 hrs. The status page doesn't lie and neither do we." },
    ],
    posts: [
      { title: 'The backup test most businesses fail', tags: ['Security'], excerpt: 'Having backups and having restores are different things.', body: "Every prospective client says they have backups. Then we ask: **when did you last restore one?**\n\nSilence, usually.\n\nA backup you've never restored is a hope, not a plan. We run restore drills quarterly for every client — the first one is included in onboarding, and it has saved two companies this year alone." },
    ],
  },
  {
    key: 'travel',
    name: 'Travel agency',
    category: 'Services',
    description: 'Trips as structured content — destination, duration, price, departure dates.',
    settings: { theme: 'ocean', heading_font: 'serif', layout: 'cards', accent_color: '#0e7490', site_description: 'Small-group trips, planned like we’re coming too. (We are.)' },
    content_types: [
      {
        key: 'trip',
        name: 'Trip',
        name_plural: 'Trips',
        schema: [
          { label: 'Destination', kind: 'text' },
          { label: 'Duration', kind: 'text' },
          { label: 'Price (USD)', kind: 'number' },
          { label: 'Departs', kind: 'date' },
          { label: 'Book link', kind: 'url' },
        ],
      },
    ],
    items: [
      { type: 'trip', title: 'Coast & Islands: Croatia by ferry', excerpt: 'Eight days, four islands, zero rental cars.', fields: { destination: 'Croatia', duration: '8 days', price_usd: 2400, departs: '2026-09-12', book_link: 'https://example.com/book/croatia' }, body: "Split to Dubrovnik the slow way: local ferries, family konobas, and swims between every transfer.\n\n- Max 12 travelers\n- All ferries, stays, and five dinners included\n- One day with no plan at all — trust us, it's the favorite" },
      { type: 'trip', title: 'Kyoto in November', excerpt: 'Autumn leaves, quiet temples, one perfect week.', fields: { destination: 'Japan', duration: '7 days', price_usd: 3200, departs: '2026-11-05', book_link: 'https://example.com/book/kyoto' }, body: "The city at its best month: maple season, morning temple visits before the crowds, an overnight in a ryokan with kaiseki dinner.\n\n- Max 10 travelers\n- Rail pass, stays, guides, and that dinner included\n- Optional dawn photography walk (worth the alarm)" },
      { type: 'trip', title: 'Atlas & Coast: Morocco', excerpt: 'Marrakech, the mountains, and the sea — ten days, well paced.', fields: { destination: 'Morocco', duration: '10 days', price_usd: 2750, departs: '2027-03-20', book_link: 'https://example.com/book/morocco' }, body: "Souks first, then silence: two nights in the Atlas foothills, ending on the coast at Essaouira.\n\n- Max 12 travelers\n- Riads throughout, all breakfasts, three standout dinners\n- Cooking class with a family in the mountains — the recipe travels home with you" },
    ],
    pages: [
      { title: 'How we travel', body: "Small groups (never more than twelve), local guides who are friends not vendors, and pacing with actual air in it — one anchor plan per day, afternoons that breathe.\n\nEverything's included except flights and souvenirs. One price, no surprise 'optional excursions' ambush at the hotel bar." },
      { title: 'Private trips', body: "Every trip on this site can run privately for your family, friends, or team — same routes, your dates, your pace.\n\nTell us the occasion and the headcount: hello@example.com. Planning starts about four months out." },
    ],
    posts: [
      { title: 'Croatia: two cabins left for September', tags: ['Departures'], excerpt: 'The ferry trip is nearly full — and the water is still warm in September.', body: "September's Croatia departure is down to **two spots**.\n\nIf you've been circling this one: the sea is warmest in early September, the crowds are gone, and the figs are ridiculous. The booking link holds a place for 48 hours." },
    ],
  },

  // ---------- More Creative & Retail ----------
  {
    key: 'bookstore',
    name: 'Bookstore',
    category: 'Creative & Retail',
    description: 'A bookish home — staff picks, events, and opening hours with soul.',
    settings: { theme: 'paper', heading_font: 'serif', layout: 'list', accent_color: '#b45309', site_description: 'Independent since always.' },
    pages: [
      { title: 'Visit', body: "**Hours**: Tue–Sat 10–7, Sun 11–5. Closed Mondays for restocking and recovering.\n\n17 Chapel Lane — two rooms, one resident cat (Dewey, aloof but fair), and a poetry section larger than strictly commercial sense allows.\n\nWe order anything in print: one day for the warehouse, a week for the obscure. No membership required for the reservation shelf." },
      { title: 'Events', body: "**Monthly fixtures:**\n\n- **First Thursday** — author night (wine, questions, signed stock)\n- **Second Sunday** — kids' story hour, chaos welcome\n- **Last Wednesday** — the book club (newcomers absolutely welcome; we pick arguable books on purpose)\n\nAll free. The chairs are limited; the standing room is convivial." },
    ],
    posts: [
      { title: 'Staff picks: what we pressed into hands this month', tags: ['Staff picks'], excerpt: 'Three books we could not stop recommending, one of them at inconvenient volume.', body: "**The novel** — a debut we've hand-sold forty times. When you finish it, come back and talk to us about the ending. We're not done being upset.\n\n**The nonfiction** — narrative history that reads like a thriller; three customers have returned to buy copies for other people.\n\n**The wildcard** — a slim poetry collection Dewey knocked off the shelf twice. We know an endorsement when we see one." },
    ],
  },
  {
    key: 'florist',
    name: 'Florist',
    category: 'Creative & Retail',
    description: 'Seasonal and fresh — arrangements, delivery, weddings.',
    settings: { theme: 'forest', heading_font: 'serif', layout: 'cards', accent_color: '#166534', site_description: 'Flowers with the season, not against it.' },
    pages: [
      { title: 'Order & delivery', body: "## Arrangements\n\n- **Petite** — $35: a small kindness\n- **Classic** — $60: the reliable stunner\n- **Statement** — $95+: for apologies and anniversaries of consequence\n\nTell us the occasion and the palette; we choose from what's best that morning.\n\n**Delivery**: same-day in town for orders by 1pm, $8 flat. We text a photo of what actually went out the door." },
      { title: 'Weddings', body: "From a bouquet-and-buttonholes elopement to the full marquee — we do a handful of weddings a month and never two on one weekend.\n\nSeasonal-first design keeps budgets sane and arrangements alive. Consultations are free and involve tea. Enquire with your date first; everything else can wait." },
    ],
    posts: [
      { title: 'Dahlia season opens this week', tags: ['Seasonal'], excerpt: 'The vans come back from the flower farm loaded — six weeks of the best blooms of the year.', body: "The first dahlias arrived Tuesday and the shop looks like a parade.\n\nDinner-plate darks, sherbet pompoms, and the café-au-lait everyone requests for weddings. Six weeks, give or take a frost — dahlia arrangements are the default until they're gone." },
    ],
  },
  {
    key: 'tattoo',
    name: 'Tattoo studio',
    category: 'Creative & Retail',
    description: 'Bold and clean — artists, booking process, aftercare.',
    settings: { theme: 'noir', heading_font: 'mono', layout: 'cards', accent_color: '#f43f5e', site_description: 'Good work takes a conversation first.' },
    pages: [
      { title: 'Booking', body: "**How it works here:**\n\n1. **Email your idea** — references, placement, rough size\n2. **Consultation** — free, 20 minutes, honest feedback (including 'that won't age well')\n3. **Deposit books the date** — $100, comes off the final price\n\nRates: $150/hr, day rate for large work. Flash days announced on the journal — first come, first inked." },
      { title: 'Aftercare', body: "The tattoo is ours together for two weeks; then it's all yours.\n\n- **Days 1–3**: wrap off after a few hours, wash gently, thin layer of the ointment we gave you\n- **Days 4–14**: moisturize, don't pick, don't swim, don't sunbathe\n- **Forever**: sunscreen. The difference at year ten is enormous.\n\nQuestions? Photos to the studio number any time. We'd rather answer than fix." },
    ],
    posts: [
      { title: 'Guest artist week', tags: ['News'], excerpt: 'A week of fine-line botanical work from a guest we’ve chased for two years.', body: "For one week next month the second chair belongs to a guest artist whose fine-line botanical work we've admired (fine: envied) for years.\n\nBooks open Friday at noon for that week only. Small pieces, waitlist certain, no grudges when it fills in an hour." },
    ],
  },

  // ---------- More Property ----------
  {
    key: 'coworking',
    name: 'Coworking space',
    category: 'Property',
    description: 'Desks and rooms as structured content — capacity, price, availability.',
    settings: { theme: 'default', heading_font: 'sans', layout: 'cards', accent_color: '#4f46e5', site_description: 'Good light, fast wifi, no ping-pong evangelism.' },
    content_types: [
      {
        key: 'space',
        name: 'Space',
        name_plural: 'Spaces',
        schema: [
          { label: 'Capacity', kind: 'number' },
          { label: 'Price per month (USD)', kind: 'number' },
          { label: 'Availability', kind: 'select', options: 'Available, Waitlist, Full' },
        ],
      },
    ],
    items: [
      { type: 'space', title: 'Hot desk', excerpt: 'Any open desk, any day, locker included.', fields: { capacity: 1, price_per_month_usd: 180, availability: 'Available' }, body: "Turn up, pick a desk, plug in. Includes meeting-room credits, locker, and unlimited coffee from the machine that cost more than a car.\n\nMonth to month; pause anytime." },
      { type: 'space', title: 'Dedicated desk', excerpt: 'Your desk, your monitor, your slightly dying plant.', fields: { capacity: 1, price_per_month_usd: 320, availability: 'Waitlist' }, body: "The same desk every day, second monitor provided, personal storage, and squatters' rights to your favorite mug.\n\nCurrently waitlisted — hot-deskers get first refusal as seats open." },
      { type: 'space', title: 'Team room for six', excerpt: 'A lockable room with your name on the door.', fields: { capacity: 6, price_per_month_usd: 1450, availability: 'Available' }, body: "A private, lockable room for up to six: whiteboard walls, your own AC control (the true luxury), and 24/7 access.\n\nIncludes six memberships and double meeting-room credits. Three-month minimum." },
    ],
    pages: [
      { title: 'The building', body: "A converted print works: brick, beams, and the big windows they don't make anymore.\n\n- Gigabit fiber, mesh throughout, wired on request\n- Four meeting rooms, two phone booths\n- Bike storage, showers, actual towels\n- Coffee that a member once called 'the reason I renew'\n\nTours daily at 11 and 3 — or just walk in." },
      { title: 'Membership terms', body: "Everything is month to month except team rooms (three months).\n\nDay passes ($25) exist for the commitment-averse; the first one's free. Your pass works 24/7 from day one — the building believes in your deadline even when you don't." },
    ],
    posts: [],
  },

  // ---------- More Community & Education ----------
  {
    key: 'museum',
    name: 'Museum & gallery',
    category: 'Community & Education',
    description: 'Exhibitions as structured content — dates, galleries, always-current listings.',
    settings: { theme: 'noir', heading_font: 'serif', layout: 'cards', accent_color: '', site_description: 'Small museum, serious collection.' },
    content_types: [
      {
        key: 'exhibition',
        name: 'Exhibition',
        name_plural: 'Exhibitions',
        schema: [
          { label: 'Opens', kind: 'date' },
          { label: 'Closes', kind: 'date' },
          { label: 'Gallery', kind: 'text' },
        ],
      },
    ],
    items: [
      { type: 'exhibition', title: 'Harbor Light: A Century of Coastal Painting', excerpt: 'Fifty works tracing how a hundred years of painters saw the same water.', fields: { opens: '2026-06-15', closes: '2026-11-30', gallery: 'Main Gallery' }, body: "The same harbor, painted for a hundred years, never the same twice. Fifty works from the collection and three key loans, hung chronologically so the light itself seems to change as you walk.\n\nIncluded with admission; guided tours Saturdays at 2." },
      { type: 'exhibition', title: 'Fieldwork: New Photography', excerpt: 'Four early-career photographers on land, labor, and the edge of town.', fields: { opens: '2026-09-01', closes: '2027-01-10', gallery: 'North Wing' }, body: "Our biennial open-call show: four photographers selected from six hundred submissions, each given a wall and a stipend.\n\nThe artists talk happens opening week and is always the season's best argument." },
    ],
    pages: [
      { title: 'Plan your visit', body: "**Hours**: Tue–Sun 10–5, Thursdays until 8 (and pay-what-you-wish from 5).\n\n**Admission**: $12 · under-18s free · members free forever.\n\nStep-free throughout; the courtyard café does a famous lemon cake. Sketching encouraged, pencil only — ask at the desk for a stool." },
      { title: 'Membership', body: "$60 a year: unlimited entry, preview evenings, 10% at the shop and café, and the smug calm of never checking the price of a second visit.\n\nAll of it funds acquisitions and the open-call program. Join at the desk in one minute flat." },
    ],
    posts: [
      { title: 'Acquisition: the sketchbooks', tags: ['Collection'], excerpt: 'Twelve working sketchbooks join the collection — and go straight on display.', body: "The museum has acquired twelve working sketchbooks from the estate of a painter central to our coastal collection.\n\nRather than vault them, we're showing them immediately: a rotating page-turn display in the Main Gallery, one spread a week. Come often; the book won't wait for you." },
    ],
  },
  {
    key: 'church',
    name: 'Church & community',
    category: 'Community & Education',
    description: 'Welcoming and plain-spoken — services, groups, and how to find help.',
    settings: { theme: 'paper', heading_font: 'serif', layout: 'list', accent_color: '', site_description: 'All welcome. Genuinely, all.' },
    pages: [
      { title: 'Services & times', body: "**Sundays**\n\n- 9:00 — quiet traditional service (40 min)\n- 10:30 — main service with music and kids' groups\n\n**Wednesdays** — 7pm, evening prayer, 25 minutes of stillness in a loud week.\n\nCome as you are; nobody checks. Coffee after the 10:30 is arguably a third service." },
      { title: 'Groups & help', body: "## Through the week\n\n- **Food pantry** — Tuesdays 4–6, no questions, no paperwork\n- **Parents & toddlers** — Thursday mornings, chaos and companionship\n- **Youth group** — Fridays 7pm\n\n## Need help, or want to give it?\n\nThe pantry runs on donations and eight volunteers who'd love to be twelve. Either way: office@example.com or just come Tuesday." },
    ],
    posts: [
      { title: 'The winter coat drive returns', tags: ['Community'], excerpt: 'Last year: 214 coats. This year the rack is bigger.', body: "The coat rack goes up in the entrance hall this Sunday.\n\n**Give**: clean coats, all sizes — kids' sizes vanish fastest.\n**Take**: whatever you need, whenever we're open. No sign-up, no questions, no sermon attached.\n\nLast winter neighbors gave 214 coats and took 209. Math like that keeps a place honest." },
    ],
  },
  {
    key: 'daycare',
    name: 'Daycare & preschool',
    category: 'Community & Education',
    description: 'Warm and reassuring — programs, a typical day, enrollment.',
    settings: { theme: 'mint', heading_font: 'sans', layout: 'cards', accent_color: '#0d9488', site_description: 'Big feelings, small chairs, good days.' },
    pages: [
      { title: 'Programs', body: "## Rooms by age\n\n- **Seedlings** (1–2) — ratio 1:3, naps taken seriously\n- **Sprouts** (2–3) — ratio 1:4, potty-training allies\n- **Branches** (3–5) — ratio 1:6, pre-K curriculum smuggled inside play\n\nFull-time and 3-day schedules; breakfast, lunch, and two snacks included (menu posted weekly, allergies rigorously handled)." },
      { title: 'A typical day', body: "**7:30** doors open, slow starts respected · **9:00** circle time · **9:30** outside, almost all weathers · **11:30** lunch, family style · **12:30** nap or quiet books · **3:00** snack, then art, blocks, and the mud kitchen's ongoing renovations · **5:30** pickup, with a note on the day.\n\nPhotos land in the parent app as they happen — the first-steps video has been watched from three offices at once." },
      { title: 'Enrollment', body: "1. **Tour** — Tuesdays and Thursdays at 10, kids welcome on the tour\n2. **Waitlist** — $50, applied to first month\n3. **Settling-in week** — short days, a parent nearby, tissues for the parent\n\nCurrent openings change monthly; the waitlist moves faster than its reputation. Ask about sibling priority." },
    ],
    posts: [
      { title: 'The mud kitchen grand reopening', tags: ['News'], excerpt: 'Renovated by popular demand (the demand was mud).', body: "After a weekend of parent-volunteer carpentry, the mud kitchen reopens Monday: two sinks, a pulley system, and a menu board where the specials are always mud.\n\nSend children in clothes you've made peace with. Laundry is the tuition's hidden fee, and Monday it compounds." },
    ],
  },

  // ---------- More Product & Publishing ----------
  {
    key: 'newsletter',
    name: 'Newsletter & magazine',
    category: 'Product & Publishing',
    description: 'An issues-first publication site — archive, about, and a subscribe pitch.',
    settings: { theme: 'paper', heading_font: 'serif', layout: 'list', accent_color: '#dc2626', site_description: 'One considered essay, every Sunday.' },
    pages: [
      { title: 'About', body: "One essay every Sunday morning: reported, edited, and short enough to finish with one coffee.\n\nNo growth hacks, no 'link roundups', no apologies for skipping a week when the piece isn't ready. 11,000 readers; the [RSS feed](/feed.xml) and the archive are free forever." },
      { title: 'Subscribe', body: "**Free**: every essay, every Sunday, plus the full archive.\n\n**Supporter — $5/mo**: the same essays (paywalls poison the discourse) plus the monthly mailbag issue and a vote on the yearly deep-dive topic.\n\nSupporters currently fund 100% of the reporting travel. That's the whole business model, and it's working." },
    ],
    posts: [
      { title: 'Issue 142: The last phone box in town', tags: ['Issue'], excerpt: 'Someone keeps cleaning it. It took three weeks to find out who.', body: "There's one working phone box left here, and someone has been cleaning it — glass polished, dead leaves swept, a jar of flowers replaced weekly.\n\nIt took three weeks of asking to find the who, and the why turned out to be the whole story. It involves a promise made in 1974.\n\n*The full essay ran Sunday; this is the archive copy.*" },
      { title: 'Issue 141: Why the bakery queue moves left', tags: ['Issue'], excerpt: 'A four-minute essay about a fifteen-meter queue.', body: "Every Saturday, the bakery queue bends left against all architectural logic. The reason is one chair, one regular, and twenty years of collective, unspoken courtesy.\n\nSmall systems essay, the kind readers either love or politely endure. The mailbag suggests: love, narrowly." },
    ],
  },
  {
    key: 'podcast',
    name: 'Podcast',
    category: 'Product & Publishing',
    description: 'An episode-first show site — notes, links, and where to listen.',
    settings: { theme: 'midnight', heading_font: 'sans', layout: 'list', accent_color: '#a855f7', site_description: 'Conversations that run long on purpose.' },
    pages: [
      { title: 'About the show', body: "Long-form conversations with people who make things — one guest, two hours, no segment music.\n\nNew episodes every other Tuesday. Find it wherever you listen, or take the [RSS feed](/feed.xml) straight, as nature intended.\n\n**Pitch a guest**: show@example.com. We read everything; we book slowly." },
      { title: 'Support & sponsors', body: "The show is listener-funded first: supporters get episodes a week early and the unedited cuts (rambles included).\n\nWe take two sponsors per episode, read live, only for things we've actually used. The register of everything we've ever advertised — and what we still use — lives on this page. Currently: 9 of 14." },
    ],
    posts: [
      { title: 'Ep. 87 — The bridge engineer', tags: ['Episode'], excerpt: 'Two hours on load, failure, and why she walks her bridges at night.', body: "This week: a structural engineer with forty years of bridges behind her.\n\n**We talk about**: the load calculation she still does by hand, the collapse that changed the codes, and why she visits her bridges at night ('they're honest at night — no traffic to flatter them').\n\n**Links from the episode** are below the player. The last twenty minutes are the best thing we've aired this year." },
      { title: 'Ep. 86 — The typeface revivalist', tags: ['Episode'], excerpt: 'Digging 19th-century letters out of specimen books and back onto your screen.', body: "A conversation with a type designer who revives dead typefaces — from water-damaged specimen books to the font menu.\n\n**Covered**: the ethics of reviving a dead designer's work, the letter 'g' as a career, and the revival that turned out to be a forgery of a forgery." },
    ],
  },
];

/** The template list as sent to the admin UI (no bodies — keep it light). */
function templateSummaries() {
  return TEMPLATES.map((t) => ({
    key: t.key,
    name: t.name,
    category: t.category,
    description: t.description,
    theme: t.settings.theme,
    accent_color: t.settings.accent_color || '',
    heading_font: t.settings.heading_font,
    layout: t.settings.layout,
    pages: t.pages.length,
    posts: t.posts.length,
    items: (t.items || []).length,
    types: (t.content_types || []).length,
  }));
}

function getTemplate(key) {
  return TEMPLATES.find((t) => t.key === key) || null;
}

const str = (v, max = 400) => String(v == null ? '' : v).trim().slice(0, max);
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

/** Clamp an untrusted site spec (e.g. AI output) to safe, valid values. */
function normalizeSite(spec = {}) {
  const items = (list, max, withType = false) =>
    (Array.isArray(list) ? list : [])
      .slice(0, max)
      .map((it) => ({
        title: str(it && it.title, 200),
        body: str(it && it.body, 20000),
        excerpt: str(it && it.excerpt, 500),
        format: pick(it && it.format, VALID_FORMATS, 'markdown'),
        tags: (Array.isArray(it && it.tags) ? it.tags : []).slice(0, 5).map((t) => str(t, 40)).filter(Boolean),
        ...(withType
          ? {
              type: str(it && it.type, 40),
              fields: it && it.fields && typeof it.fields === 'object' && !Array.isArray(it.fields) ? it.fields : {},
            }
          : {}),
      }))
      .filter((it) => it.title);
  return {
    site_title: str(spec.site_title, 120),
    site_description: str(spec.site_description, 300),
    theme: pick(spec.theme, VALID_THEMES, 'default'),
    accent_color: /^#[0-9a-f]{3,8}$/i.test(spec.accent_color || '') ? spec.accent_color : '',
    heading_font: pick(spec.heading_font, VALID_FONTS, 'sans'),
    layout: pick(spec.layout, VALID_LAYOUTS, 'cards'),
    content_types: (Array.isArray(spec.content_types) ? spec.content_types : [])
      .slice(0, 4)
      .map((ct) => ({
        key: str(ct && ct.key, 40),
        name: str(ct && ct.name, 60),
        name_plural: str(ct && ct.name_plural, 60),
        schema: Array.isArray(ct && ct.schema) ? ct.schema : [],
      }))
      .filter((ct) => ct.name || ct.key),
    pages: items(spec.pages, 6),
    posts: items(spec.posts, 8),
    items: items(spec.items, 12, true),
  };
}

/** Apply a site spec to a company: settings, custom content types, and
    published starter content. Returns { settings, created, types }. */
function applySite(teamId, spec, user) {
  const db = getDb();
  const putSetting = db.prepare(
    `INSERT INTO team_settings (team_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(team_id, key) DO UPDATE SET value = excluded.value`
  );
  const applied = {};
  for (const key of SETTING_KEYS) {
    if (spec.settings ? spec.settings[key] !== undefined : spec[key] !== undefined) {
      const value = String((spec.settings ? spec.settings[key] : spec[key]) ?? '');
      putSetting.run(teamId, key, value);
      applied[key] = value;
    }
  }

  // Custom content types first, so typed items validate against them.
  // Existing keys are left untouched — re-applying a kit never clobbers.
  let typesCreated = 0;
  for (const ct of spec.content_types || []) {
    const key = slugify(ct.key || ct.name || '').slice(0, 40);
    if (!key || BUILTIN_TYPES.includes(key) || getType(teamId, key)) continue;
    const normalized = normalizeSchema(ct.schema);
    if (normalized.error) continue;
    const name = String(ct.name || key).slice(0, 60);
    db.prepare('INSERT INTO content_types (team_id, key, name, name_plural, schema) VALUES (?, ?, ?, ?, ?)').run(
      teamId,
      key,
      name,
      String(ct.name_plural || `${name}s`).slice(0, 60),
      JSON.stringify(normalized.schema)
    );
    typesCreated++;
  }

  const insertContent = db.prepare(
    `INSERT INTO content (team_id, type, title, slug, body, format, excerpt, status, author_id, fields, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, datetime('now'))`
  );
  const findTag = db.prepare('SELECT id FROM tags WHERE team_id = ? AND slug = ?');
  const insertTag = db.prepare('INSERT INTO tags (team_id, name, slug) VALUES (?, ?, ?)');
  const linkTag = db.prepare('INSERT OR IGNORE INTO content_tags (content_id, tag_id) VALUES (?, ?)');

  let created = 0;
  const insertItem = (type, item) => {
    const finalType = BUILTIN_TYPES.includes(type) || getType(teamId, type) ? type : 'post';
    const fieldCheck = validateFields(teamId, finalType, item.fields || {});
    const slug = uniqueSlug(item.title, teamId);
    const result = insertContent.run(
      teamId, finalType, item.title, slug,
      item.body || '', item.format || 'markdown', item.excerpt || '',
      user ? user.id : null,
      JSON.stringify(fieldCheck.values || {})
    );
    for (const name of item.tags || []) {
      const tagSlug = slugify(name);
      const existing = findTag.get(teamId, tagSlug);
      const tagId = existing ? existing.id : insertTag.run(teamId, name, tagSlug).lastInsertRowid;
      linkTag.run(result.lastInsertRowid, tagId);
    }
    created++;
  };

  db.transaction(() => {
    for (const page of spec.pages || []) insertItem('page', page);
    for (const post of spec.posts || []) insertItem('post', post);
    for (const item of spec.items || []) insertItem(slugify(item.type || 'post'), item);
  })();

  return { settings: applied, created, types: typesCreated };
}

module.exports = { TEMPLATES, templateSummaries, getTemplate, normalizeSite, applySite, VALID_THEMES };
