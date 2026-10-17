import { useEffect, useRef, useState } from "react";
import { CaretDownIcon, XIcon } from "../common/UiGlyphs.jsx";

// EMS Reporting System spec (§7-9): one reusable filter component for
// the whole Reports module, not a bespoke filter block per report. Each
// report passes its own `fields` array (which filters it actually
// supports, "not every report needs every filter") plus the current
// `values` and an `onChange`. Primary fields render inline; anything
// marked `primary: false` collapses into a "More Filters" popover so the
// page never shows 10+ controls at once. Active (non-empty) filters
// always surface as removable chips underneath, regardless of whether
// their control is a primary one or tucked in the popover, the person
// should never have to reopen the popover just to see what's applied.
//
// This component is deliberately presentation + interaction only, it
// has no idea how to fetch data or what the values mean. The report page
// owns the actual API call and re-fetches when `values` changes.

const PERIOD_OPTIONS = [
  { value: "", label: "All time" },
  { value: "monthly", label: "This month" },
  { value: "quarterly", label: "This quarter" },
  { value: "yearly", label: "This year" },
  { value: "custom", label: "Custom range" },
];

function FieldControl({ field, value, onChange }) {
  if (field.key === "period") {
    return (
      <select className="form-input" value={value || ""} onChange={(e) => onChange(e.target.value)}>
        {PERIOD_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "date") {
    return (
      <input type="date" className="form-input" value={value || ""} onChange={(e) => onChange(e.target.value)} />
    );
  }
  if (field.type === "text") {
    return (
      <input
        type="text"
        className="form-input"
        placeholder={field.placeholder || `Search ${field.label.toLowerCase()}...`}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  // Default: select, built from field.options ({value, label}[])
  return (
    <select className="form-input" value={value || ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">{field.allLabel || `All ${field.label}`}</option>
      {(field.options || []).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default function ReportFilterBar({ fields, values, onChange, onReset }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef(null);
  const isCustomPeriod = values.period === "custom";

  const primaryFields = fields.filter((f) => f.primary);
  const secondaryFields = fields.filter((f) => !f.primary);
  const activeSecondaryCount = secondaryFields.filter((f) => values[f.key]).length;

  useEffect(() => {
    if (!popoverOpen) return undefined;
    function handleClick(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) setPopoverOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [popoverOpen]);

  // Active filter chips, every field with a non-empty value, primary or
  // not, so applied filters are always visible in one place (spec §8).
  const activeChips = fields
    .filter((f) => values[f.key])
    .map((f) => {
      let label = values[f.key];
      if (f.key === "period") label = PERIOD_OPTIONS.find((o) => o.value === values.period)?.label || label;
      else if (f.options) label = f.options.find((o) => o.value === values[f.key])?.label || label;
      return { key: f.key, fieldLabel: f.label, valueLabel: label };
    });
  if (values.period === "custom" && values.date_from && values.date_to) {
    activeChips.push({ key: "__daterange", fieldLabel: "Range", valueLabel: `${values.date_from} to ${values.date_to}` });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        {primaryFields.map((field) => (
          <div key={field.key} className="min-w-[150px]">
            <label className="form-label">{field.label}</label>
            <FieldControl field={field} value={values[field.key]} onChange={(v) => onChange(field.key, v)} />
          </div>
        ))}
        {isCustomPeriod && (
          <>
            <div className="min-w-[150px]">
              <label className="form-label">From</label>
              <input
                type="date"
                className="form-input"
                value={values.date_from || ""}
                onChange={(e) => onChange("date_from", e.target.value)}
              />
            </div>
            <div className="min-w-[150px]">
              <label className="form-label">To</label>
              <input
                type="date"
                className="form-input"
                value={values.date_to || ""}
                onChange={(e) => onChange("date_to", e.target.value)}
              />
            </div>
          </>
        )}

        {secondaryFields.length > 0 && (
          <div className="relative" ref={popoverRef}>
            <button
              type="button"
              onClick={() => setPopoverOpen((v) => !v)}
              className="btn-secondary flex items-center gap-1.5 h-[42px]"
            >
              Filters
              {activeSecondaryCount > 0 && (
                <span className="inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-ems-primary text-white text-[10px] font-semibold">
                  {activeSecondaryCount}
                </span>
              )}
              <CaretDownIcon className="text-ink-faint" />
            </button>
            {popoverOpen && (
              <div className="absolute z-20 top-full mt-2 right-0 w-80 bg-white border border-line rounded-lg shadow-lg p-4 space-y-3">
                {secondaryFields.map((field) => (
                  <div key={field.key}>
                    <label className="form-label">{field.label}</label>
                    <FieldControl field={field} value={values[field.key]} onChange={(v) => onChange(field.key, v)} />
                  </div>
                ))}
                <div className="flex justify-end pt-1">
                  <button type="button" className="text-sm text-ems-primary hover:underline" onClick={() => setPopoverOpen(false)}>
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {(activeChips.length > 0) && (
          <button type="button" onClick={onReset} className="text-sm text-ink-faint hover:text-ink h-[42px]">
            Reset all
          </button>
        )}
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-faint uppercase tracking-wide">Active filters:</span>
          {activeChips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1.5 bg-ems-primaryLight text-ems-primaryLightText text-xs font-medium pl-2.5 pr-1.5 py-1 rounded-full"
            >
              {chip.valueLabel}
              <button
                type="button"
                aria-label={`Remove ${chip.fieldLabel} filter`}
                onClick={() => {
                  if (chip.key === "__daterange") {
                    onChange("date_from", "");
                    onChange("date_to", "");
                  } else {
                    onChange(chip.key, "");
                  }
                }}
                className="rounded-full hover:bg-black/10 w-4 h-4 flex items-center justify-center"
              >
                <XIcon width={10} height={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
