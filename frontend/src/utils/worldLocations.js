// Worldwide countries -> states/provinces -> cities for International events.
// Data comes from the `country-state-city` package, bundled with the app (no
// internet or API key needed at runtime). It is loaded on demand, only when
// someone actually opens an International event form, so the large dataset
// never slows down the rest of EMS.

let libraryPromise = null;

export function loadWorldLocations() {
  if (!libraryPromise) {
    libraryPromise = import("country-state-city").then((mod) => (mod.Country ? mod : mod.default));
  }
  return libraryPromise;
}

// Used for the "Other / Enter manually" choice in every location list.
export const MANUAL_OPTION = "Other";
export const MANUAL_LABEL = "Other / Enter manually";

// Plain letters only: "Ādīs Ābeba" -> "Adis Abeba" (drops macrons and other accent marks).
function plainText(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC");
}

function uniqueSorted(names) {
  return [...new Set(names.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function listCountries(lib) {
  return lib.Country.getAllCountries();
}

export function findCountry(lib, name) {
  if (!name || name === MANUAL_OPTION) return null;
  return listCountries(lib).find((c) => c.name === name) || null;
}

export function listStates(lib, country) {
  if (!country) return [];
  return lib.State.getStatesOfCountry(country.isoCode) || [];
}

export function findState(states, name) {
  if (!name || name === MANUAL_OPTION) return null;
  return states.find((s) => s.name === name) || null;
}

// Cities of the chosen state/province where the data has them; otherwise
// every city we know of in the country, so the list is never empty by accident.
export function listCityNames(lib, country, state) {
  if (!country) return [];
  if (state) {
    const inState = lib.City.getCitiesOfState(country.isoCode, state.isoCode) || [];
    if (inState.length > 0) return uniqueSorted(inState.map((c) => plainText(c.name)));
  }
  return uniqueSorted((lib.City.getCitiesOfCountry(country.isoCode) || []).map((c) => plainText(c.name)));
}

// What gets saved: a typed-in value replaces the "Other" choice.
export function resolveLocation(form) {
  const pick = (value, other) => (value === MANUAL_OPTION ? (other || "").trim() : (value || "").trim());
  return {
    country: pick(form.country, form.countryOther),
    region: pick(form.region, form.regionOther),
    city: pick(form.city, form.cityOther),
  };
}
