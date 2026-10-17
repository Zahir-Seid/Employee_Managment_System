// Region -> City data for the Create/Edit Event location step. Includes an
// "Other" option on both dropdowns since no fixed list can be fully
// exhaustive, picking "Other" reveals a free-text field instead.
export const ETHIOPIA_REGIONS = [
  "Addis Ababa",
  "Dire Dawa",
  "Afar",
  "Amhara",
  "Benishangul-Gumuz",
  "Gambela",
  "Harari",
  "Oromia",
  "Sidama",
  "SNNPR",
  "Somali",
  "South West Ethiopia",
  "Tigray",
  "Other",
];

export const CITIES_BY_REGION = {
  "Addis Ababa": ["Addis Ababa"],
  "Dire Dawa": ["Dire Dawa"],
  Afar: ["Semera", "Asaita", "Dubti"],
  Amhara: ["Bahir Dar", "Gondar", "Dessie", "Debre Birhan", "Debre Markos"],
  "Benishangul-Gumuz": ["Asosa", "Metekel"],
  Gambela: ["Gambela"],
  Harari: ["Harar"],
  Oromia: ["Adama", "Jimma", "Bishoftu", "Nekemte", "Shashamane", "Ambo"],
  Sidama: ["Hawassa"],
  SNNPR: ["Wolaita Sodo", "Arba Minch", "Hosaena"],
  Somali: ["Jijiga", "Gode"],
  "South West Ethiopia": ["Bonga", "Tepi"],
  Tigray: ["Mekelle", "Adigrat", "Axum"],
  Other: [],
};

export function citiesForRegion(region) {
  return [...(CITIES_BY_REGION[region] || []), "Other"];
}

// Item #2: Thematic Area is now a fixed set of exactly 5 values (down from
// the old long curated list), this is the ONE place they're defined.
// Create Event and the Dashboard's Thematic Area filter both import this
// array, so they can't drift out of sync with each other.
export const THEMATIC_AREA_OPTIONS = [
  "Data and Digital Health",
  "RMNCH",
  "Immunization",
  "Supply Chain",
  "Health Security",
];

// Item #1: Lead Organization becomes a dropdown of known/frequent partners,
// with "Other" revealing a free-text field so uncommon organizations still
// aren't blocked.
export const LEAD_ORGANIZATIONS = ["EE", "MOH", "EPHI", "USAID", "WHO", "UNICEF", "Other"];
