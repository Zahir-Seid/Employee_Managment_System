import { usePersistentState } from "../../utils/persistentFilters.js";
import { useEffect, useRef, useState } from "react";
import { eventsApi } from "../../api/events";
import { reportsApi } from "../../api/reports";
import CategoryBadge from "../../components/common/CategoryBadge.jsx";
import EmptyState from "../../components/common/EmptyState.jsx";
import StatusBadge from "../../components/common/StatusBadge.jsx";
import Pagination from "../../components/common/Pagination.jsx";
import { ColumnsMenu, FilterSelect, ListSearch, useColumnVisibility } from "../../components/common/ListControls.jsx";
import { PageLoader } from "../../components/common/Spinner.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { configApi } from "../../api/configuration";
import { ETHIOPIA_REGIONS } from "../../utils/locations";
import { MODE_OF_EVENT_LABELS, extractErrorMessage, formatDateRange, formatEventType } from "../../utils/format";
import SortableTh from "../../components/common/SortableTh.jsx";
import { useSort } from "../../utils/useSort.js";

const SCOPES = [
  { value: "generic", label: "Generic" },
  { value: "single_event", label: "Single Event" },
];

// Filter dropdowns list real regions plus "Other" (for data-entry);
// "Other" doesn't make sense as a filter value here, so it's excluded.
const REGION_OPTIONS = ETHIOPIA_REGIONS.filter((r) => r !== "Other");

// --- Event Report preview (staff-supplied Event_Report_TEMPLATE_REPLICA.docx) ---
// Mirrors apps/reports/services/docx_generator.py's _add_event_report_body
// exactly, same section order (I-VII), same table layout, same field
// logic, so what's on screen is what actually ends up in the exported
// PDF/Word. Reused for Generic and Thematic Area scope too (looped, one
// call per matching event), since all three scopes now render this same
// per-event template. See that function's docstring for what was
// deliberately excluded ("Project name", "DUP's role") and what maps to
// an existing field despite not being an obvious name match
// ("Personal Objective" -> Event.personal_objective, "Event Objective" ->
// Event.expected_outcome).
//
// `boxed`: the Introduction/Participant Summary sections (which already
// have their own bordered table doing the visual separation) stay as a
// plain heading; the narrative-only sections from Objectives onward get
// a shaded, left-accented callout so they read as distinct blocks on an
// otherwise text-heavy page. Matches the EE-supplied template design.
function DocSection({ title, children, boxed }) {
  if (boxed) {
    return (
      <div className="mt-6 first:mt-0 bg-surface-muted border-l-4 pl-4 pr-4 py-4 rounded-r" style={{ borderColor: "#0F1F3D" }}>
        <h3 className="text-[15px] font-bold" style={{ color: "#0F1F3D" }}>
          {title}
        </h3>
        <div className="mt-2 text-sm text-ink space-y-2">{children}</div>
      </div>
    );
  }
  return (
    <div className="pt-6 first:pt-0">
      <h3 className="text-[15px] font-bold" style={{ color: "#0F1F3D" }}>
        {title}
      </h3>
      <div className="mt-2 text-sm text-ink space-y-2">{children}</div>
    </div>
  );
}

// Bug fix: Event Type / Mode of the event used to list every possible
// option with a checkbox against each one (e.g. "Training: ☒ Workshop: ☐
// RM: ☐ Other: ☐"). Per the EE-supplied template, only the event's
// actual value should show, as plain text, no unselected options, no
// checkbox glyphs.

// The Introduction/Participant Summary tables as ONE real table with a
// fixed number of equal-width columns (via <colgroup>), instead of a
// stack of separate small tables, matches docx_generator.py's/
// pdf_generator.py's _add_grid_table/_grid_table approach. Each `rows`
// entry is a list of (text, bold) cells; a row can have fewer cells
// than `columns` (most rows have 2, the checkbox rows have up to
// `columns`), the last cell in a short row gets a colSpan covering
// whatever columns are left, so every row still shares the same column
// boundaries as the rows above and below it, reading as one structured
// grid rather than differently-sized boxes.
function DocGridTable({ rows, columns }) {
  return (
    <table className="w-full border-collapse border border-line text-sm table-fixed">
      <colgroup>
        {Array.from({ length: columns }).map((_, idx) => (
          <col key={idx} style={{ width: `${100 / columns}%` }} />
        ))}
      </colgroup>
      <tbody>
        {rows.map((cells, rIdx) => (
          <tr key={rIdx}>
            {cells.map(([text, bold], cIdx) => {
              const isLast = cIdx === cells.length - 1;
              const span = isLast ? columns - (cells.length - 1) : 1;
              return (
                <td
                  key={cIdx}
                  colSpan={span}
                  className={"border border-line px-2 py-1.5 " + (bold ? "font-semibold" : "")}
                >
                  {text === "" || text == null ? "" : String(text)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 4, not 5: the widest row is now "Reported by / Reporting date" (4
// cells), Event Type / Mode of the event dropped from up to 5 cells
// (one per option) to 2 (label + the single selected value) once the
// full option list was replaced with plain text.
const INTRODUCTION_COLUMNS = 4;
const PARTICIPANT_SUMMARY_COLUMNS = 6;

function introductionRows(event) {
  return [
    [["Name of the event", true], [event.title, false]],
    [["Event place/Venue:", true], [[event.venue, event.city, event.category === "international" ? event.country : ""].filter(Boolean).join(", "), false]],
    [
      ["Reported by", true], [event.owner_name, false],
      ["Reporting date:", true], [new Date().toISOString().slice(0, 10), false],
    ],
    [
      ["Event Type", true],
      [formatEventType(event), false],
    ],
    [
      ["Event Start date:", true], [event.start_date, false],
      ["End date:", true], [event.end_date, false],
    ],
    [
      ["Mode of the event:", true],
      [MODE_OF_EVENT_LABELS[event.mode_of_event] || event.mode_of_event, false],
    ],
  ];
}

function participantSummaryRows(report) {
  const total = report?.participants_total ?? null;
  const male = report?.participants_male ?? null;
  const female = report?.participants_female ?? null;
  const orgRows = report?.participants_by_organization || [];
  const left = orgRows.slice(0, 6);
  const right = orgRows.slice(6, 11);
  const letters = "ABCDEFGHIJK";

  const rows = [
    [["", false], ["Total participants", true], [total ?? "N/A", false], ["M", true], [male ?? "N/A", false]],
    [["", false], ["Total participants", true], [total ?? "N/A", false], ["F", true], [female ?? "N/A", false]],
  ];
  for (let i = 0; i < 6; i++) {
    const left_ = left[i] ? [left[i].label, left[i].count] : ["", ""];
    const right_ = right[i] ? [right[i].label, right[i].count] : ["", ""];
    rows.push([
      [letters[i], true], [left_[0], false], [left_[1], false],
      [i < 5 ? letters[i + 6] : "", true], [right_[0], false], [right_[1], false],
    ]);
  }
  return rows;
}

function SingleEventDocumentPreview({ event }) {
  const report = event.post_event_report;
  const practices = (report?.best_practices_lessons_actions || "").trim();
  const practiceLines = practices ? practices.split("\n").map((l) => l.trim()).filter(Boolean) : [];
  const hasChallenges = !!(report?.challenges_faced || "").trim();

  // Challenges Faced is the one intentionally-optional field on the report
  // (see PostEventReportForm.jsx), when it's blank, the section is
  // dropped entirely rather than shown with a bare "N/A", matching how
  // Event Detail already hides it. Section numerals are generated in
  // render order instead of hardcoded, so Conclusions/Recommendations
  // shifts from "VII." to "VI." automatically when that happens, instead
  // of leaving a gap.
  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
  let numeral = 0;
  const next = () => ROMAN[numeral++];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-line p-8 max-w-3xl">
      <DocSection title={`${next()}. Introduction`}>
        <p className="text-justify">{event.description || "N/A"}</p>
        <DocGridTable rows={introductionRows(event)} columns={INTRODUCTION_COLUMNS} />
      </DocSection>

      <DocSection title={`${next()}. Participant Summary`}>
        <p>Organization of training participants</p>
        <DocGridTable rows={participantSummaryRows(report)} columns={PARTICIPANT_SUMMARY_COLUMNS} />
      </DocSection>

      <DocSection boxed title={`${next()}. Event Objective`}>
        <p className="text-justify">{event.expected_outcome || "N/A"}</p>
      </DocSection>

      <DocSection boxed title={`${next()}. Personal Objective relevant to EE`}>
        <p className="text-justify">{event.personal_objective || "N/A"}</p>
      </DocSection>

      <DocSection boxed title={`${next()}. Event Overview`}>
        <p className="text-justify">{report?.major_accomplishment || "N/A"}</p>
      </DocSection>

      <DocSection boxed title={`${next()}. Key Learnings & Action Points`}>
        <ul className="list-disc list-inside space-y-1">
          {(practiceLines.length > 0 ? practiceLines : ["N/A"]).map((line, idx) => (
            <li key={idx}>{line}</li>
          ))}
        </ul>
      </DocSection>

      {hasChallenges && (
        <DocSection boxed title={`${next()}. Challenges & Issues`}>
          <p className="text-justify">{report.challenges_faced}</p>
        </DocSection>
      )}

      <DocSection boxed title={`${next()}. Partnership opportunities`}>
        <p className="text-justify">{report?.recommendation_conclusion || "N/A"}</p>
      </DocSection>
    </div>
  );
}

// Attendance column for the Single Event picker table: the actual
// submitted headcount when a report has been submitted (EventListSerializer's
// participants_total, which is None until submission), otherwise the
// expected count captured at logging time, flagged "(expected)" on the
// frontend rather than silently blended with a real submitted number.
function eventAttendance(ev) {
  if (ev.participants_total !== null && ev.participants_total !== undefined) {
    return { value: ev.participants_total, expected: false };
  }
  const expected = ev.total_expected_participants ?? ev.expected_participants;
  if (expected === null || expected === undefined) return null;
  return { value: expected, expected: true };
}

// Columns offered in the event picker's "View" menu (checkbox and Event always show).
const EVENT_PICKER_COLUMNS = [
  { key: "select", label: "Select", locked: true },
  { key: "event", label: "Event", locked: true },
  { key: "category", label: "Category" },
  { key: "region", label: "Region" },
  { key: "area", label: "Area" },
  { key: "status", label: "Status" },
  { key: "attendance", label: "Attendance" },
];

export default function Reports() {
  const { showToast } = useToast();
  const [scope, setScope] = usePersistentState("generate-report.scope", "single_event");
  const [period, setPeriod] = usePersistentState("generate-report.period", "monthly");
  const today = new Date();
  const [quarter, setQuarter] = usePersistentState("generate-report.quarter", (((today.getMonth() - 6 + 12) % 12) / 3 | 0) + 1);
  const [year, setYear] = usePersistentState("generate-report.year", today.getFullYear());
  const [month, setMonth] = usePersistentState("generate-report.month", today.getMonth() + 1);
  const [week, setWeek] = usePersistentState("generate-report.week", Math.min(4, Math.ceil(today.getDate() / 7)));
  const [category, setCategory] = usePersistentState("generate-report.category", "");
  const [region, setRegion] = usePersistentState("generate-report.region", "");
  const [thematicArea, setThematicArea] = usePersistentState("generate-report.thematicArea", "");
  const [communicationSupport, setCommunicationSupport] = usePersistentState("generate-report.communicationSupport", "");
  // Event Type / Mode of Event / Status: already filterable on the
  // Events list and Admin Events pages, this closes the one place that
  // never got wired in after those fields were added to Event.
  const [status, setStatus] = usePersistentState("generate-report.status", "");
  const [format, setFormat] = useState("pdf");

  const [eventSearch, setEventSearch] = usePersistentState("generate-report.eventSearch", "");
  const columnsView = useColumnVisibility("report-event-picker");
  const show = columnsView.isVisible;
  const [eventListCategory, setEventListCategory] = usePersistentState("generate-report.eventListCategory", "");
  const [eventListRegion, setEventListRegion] = usePersistentState("generate-report.eventListRegion", "");
  const [eventListThematicArea, setEventListThematicArea] = usePersistentState("generate-report.eventListThematicArea", "");
  const [eventListStatus, setEventListStatus] = usePersistentState("generate-report.eventListStatus", "");
  const [eventListPage, setEventListPage] = useState(1);
  const [eventListResults, setEventListResults] = useState([]);
  const sort = useSort(eventListResults, { status: (e) => e.status_display || e.status });
  const [eventListCount, setEventListCount] = useState(0);
  const [isLoadingEventList, setIsLoadingEventList] = useState(false);
  // Distinguishes "nothing has ever loaded yet" (full-panel loader) from "a
  // filter/page change is reloading" (keep the existing rows visible with a
  // small inline indicator instead), same smooth-update pattern as
  // EventsList/Dashboard, so picking an event from a big list doesn't blank
  // and reappear on every filter tweak.
  const [hasLoadedEventListOnce, setHasLoadedEventListOnce] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);

  const [preview, setPreview] = useState(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  // Generate -> View/Download flow: clicking "Generate" no longer
  // immediately saves a file, it fetches the file into memory and offers
  // a choice. PDF's View opens the real file inline (browsers render PDFs
  // natively); Word/Excel's View can't do that (no in-browser renderer),
  // so it scrolls to the on-screen preview instead, which already matches
  // the document's exact content. Either way Download saves the same
  // already-fetched blob, no re-fetch needed.
  const [generatingFormat, setGeneratingFormat] = useState(null);
  const [generatedFile, setGeneratedFile] = useState(null); // { format, blob, filename }
  const previewSectionRef = useRef(null);
  const [thematicOptions, setThematicOptions] = useState([]);

  useEffect(() => {
    configApi
      .active()
      .then(({ data }) => setThematicOptions(data.thematic_area || []))
      .catch(() => {});
  }, []);

  // Report Scope = Single Event: browsable, filterable list of every event
  // (not just a type-to-search box), loads on mount since Single Event is
  // the default scope, and reloads whenever the search text or any of the
  // Category/Region/Thematic Area/Status filters change.
  useEffect(() => {
    if (scope !== "single_event") return;
    let cancelled = false;
    setIsLoadingEventList(true);
    const timeout = setTimeout(async () => {
      try {
        const params = { page: eventListPage, ordering: "-start_date" };
        if (eventSearch) params.search = eventSearch;
        if (eventListCategory) params.category = eventListCategory;
        if (eventListRegion) params.region = eventListRegion;
        if (eventListThematicArea) params.thematic_area = eventListThematicArea;
        if (eventListStatus) params.status = eventListStatus;
        const { data } = await eventsApi.list(params);
        if (!cancelled) {
          const results = data.results || data;
          setEventListResults(results);
          setEventListCount(data.count ?? results.length);
        }
      } catch (error) {
        if (!cancelled) showToast(extractErrorMessage(error), "error");
      } finally {
        if (!cancelled) {
          setIsLoadingEventList(false);
          setHasLoadedEventListOnce(true);
        }
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, eventSearch, eventListCategory, eventListRegion, eventListThematicArea, eventListStatus, eventListPage]);

  // Clicking an event in the list both selects it and immediately loads its
  // preview, no separate "now click Preview" step needed. The existing
  // Preview/Generate buttons below stay available too, e.g. to re-run the
  // preview or download straight after.
  async function selectEventAndPreview(ev) {
    setSelectedEvent(ev);
    setIsLoadingPreview(true);
    try {
      const { data } = await reportsApi.preview({ scope: "single_event", event_id: ev.id });
      setPreview(data);
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsLoadingPreview(false);
    }
  }

  function buildParams() {
    const params = { scope };
    if (scope === "single_event") {
      if (selectedEvent) params.event_id = selectedEvent.id;
    } else {
      params.period = period;
      if (period === "quarterly") params.quarter = quarter;
      if (period === "quarterly" || period === "yearly") params.year = year;
      if (period === "monthly" || period === "weekly") {
        params.month = month;
        params.year = year;
      }
      if (period === "weekly") params.week = week;
      if (category) params.category = category;
      if (region) params.region = region;
      if (thematicArea) params.thematic_area = thematicArea;
      if (communicationSupport) params.communication_support = communicationSupport;
      if (status) params.status = status;
    }
    return params;
  }

  function resetFilters() {
    setScope("single_event");
    setPeriod("monthly");
    setQuarter((((today.getMonth() - 6 + 12) % 12) / 3 | 0) + 1);
    setYear(today.getFullYear());
    setCategory("");
    setRegion("");
    setThematicArea("");
    setCommunicationSupport("");
    setStatus("");
    setFormat("pdf");
    setSelectedEvent(null);
    setEventSearch("");
    setEventListCategory("");
    setEventListRegion("");
    setEventListThematicArea("");
    setEventListStatus("");
    setEventListPage(1);
    setPreview(null);
    setGeneratedFile(null);
  }

  async function handlePreview() {
    if (scope === "single_event" && !selectedEvent) {
      showToast("Please select an event first.", "error");
      return;
    }
    setIsLoadingPreview(true);
    try {
      const { data } = await reportsApi.preview(buildParams());
      setPreview(data);
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsLoadingPreview(false);
    }
  }

  async function handleGenerate(explicitFormat) {
    if (scope === "single_event" && !selectedEvent) {
      showToast("Please select an event first.", "error");
      return;
    }
    const targetFormat = explicitFormat || format;
    setGeneratingFormat(targetFormat);
    setGeneratedFile(null);
    try {
      const { blob, filename } = await reportsApi.fetchGenerated({ ...buildParams(), format: targetFormat });
      setGeneratedFile({ format: targetFormat, blob, filename });
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setGeneratingFormat(null);
    }
  }

  function handleViewGenerated() {
    if (!generatedFile) return;
    if (generatedFile.format === "pdf") {
      // Browsers render PDFs natively, open the real generated file
      // directly in a new tab.
      const blobUrl = window.URL.createObjectURL(generatedFile.blob);
      window.open(blobUrl, "_blank");
      // Deliberately not revoking this blobUrl immediately, the new tab
      // is still using it. It's released when that tab is closed/reloaded.
      return;
    }
    // Word/Excel: no in-browser renderer for either format, so "View"
    // shows the on-screen preview instead, same content, already
    // visible on this page. Load it if it isn't already, then scroll to it.
    if (!preview) handlePreview();
    previewSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleDownloadGenerated() {
    if (!generatedFile) return;
    reportsApi.saveGeneratedFile(generatedFile.blob, generatedFile.filename);
  }

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-ink">Report scope</p>
            <p className="text-sm text-ink-muted mt-0.5 max-w-md">
              Choose whether the report covers the full event register or one event.
            </p>
          </div>
          <div className="inline-flex rounded border border-line overflow-hidden shrink-0">
            {SCOPES.map((s) => (
              <button
                key={s.value}
                onClick={() => {
                  setScope(s.value);
                  setPreview(null);
                  setGeneratedFile(null);
                }}
                className={
                  "px-3.5 py-1.5 text-sm font-medium " +
                  (scope === s.value ? "bg-ems-primary text-white" : "bg-white text-ink-muted hover:bg-surface-muted")
                }
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {scope === "single_event" ? (
        <>
          <div className="card border border-line p-4 flex flex-wrap items-center gap-2.5">
            <ListSearch
              placeholder="Search by title..."
              value={eventSearch}
              onChange={(e) => {
                setEventListPage(1);
                setEventSearch(e.target.value);
              }}
            />
            <div className="ml-auto flex flex-1 flex-nowrap items-center justify-end gap-2.5">
            <FilterSelect
              className=""
              value={eventListCategory}
              onChange={(e) => {
                setEventListPage(1);
                setEventListCategory(e.target.value);
              }}
            >
              <option value="">All Categories</option>
              <option value="international">International</option>
              <option value="national">National</option>
              <option value="sub_regional">Sub-national</option>
              <option value="internal">Internal</option>
            </FilterSelect>
            <FilterSelect
              className=""
              value={eventListRegion}
              onChange={(e) => {
                setEventListPage(1);
                setEventListRegion(e.target.value);
              }}
            >
              <option value="">All Regions</option>
              {REGION_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </FilterSelect>
            <FilterSelect
              className=""
              value={eventListThematicArea}
              onChange={(e) => {
                setEventListPage(1);
                setEventListThematicArea(e.target.value);
              }}
            >
              <option value="">All Areas</option>
              {thematicOptions.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </FilterSelect>
            <FilterSelect
              className=""
              value={eventListStatus}
              onChange={(e) => {
                setEventListPage(1);
                setEventListStatus(e.target.value);
              }}
            >
              <option value="">All Statuses</option>
              <option value="upcoming">Upcoming</option>
              <option value="ongoing">Ongoing</option>
              <option value="held">Held</option>
              <option value="completed">Completed</option>
              <option value="postponed">Postponed</option>
              <option value="cancelled">Cancelled</option>
            </FilterSelect>
            <ColumnsMenu
                columns={EVENT_PICKER_COLUMNS}
                hidden={columnsView.hidden}
                isVisible={columnsView.isVisible}
                onToggle={columnsView.toggle}
                onReset={columnsView.reset}
              />
            </div>
          </div>

          {/* Table card: event picker restyled to match the reference
              layout (checkbox-styled indicator for the single selected
              row, see selectEventAndPreview; this never becomes real
              multi-select) plus the Category/Region/Area/Status/
              Attendance columns the reference table shows. */}
          <div className="card border border-line overflow-hidden p-0">
            {!hasLoadedEventListOnce ? (
              <PageLoader />
            ) : eventListResults.length === 0 ? (
              <EmptyState title="No events found" message="Try adjusting the filters above." />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="jm-table w-full text-sm">
                    <thead className="bg-surface-muted text-ink-muted text-xs uppercase tracking-wide">
                      <tr>
                        <th className="w-10 px-4 py-2.5" />
                        <th className="text-left px-4 py-2.5">Event</th>
                        {show("category") && <th className="text-left px-4 py-2.5">Category</th>}
                        {show("region") && <th className="text-left px-4 py-2.5">Region</th>}
                        {show("area") && <th className="text-left px-4 py-2.5">Area</th>}
                        {show("status") && <SortableTh label="Status" sortKey="status" sort={sort} />}
                        {show("attendance") && <th className="text-left px-4 py-2.5">Attendance</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {sort.rows.map((ev) => {
                        const isSelected = selectedEvent?.id === ev.id;
                        const attendance = eventAttendance(ev);
                        return (
                          <tr
                            key={ev.id}
                            onClick={() => selectEventAndPreview(ev)}
                            className={
                              "cursor-pointer " + (isSelected ? "bg-ems-primary/10" : "hover:bg-surface-muted/60")
                            }
                          >
                            <td className="px-4 py-2.5">
                              <span
                                role="checkbox"
                                aria-checked={isSelected}
                                aria-label={isSelected ? `${ev.title} selected` : `Select ${ev.title}`}
                                className={
                                  "flex h-4 w-4 items-center justify-center rounded-sm border transition-colors " +
                                  (isSelected ? "bg-ems-primary border-ems-primary text-white" : "border-line bg-white")
                                }
                              >
                                {isSelected && (
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                                    <path
                                      d="M5 13l4 4L19 7"
                                      stroke="currentColor"
                                      strokeWidth="3"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                )}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap">
                              <p className="font-bold text-ink">{ev.title}</p>
                              <p className="text-xs text-ink-faint">{formatDateRange(ev.start_date, ev.end_date)}</p>
                            </td>
                            {show("category") && (
                              <td className="px-4 py-2.5">
                                <CategoryBadge category={ev.category} />
                              </td>
                            )}
                            {show("region") && (
                              <td className="px-4 py-2.5 text-ink-muted">{ev.location_label || ev.region || "-"}</td>
                            )}
                            {show("area") && (
                              <td className="px-4 py-2.5 text-ink-muted">{ev.thematic_area || "-"}</td>
                            )}
                            {show("status") && (
                              <td className="px-4 py-2.5">
                                <StatusBadge label={ev.status_display || ev.status} />
                              </td>
                            )}
                            {show("attendance") && (
                              <td className="px-4 py-2.5 text-ink-muted">
                                {attendance ? (
                                  <>
                                    {attendance.value}
                                    {attendance.expected && (
                                      <span className="text-xs text-ink-faint"> (expected)</span>
                                    )}
                                  </>
                                ) : (
                                  "N/A"
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {isLoadingEventList && (
                  <div className="flex items-center justify-between px-4 py-2 border-t border-line text-xs text-ink-muted">
                    <span>Updating...</span>
                  </div>
                )}
                <Pagination count={eventListCount} page={eventListPage} onPageChange={setEventListPage} />
              </>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
              <span className="text-sm text-ink-muted">
                {selectedEvent ? 1 : 0} of {eventListCount} event{eventListCount === 1 ? "" : "s"} selected
              </span>
              <div className="flex flex-wrap gap-2">
                <button className="jm-btn-secondary" onClick={resetFilters}>
                  Reset
                </button>
                <button className="jm-btn-secondary" onClick={handlePreview} disabled={isLoadingPreview}>
                  {isLoadingPreview ? "Loading..." : "Preview"}
                </button>
                <button className="jm-btn-secondary" onClick={() => handleGenerate("pdf")} disabled={!!generatingFormat}>
                  {generatingFormat === "pdf" ? "Preparing..." : "PDF"}
                </button>
                <button className="jm-btn-secondary" onClick={() => handleGenerate("docx")} disabled={!!generatingFormat}>
                  {generatingFormat === "docx" ? "Preparing..." : "Word"}
                </button>
                <button className="jm-btn-primary" onClick={() => handleGenerate()} disabled={!!generatingFormat}>
                  {generatingFormat ? "Preparing..." : "Generate Report"}
                </button>
              </div>
            </div>
          </div>
        </>
        ) : (
          <div className="card p-5 space-y-4">
            <div>
              <label className="form-label">Period</label>
              <div className="inline-flex rounded border border-line overflow-hidden">
                {["weekly", "monthly", "quarterly", "yearly"].map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={
                      "px-3 py-1.5 text-sm capitalize " +
                      (period === p ? "bg-ems-primary text-white" : "bg-white text-ink-muted hover:bg-surface-muted")
                    }
                  >
                    {p}
                  </button>
                ))}
              </div>
              {(period === "weekly" || period === "monthly") && (
                <div className="flex gap-2 mt-2">
                  {period === "weekly" && (
                    <select className="form-input max-w-[160px]" value={week} onChange={(e) => setWeek(Number(e.target.value))}>
                      <option value={1}>Week 1 (1-7)</option>
                      <option value={2}>Week 2 (8-14)</option>
                      <option value={3}>Week 3 (15-21)</option>
                      <option value={4}>Week 4 (22-end)</option>
                    </select>
                  )}
                  <select className="form-input max-w-[140px]" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                    <option value={1}>January</option>
                    <option value={2}>February</option>
                    <option value={3}>March</option>
                    <option value={4}>April</option>
                    <option value={5}>May</option>
                    <option value={6}>June</option>
                    <option value={7}>July</option>
                    <option value={8}>August</option>
                    <option value={9}>September</option>
                    <option value={10}>October</option>
                    <option value={11}>November</option>
                    <option value={12}>December</option>
                  </select>
                  <input
                    type="number"
                    className="form-input max-w-[100px]"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                  />
                </div>
              )}
              {(period === "quarterly" || period === "yearly") && (
                <div className="flex gap-2 mt-2">
                  {period === "quarterly" && (
                    <select
                      className="form-input max-w-[160px]"
                      value={quarter}
                      onChange={(e) => setQuarter(Number(e.target.value))}
                    >
                      <option value={1}>Q1 (Jul-Sep)</option>
                      <option value={2}>Q2 (Oct-Dec)</option>
                      <option value={3}>Q3 (Jan-Mar)</option>
                      <option value={4}>Q4 (Apr-Jun)</option>
                    </select>
                  )}
                  <input
                    type="number"
                    className="form-input max-w-[100px]"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                  />
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <FilterSelect value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All Categories</option>
                <option value="international">International</option>
                <option value="national">National</option>
                <option value="sub_regional">Sub-national</option>
                <option value="internal">Internal</option>
              </FilterSelect>
              <FilterSelect value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="">All Regions</option>
                {REGION_OPTIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </FilterSelect>
              <FilterSelect value={thematicArea} onChange={(e) => setThematicArea(e.target.value)}>
                <option value="">All Areas</option>
                {thematicOptions.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </FilterSelect>
              <FilterSelect
                value={communicationSupport}
                onChange={(e) => setCommunicationSupport(e.target.value)}
              >
                <option value="">All (Comms Support)</option>
                <option value="requested">Requested</option>
                <option value="not_requested">Not Requested</option>
              </FilterSelect>
              <FilterSelect value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All Statuses</option>
                <option value="upcoming">Upcoming</option>
                <option value="ongoing">Ongoing</option>
                <option value="held">Held</option>
                <option value="completed">Completed</option>
                <option value="postponed">Postponed</option>
                <option value="cancelled">Cancelled</option>
              </FilterSelect>
            </div>

            <div className="flex flex-wrap gap-3 pt-2 border-t border-line">
              <button className="jm-btn-primary" onClick={() => handleGenerate("pdf")} disabled={!!generatingFormat}>
                {generatingFormat === "pdf" ? "Preparing..." : "Generate PDF"}
              </button>
              <button className="jm-btn-primary" onClick={() => handleGenerate("docx")} disabled={!!generatingFormat}>
                {generatingFormat === "docx" ? "Preparing..." : "Generate Word"}
              </button>
              <button className="jm-btn-secondary" onClick={handlePreview} disabled={isLoadingPreview}>
                {isLoadingPreview ? "Loading..." : "Preview Report"}
              </button>
              <button className="jm-btn-secondary" onClick={resetFilters}>
                Reset Filters
              </button>
            </div>
          </div>
        )}

        {/* Appears once a file has actually been generated, View opens
            the real PDF inline, or scrolls to the matching on-screen
            preview for Word/Excel; Download saves the same already-
            fetched file without hitting the server again. */}
        {generatedFile && (
          <div className="flex items-center gap-3 rounded-md bg-surface-muted px-4 py-3">
            <span className="text-sm text-ink">
              {generatedFile.filename} is ready.
            </span>
            <div className="flex gap-2 ml-auto">
              <button className="jm-btn-secondary" onClick={handleViewGenerated}>
                View
              </button>
              <button className="jm-btn-primary" onClick={handleDownloadGenerated}>
                Download
              </button>
            </div>
          </div>
        )}

      {/* Only shows a full-page spinner before any preview has ever loaded
          (preview === null), re-clicking Preview after changing a filter
          keeps the existing preview on screen with a small inline
          indicator instead of blanking it, same pattern used everywhere
          else in the app. */}
      {isLoadingPreview && !preview && <PageLoader />}
      {isLoadingPreview && preview && (
        <p className="text-xs text-ems-primary">Updating preview...</p>
      )}

      {/* Report Preview summary stats, corrected report spec. */}
      {preview && preview.summary_stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card p-5">
            <p className="text-xs text-ink-faint uppercase tracking-wide mb-1">Number of Events</p>
            <p className="text-2xl font-display font-semibold text-ink">{preview.summary_stats.number_of_events}</p>
          </div>
          <div className="card p-5">
            <p className="text-xs text-ink-faint uppercase tracking-wide mb-1">Completed Events</p>
            <p className="text-2xl font-display font-semibold text-success">{preview.summary_stats.completed_events}</p>
          </div>
          <div className="card p-5">
            <p className="text-xs text-ink-faint uppercase tracking-wide mb-1">Pending Reports</p>
            <p className="text-2xl font-display font-semibold text-warning">{preview.summary_stats.pending_reports}</p>
          </div>
          <div className="card p-5">
            <p className="text-xs text-ink-faint uppercase tracking-wide mb-1">Communication Requests</p>
            <p className="text-2xl font-display font-semibold text-ink">{preview.summary_stats.communication_requests}</p>
          </div>
        </div>
      )}

      {/* In-system report view, the report's actual content, viewable
          without needing to download a file first. Generic/Thematic Area's
          real PDF/Word now render the same per-event template as Single
          Event, once per matching event (see docx_generator.py's
          _add_event_report_body), not a flat table, so the preview
          renders the same way: SingleEventDocumentPreview per event, with
          a visual break between them standing in for the real document's
          page breaks. This div always renders (even before a preview
          loads) so handleViewGenerated's scrollIntoView always has a
          target for Word/Excel's "View". */}
      <div ref={previewSectionRef}>
        {preview && scope === "generic" && (
          <div className="space-y-8">
            <p className="text-sm text-ink-muted">
              {preview.count} event{preview.count === 1 ? "" : "s"} ({preview.start_date} to {preview.end_date})
            </p>
            {preview.events.map((event, idx) => (
              <div key={event.id} className={idx > 0 ? "pt-8 border-t-2 border-dashed border-line" : ""}>
                <SingleEventDocumentPreview event={event} />
              </div>
            ))}
            {preview.events.length === 0 && <EmptyState title="No records found for the selected filters." />}
          </div>
        )}

        {preview && scope === "thematic_area" && (
          <div className="space-y-8">
            <p className="text-sm text-ink-muted">
              {preview.count} event{preview.count === 1 ? "" : "s"} ({preview.start_date} to {preview.end_date})
            </p>
            {Object.entries(preview.thematic_areas || {}).map(([area, evts]) => (
              <div key={area}>
                <p className="text-sm font-semibold text-ink mb-3">
                  {area} ({evts.length})
                </p>
                <div className="space-y-8">
                  {evts.map((event, idx) => (
                    <div key={event.id} className={idx > 0 ? "pt-8 border-t-2 border-dashed border-line" : ""}>
                      <SingleEventDocumentPreview event={event} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {Object.keys(preview.thematic_areas || {}).length === 0 && (
              <EmptyState title="No records found for the selected filters." />
            )}
          </div>
        )}

        {preview && scope === "single_event" && <SingleEventDocumentPreview event={preview.event} />}
      </div>
    </div>
  );
}
