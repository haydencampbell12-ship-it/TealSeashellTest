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
  contactEmail: "",
  contactPhone: "",
  // Put photos in public/img/photos/ and list them here, e.g.
  // { src: "/img/photos/balcony.jpg", alt: "Balcony view of the Gulf" }
  photos: []
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
  // Florida sales tax 7% + Bay County tourist tax 5% + Panama City Beach 1%.
  // Confirm with the Florida DOR and Bay County before going live.
  taxRate: 0.13,
  maxNights: 120,
  bookingWindowDays: 540,
  // Used only for the "you save vs. Airbnb" estimate shown to guests
  airbnbGuestFeeEstimate: 0.14,
  // Hours an approved guest has to pay before the dates are released (max 23 for Stripe)
  holdHours: 23
};
