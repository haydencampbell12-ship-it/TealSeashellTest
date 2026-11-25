// ------------------------------------------------------------------
// The Teal Seashell — property details and pricing.
// Edit this file to change rates, fees or listing text, then redeploy.
// ------------------------------------------------------------------
export const PROPERTY = {
  name: "The Teal Seashell",
  tagline: "A Gulf-front studio at historic Fontainebleau Terrace",
  location: "Panama City Beach, Florida",
  address: "Fontainebleau Terrace, 14401 Front Beach Rd, Panama City Beach, FL 32413",
  maxGuests: 3,
  checkInTime: "4:00 PM",
  checkOutTime: "10:00 AM",
  // Links shown as "also available on" — fill in your listing URLs
  airbnbUrl: "",
  vrboUrl: "",
  contactEmail: "renae@thetealseashell.com",
  contactPhone: "",
  // Check-out checklist. Shown on the website and reused in guest messages.
  checkoutSteps: [
    "Wash any dirty dishes with the provided dish soap and leave them in the sink.",
    "Put used towels and washcloths in the tub.",
    "Empty all of your items from the fridge.",
    "Take the trash to the dumpster.",
    "Leave the wristbands on the counter. There is a $25 charge for each missing band.",
    "Set the thermostat to 74° and turn off the lights.",
    "The door locks automatically behind you. Your door code stops working at 10:00 AM (check-out time)."
  ],
  // Photos live in public/img/photos/ (full size + "-sm" thumbnail, both .webp).
  // The first five show on the home page; all of them show on /photos.
  photos: [
    { src: "/img/photos/studio.webp", thumb: "/img/photos/studio-sm.webp", alt: "The studio: bed, sofa and kitchenette under white beamed ceilings" },
    { src: "/img/photos/living-kitchen.webp", thumb: "/img/photos/living-kitchen-sm.webp", alt: "Looking from the bed toward the TV, breakfast bar and kitchenette" },
    { src: "/img/photos/gulf-view.webp", thumb: "/img/photos/gulf-view-sm.webp", alt: "The Gulf framed by the building's vintage breeze-block walls" },
    { src: "/img/photos/pool.webp", thumb: "/img/photos/pool-sm.webp", alt: "Beachfront pool and sun deck at Fontainebleau Terrace" },
    { src: "/img/photos/beach-deck.webp", thumb: "/img/photos/beach-deck-sm.webp", alt: "Covered deck right above the sand, looking down the beach" },
    { src: "/img/photos/covered-deck.webp", thumb: "/img/photos/covered-deck-sm.webp", alt: "Shaded deck with teal Adirondack chairs" },
    { src: "/img/photos/kitchenette.webp", thumb: "/img/photos/kitchenette-sm.webp", alt: "Kitchenette with two-burner cooktop, coffee maker and cookware" },
    { src: "/img/photos/kitchen-bath.webp", thumb: "/img/photos/kitchen-bath-sm.webp", alt: "Kitchenette and bathroom vanity" }
  ]
};

// Rates are based on other studios at Fontainebleau Terrace (Nov 2026 survey).
export const PRICING = {
  currency: "usd",
  // No night is ever priced below this, including after the weekly discount.
  nightlyFloor: 117,

  // Base seasons. start is inclusive, end is exclusive, both "MM-DD".
  seasons: [
    { name: "Winter", start: "01-01", end: "03-01", nightly: 117, minNights: 2 },
    { name: "Spring", start: "03-01", end: "06-01", nightly: 159, minNights: 3 },
    { name: "Summer", start: "06-01", end: "08-16", nightly: 199, minNights: 3 },
    { name: "Late summer", start: "08-16", end: "09-01", nightly: 159, minNights: 3 },
    { name: "Fall", start: "09-01", end: "11-01", nightly: 139, minNights: 2 },
    { name: "Winter", start: "11-01", end: "13-01", nightly: 117, minNights: 2 } // "13-01" = through Dec 31
  ],

  // Friday and Saturday nights cost more outside holidays.
  weekend: { nights: [5, 6], percent: 12 },

  // Holidays and school breaks. These replace the season rate for those nights.
  // A date range uses "MM-DD" (end exclusive, may wrap into January).
  // An anchored holiday moves each year: start/end are days relative to the holiday.
  // When two overlap, the higher rate wins. minNights applies when check-in falls inside.
  holidays: [
    { name: "Spring break", start: "03-07", end: "04-13", nightly: 189, minNights: 4 },
    { name: "Easter weekend", anchor: "easter", from: -3, to: 1, nightly: 209, minNights: 3 },
    { name: "Memorial Day weekend", anchor: "memorialDay", from: -3, to: 0, nightly: 249, minNights: 3 },
    { name: "Fourth of July", start: "07-01", end: "07-06", nightly: 289, minNights: 4 },
    { name: "Labor Day weekend", anchor: "laborDay", from: -3, to: 0, nightly: 199, minNights: 3 },
    { name: "Thanksgiving", anchor: "thanksgiving", from: -1, to: 4, nightly: 149, minNights: 3 },
    { name: "Christmas", start: "12-21", end: "12-30", nightly: 159, minNights: 4 },
    { name: "New Year's", start: "12-30", end: "01-02", nightly: 189, minNights: 3 },
    { name: "Valentine's weekend", start: "02-13", end: "02-15", nightly: 149, minNights: 2 }
  ],

  // Snowbird monthly rate: stays of 28+ nights that start in these months.
  // Note: this works out to about $65/night, below nightlyFloor, on purpose.
  monthly: { months: [11, 12, 1, 2], minNights: 28, perMonth: 1950 },
  weeklyDiscount: { minNights: 7, percent: 10 },
  cleaningFee: 125,
  // Lodging taxes on direct bookings (charged on lodging + cleaning fee).
  // Each is filed separately: Florida sales tax (6% state + 1% Bay County surtax)
  // with the Florida Department of Revenue, the tourist development tax with the
  // Bay County Tax Collector, and the business tax with the City of Panama City Beach.
  taxes: [
    { key: "fl_sales", label: "Florida sales tax (7%)", rate: 0.07 },
    { key: "bay_tdt", label: "Bay County tourist development tax (5%)", rate: 0.05 },
    { key: "pcb_btr", label: "Panama City Beach business tax (1%)", rate: 0.01 }
  ],
  maxNights: 120,
  bookingWindowDays: 540,
  // Used only for the "you save vs. Airbnb" estimate shown to guests
  airbnbGuestFeeEstimate: 0.14,
  // Hours an approved guest has to pay before the dates are released (max 23 for Stripe)
  holdHours: 23
};

// Combined lodging tax rate, e.g. 0.13
export const TAX_RATE = PRICING.taxes.reduce((a, t) => a + t.rate, 0);

// Refundable damage hold. On check-in day the site places a hold for this amount
// on the card the guest paid with, then releases it automatically a few days after
// check-out unless you charge part or all of it from the dashboard.
// Card holds last about 7 days, so on stays longer than about 5 nights the bank
// may release it before check-out.
export const DAMAGE_HOLD = { amount: 250, releaseDaysAfterCheckout: 2 };
