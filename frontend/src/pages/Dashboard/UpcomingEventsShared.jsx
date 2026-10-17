import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { dashboardApi } from "../../api/dashboard";
import { useAuth } from "../../auth/AuthContext.jsx";
import { FilterSelect, ListSearch } from "../../components/common/ListControls.jsx";
import { formatDate } from "../../utils/format";

// Dashboard Upcoming Events Enhancement, pieces shared by the compact
// Dashboard card (UpcomingEventsCard.jsx) and the "View All" full page
// (UpcomingEventsPage.jsx), so the two stay in visual/behavioral sync
// instead of drifting apart as two independent implementations.

export const EMPTY_UPCOMING_EVENT_FILTERS = {
  search: "",
  date_from: "",
  date_to: "",
  category: "",
  thematic_area: "",
  region: "",
  owner: "",
  status: "",
};

// True when there are no upcoming events at all, ignoring the card's or page's
// own filters. The card and the View All page disappear in that case instead of
// showing an empty message; with filters that merely match nothing they stay so
// the filters can still be cleared.
export async function hasNoUpcomingEvents(filters, results) {
  if (results.length > 0) return false;
  const filtersApplied = JSON.stringify(filters) !== JSON.stringify(EMPTY_UPCOMING_EVENT_FILTERS);
  if (!filtersApplied) return true;
  const { data } = await dashboardApi.getUpcomingEvents({ page_size: 1 });
  return !(data.count > 0);
}

// Drops empty values so the request only sends the filters actually set ,
// same convention as the rest of the Dashboard (see Dashboard.jsx's own
// param-building before calling dashboardApi.get).
export function buildUpcomingEventsParams(filters, extra) {
  const params = { ...extra };
  for (const [key, value] of Object.entries(filters)) {
    if (value) params[key] = value;
  }
  return params;
}

// Fetched once and shared, the dropdown values never change based on the
// currently-selected filters (see the backend's filter-options endpoint
// docstring), so there's no reason to refetch this per filter change.
export function useUpcomingEventFilterOptions() {
  const [options, setOptions] = useState(null);
  useEffect(() => {
    let cancelled = false;
    dashboardApi
      .getUpcomingEventsFilterOptions()
      .then(({ data }) => {
        if (!cancelled) setOptions(data);
      })
      .catch(() => {
        if (!cancelled) setOptions(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return options;
}

// `fields` controls which controls render, the compact Dashboard card
// only has room for a handful (spec's own wireframe shows Search/
// Category/Thematic/Owner/Date on the card, with Region/Status reserved
// for the full "View All" page, which has more room). There is no Program
// filter: events have no Program field separate from Category.
export function UpcomingEventsFilterBar({ filters, onChange, options, fields, showSearch }) {
  const set = (key) => (e) => onChange({ ...filters, [key]: e.target.value });
  const has = (key) => fields.includes(key);

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {showSearch && (
        <ListSearch
          placeholder="Event title..."
          value={filters.search}
          onChange={set("search")}
        />
      )}
      {has("category") && (
        <FilterSelect className="max-w-[200px]" value={filters.category} onChange={set("category")}>
          <option value="">All Categories</option>
          {/* Deep-linked multi-category value (Big Events' "View All",
              e.g. "international,national") doesn't match any single
              option below, shown as its own selected option rather
              than looking like nothing is selected, until the person
              picks a single category from the list instead. */}
          {filters.category.includes(",") && (
            <option value={filters.category}>Big Events (International + National)</option>
          )}
          {(options?.categories || []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </FilterSelect>
      )}
      {has("thematic_area") && (
        <FilterSelect className="max-w-[200px]" value={filters.thematic_area} onChange={set("thematic_area")}>
          <option value="">All Thematic Areas</option>
          {(options?.thematic_areas || []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </FilterSelect>
      )}
      {has("region") && (
        <FilterSelect className="max-w-[200px]" value={filters.region} onChange={set("region")}>
          <option value="">All Regions</option>
          {(options?.regions || []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </FilterSelect>
      )}
      {has("owner") && (
        <FilterSelect className="max-w-[200px]" value={filters.owner} onChange={set("owner")}>
          <option value="">All Owners/Staff</option>
          {(options?.owners || []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </FilterSelect>
      )}
      {has("status") && (
        <FilterSelect className="max-w-[200px]" value={filters.status} onChange={set("status")}>
          <option value="">All Statuses</option>
          {(options?.statuses || []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </FilterSelect>
      )}
      {has("date_from") && (
        <span className="flex min-w-0 max-w-[210px] flex-1 items-center gap-1.5 text-sm text-ink-faint">
          From
          <input type="date" className="form-input min-w-0 py-1.5" value={filters.date_from} onChange={set("date_from")} />
        </span>
      )}
      {has("date_to") && (
        <span className="flex min-w-0 max-w-[210px] flex-1 items-center gap-1.5 text-sm text-ink-faint">
          {has("date_from") ? "To" : "Date"}
          <input type="date" className="form-input min-w-0 py-1.5" value={filters.date_to} onChange={set("date_to")} />
        </span>
      )}
      {Object.values(filters).some(Boolean) && (
        <button
          type="button"
          className="shrink-0 whitespace-nowrap text-xs text-ems-primary hover:underline"
          onClick={() => onChange({ ...EMPTY_UPCOMING_EVENT_FILTERS })}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

// List view, laid out as the spec's wireframe shows: Event / Date /
// Category / Owner columns, with Thematic Area and Location on a second
// line under the title so every field the spec lists is still visible
// without crowding the card.
//
// Staff can now SEE every staff member's upcoming events, but the Event
// Details page is still owner-only for Staff (FR3, unchanged), so a
// Staff user's click on someone else's event would only hit a 404. Those
// rows are therefore plain, non-clickable text for Staff; their own
// events, and every event for every other role (who can already open any
// event), stay links.
export function UpcomingEventsTable({ events }) {
  const { user, isStaffOnly } = useAuth();
  const navigate = useNavigate();
  const canOpen = (e) => !isStaffOnly || String(e.owner_id) === String(user?.id);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-ink-faint text-xs uppercase border-b border-line">
          <tr>
            <th className="text-left py-2 pr-4 font-semibold">Event</th>
            <th className="text-left py-2 pr-4 font-semibold whitespace-nowrap">Date</th>
            <th className="text-left py-2 pr-4 font-semibold">Category</th>
            <th className="text-left py-2 font-semibold">Owner</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {events.map((e) => {
            const openable = canOpen(e);
            return (
              <tr
                key={e.id}
                onClick={
                  openable
                    ? (domEvent) => {
                        if (domEvent.target.closest("a, button")) return;
                        navigate(`/events/${e.id}`);
                      }
                    : undefined
                }
                className={openable ? "cursor-pointer hover:bg-surface-muted/60" : undefined}
              >
                <td className="py-2.5 pr-4 align-top whitespace-nowrap">
                  {openable ? (
                    <Link to={`/events/${e.id}`} className="font-semibold text-ink hover:underline">
                      {e.title}
                    </Link>
                  ) : (
                    <span className="font-semibold text-ink cursor-default">{e.title}</span>
                  )}
                  <p className="text-xs text-ink-faint mt-0.5">
                    {[e.thematic_area, e.region].filter(Boolean).join(", ")}
                  </p>
                </td>
                <td className="py-2.5 pr-4 align-top whitespace-nowrap text-ink-muted">{formatDate(e.start_date)}</td>
                <td className="py-2.5 pr-4 align-top font-semibold text-ems-primary">{e.category}</td>
                <td className="py-2.5 align-top text-ink-muted">{e.owner_name}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
