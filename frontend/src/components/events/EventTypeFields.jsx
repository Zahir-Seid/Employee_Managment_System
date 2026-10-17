import {
  EVENT_TYPE_DESCRIPTIONS,
  EVENT_TYPE_LABELS,
  EVENT_TYPE_OPTIONS,
  REVIEW_MEETING_TYPE_DESCRIPTIONS,
  eventTypeOptionValue,
  splitEventTypeOption,
} from "../../utils/format.js";

// Event Type box with its one-line description. Review Meeting is listed twice
// ("Review Meeting (Annual)" / "Review Meeting (Mid-term)"), and Other asks for
// the event type in the person's own words (required). Renders grid cells, so
// drop it inside the form's grid.
//
// lockType: the event edit panel doesn't let the type itself change, so other
// types show as plain text and a Review Meeting only offers its two entries.
export default function EventTypeFields({ value, onChange, errors = {}, lockType = false, required = true }) {
  const star = required ? <span className="text-warning"> *</span> : null;
  const selected = eventTypeOptionValue(value);
  const isReviewMeeting = value.event_type === "rm";
  const options = lockType ? EVENT_TYPE_OPTIONS.filter((o) => o.value.startsWith("rm_")) : EVENT_TYPE_OPTIONS;
  const description =
    (isReviewMeeting && REVIEW_MEETING_TYPE_DESCRIPTIONS[value.review_meeting_type]) ||
    EVENT_TYPE_DESCRIPTIONS[value.event_type];

  function handleChange(e) {
    const next = splitEventTypeOption(e.target.value);
    onChange("event_type", next.event_type);
    onChange("review_meeting_type", next.review_meeting_type);
  }

  return (
    <>
      <div>
        <label className="form-label">Event Type{star}</label>
        {lockType && !isReviewMeeting ? (
          <p className="text-sm font-medium text-ink py-2">{EVENT_TYPE_LABELS[value.event_type] || value.event_type}</p>
        ) : (
          <select className="form-input" value={selected} onChange={handleChange}>
            {selected === "rm_" && (
              <option value="rm_" disabled>
                Select Annual or Mid-term
              </option>
            )}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {description && <p className="text-xs text-ink-faint mt-1">{description}</p>}
        {errors.review_meeting_type && <p className="form-error">{errors.review_meeting_type}</p>}
      </div>
      {value.event_type === "other" && (
        <div>
          <label className="form-label">Please specify the event type{star}</label>
          <input
            type="text"
            className="form-input"
            maxLength={100}
            placeholder="e.g. Site visit, Launch event"
            value={value.event_type_other || ""}
            onChange={(e) => onChange("event_type_other", e.target.value)}
          />
          {errors.event_type_other && <p className="form-error">{errors.event_type_other}</p>}
        </div>
      )}
    </>
  );
}
