import { useEffect, useMemo, useState } from "react";
import SearchableSelect from "../common/SearchableSelect.jsx";
import {
  MANUAL_OPTION,
  findCountry,
  findState,
  listCityNames,
  listCountries,
  listStates,
  loadWorldLocations,
} from "../../utils/worldLocations.js";

// Country -> Region/State/Province -> City for International events, worldwide.
// Every list is searchable (type to find it) and ends with "Other / Enter
// manually"; picking that, or a country/region the dataset has no list for,
// shows a plain text box. Changing the country clears region and city, and
// changing the region clears the city, so a mismatched combination
// (e.g. Kenya + a Swiss canton) can never be left behind.
//
// `value` holds { country, countryOther, region, regionOther, city, cityOther };
// `onChange(patch)` merges a partial update. Renders three grid cells.
export default function InternationalLocationFields({ value, onChange, errors = {} }) {
  const [lib, setLib] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadWorldLocations()
      .then((loaded) => {
        if (!cancelled) setLib(loaded);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const country = useMemo(() => (lib ? findCountry(lib, value.country) : null), [lib, value.country]);
  const states = useMemo(() => (lib && country ? listStates(lib, country) : []), [lib, country]);
  const state = useMemo(() => findState(states, value.region), [states, value.region]);
  const countryNames = useMemo(() => (lib ? listCountries(lib).map((c) => c.name) : []), [lib]);
  const stateNames = useMemo(() => states.map((s) => s.name).sort((a, b) => a.localeCompare(b)), [states]);
  const cityNames = useMemo(() => (lib && country ? listCityNames(lib, country, state) : []), [lib, country, state]);

  function changeCountry(next) {
    if (next === value.country) return;
    onChange({ country: next, countryOther: "", region: "", regionOther: "", city: "", cityOther: "" });
  }
  function changeRegion(next) {
    if (next === value.region) return;
    onChange({ region: next, regionOther: "", city: "", cityOther: "" });
  }
  function changeCity(next) {
    onChange({ city: next, cityOther: "" });
  }

  // No dropdown possible: the list couldn't load, "Other" was chosen for the
  // country, or the dataset has nothing for this country/region.
  const typeRegion = loadFailed || value.country === MANUAL_OPTION || (country && stateNames.length === 0);
  const typeCity = typeRegion || (country && cityNames.length === 0);

  return (
    <>
      <div>
        <label className="form-label">
          Country <span className="text-warning">*</span>
        </label>
        {loadFailed ? (
          <input
            className="form-input"
            placeholder="Type the country"
            value={value.countryOther || ""}
            onChange={(e) => onChange({ country: MANUAL_OPTION, countryOther: e.target.value })}
          />
        ) : (
          <SearchableSelect
            options={countryNames}
            value={value.country}
            placeholder={lib ? "Search or select a country..." : "Loading countries..."}
            disabled={!lib}
            onChange={changeCountry}
          />
        )}
        {!loadFailed && value.country === MANUAL_OPTION && (
          <input
            className="form-input mt-2"
            placeholder="Type the country"
            value={value.countryOther || ""}
            onChange={(e) => onChange({ countryOther: e.target.value })}
          />
        )}
        {loadFailed && (
          <p className="text-xs text-ink-faint mt-1">The worldwide list couldn't be loaded, so type the location instead.</p>
        )}
        {errors.country && <p className="form-error">{errors.country}</p>}
      </div>

      <div>
        <label className="form-label">
          Region / State / Province <span className="text-warning">*</span>
        </label>
        {typeRegion ? (
          <input
            className="form-input"
            placeholder="Type the region, state or province"
            disabled={!value.country}
            value={value.regionOther || ""}
            onChange={(e) => onChange({ region: MANUAL_OPTION, regionOther: e.target.value })}
          />
        ) : (
          <SearchableSelect
            options={stateNames}
            value={value.region}
            placeholder={value.country ? "Search or select..." : "Select a country first"}
            disabled={!value.country}
            onChange={changeRegion}
          />
        )}
        {!typeRegion && value.region === MANUAL_OPTION && (
          <input
            className="form-input mt-2"
            placeholder="Type the region, state or province"
            value={value.regionOther || ""}
            onChange={(e) => onChange({ regionOther: e.target.value })}
          />
        )}
        {errors.region && <p className="form-error">{errors.region}</p>}
      </div>

      <div>
        <label className="form-label">
          City <span className="text-warning">*</span>
        </label>
        {typeCity ? (
          <input
            className="form-input"
            placeholder="Type the city"
            disabled={!value.region && !typeRegion}
            value={value.cityOther || ""}
            onChange={(e) => onChange({ city: MANUAL_OPTION, cityOther: e.target.value })}
          />
        ) : (
          <SearchableSelect
            options={cityNames}
            value={value.city}
            placeholder={value.region ? "Search or select a city..." : "Select a region first"}
            disabled={!value.region}
            onChange={changeCity}
          />
        )}
        {!typeCity && value.city === MANUAL_OPTION && (
          <input
            className="form-input mt-2"
            placeholder="Type the city"
            value={value.cityOther || ""}
            onChange={(e) => onChange({ cityOther: e.target.value })}
          />
        )}
        {errors.city && <p className="form-error">{errors.city}</p>}
      </div>
    </>
  );
}
