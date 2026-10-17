"""Shared reporting engine for the Reports Module — originally built for
the "Organizational Performance Report" request, now serving as the data
engine behind Report 1 of the follow-up "Six-Report System" spec, the
**Executive Management Report** (Reports > Executive Management Report).
Per that spec's own instruction not to duplicate calculation logic per
report, this module's functions are the one place these KPIs are
computed — every other report in the six-report system is expected to
call into these same functions (via get_report_queryset for the
filtered/scoped event set) rather than re-deriving the same numbers.

Originally scoped to Executive Summary / Event Activity / Communications
Performance only. Per a follow-up round of scoping on the same request,
phase 1 now also includes Performance Overview (Actuals only) and Key
Achievements / Challenges / Recommendations aggregation — still built on
the *existing* reporting engine (get_report_queryset) and existing
models, with no new Program/Project, Strategic Objective, or Partner
Organization models, and no Planned vs Actual numbers, since none of that
data exists anywhere in the system yet and the spec explicitly says not
to invent it.

Deliberately NOT implemented (confirmed explicitly before building
rather than assumed, and re-confirmed against the six-report spec, which
asks for the same two things again):
- Program/Project as a filter or grouping axis — no such field or model
  exists on Event; "Project name" was in fact already considered and
  explicitly excluded from the report template before (see
  docx_generator.py's template comment) because the system doesn't track
  it. Only "Objective" (Event.expected_outcome, free text) and
  "Organization" (Event.organization_lead_agency / co_organizer_name,
  free text) exist, and are used where relevant below.
- Planned vs Actual / Achievement % — nothing in the system records a
  planned/target number for events, participants, or objectives for a
  period, so there's nothing to divide Actuals by. `build_planned_vs_actual`
  below returns an explicit "not available" result (not zeros, not a
  fabricated 0% or 100%) rather than inventing one.
- Follow-up completion rate / In Progress count — FollowUpAction (FR30)
  has no status field, only action/responsible/deadline. Completed and
  In Progress can't be computed from anything that exists today.
  `build_follow_up_summary` below only reports what the schema can
  actually support: Total actions and Overdue (deadline already passed).
- Strategic Alignment, Saved Reports, role-restricted default views,
  PDF/Excel/Word export of this report, and Reports 2-6 of the six-report
  spec (Event Activity, Partner Engagement, Communications, Annual
  Organizational Event, Report Builder) — later phases, built one at a
  time per that spec's own request.

Grouping note for Key Achievements/Challenges/Recommendations: the spec
asks to group by "Program/Project, Strategic Objective, Region, Event
Category." Program/Project is skipped (doesn't exist, as above).
Objective (Event.expected_outcome) is a long free-text sentence per
event, not a categorical value — grouping by its exact text would
produce close to one group per event, which isn't a useful "recurring"
grouping, so it's left out of the grouping axes too (though the raw text
is still surfaced per-item). Grouping here uses Category, Thematic Area,
and Region instead — the axes that are actually categorical today.
"""

from collections import defaultdict

from django.utils import timezone

from apps.configuration.models import ConfigListType, ConfigOption
from apps.events.models import EventStatus


def _organizations_engaged(events):
    """"Organizations/partners engaged" — excludes EE itself even when
    EE is logged as an event's own Lead Organization or Co-organizer,
    since EE is the org running the event, not an outside partner.
    Shared by the Management Report's KPI, Annual Report's KPI/partner
    summary, and the Partner Engagement Report's own row-building logic
    (see partner_engagement_report._event_partner_names, which applies
    the identical exclusion) — so this stays a single rule, not one
    definition of "partner" per report.
    """
    orgs = set()
    for e in events:
        if e.organization_lead_agency and e.organization_lead_agency.strip().upper() != "EE":
            orgs.add(e.organization_lead_agency.strip())
        if e.co_organizer_name and e.co_organizer_name.strip().upper() != "EE":
            orgs.add(e.co_organizer_name.strip())
    return orgs


def _total_actual_participants(events):
    """Actuals-only participant total — summed only from events with a
    *submitted* Event Status Report, same rule build_executive_summary/
    build_performance_overview already use for their own participant
    KPIs (see their docstrings/comments: "Total Participants is Actuals
    only... events without a submitted report simply don't contribute a
    number here rather than falling back to a guess"). Pulled out as its
    own function so Annual Report can share the exact same rule instead
    of re-deriving participant totals from build_event_activity's
    per-row figures, which blend in an *estimated* headcount
    (total_expected_participants) for events with no submitted report
    yet — a different, looser number that doesn't belong in a KPI
    labeled "Total Participants" alongside reports that are actuals-only.
    """
    total = 0
    for e in events:
        report = getattr(e, "post_event_report", None)
        if report and report.status == "submitted" and report.participants_male is not None and report.participants_female is not None:
            total += report.participants_male + report.participants_female
    return total


def build_executive_summary(events):
    """Only KPIs the system can actually compute today from real records.
    "Objectives Achieved" uses a specific, honest definition: the count of
    distinct Objective (Event.expected_outcome) values reported against by
    an event whose Event Status Report has actually been *submitted* —
    i.e. objectives the org followed through and reported on, not just
    stated at logging time. No "achievement rate" is computed here (that
    needs a planned/target count, which doesn't exist — see
    Performance Overview below for the one rate that IS computable).
    """
    today = timezone.localdate()
    completed = [e for e in events if e.status == EventStatus.COMPLETED]
    upcoming = [e for e in events if e.status == EventStatus.LOGGED and e.start_date > today]
    cancelled_postponed = [e for e in events if e.status in (EventStatus.CANCELLED, EventStatus.POSTPONED)]

    # Actuals only: summed from events with a submitted report, with no
    # fallback to expected counts.
    total_participants_actual = 0
    events_with_actuals = 0
    objectives_achieved = set()
    follow_up_actions_logged = 0
    for e in events:
        report = getattr(e, "post_event_report", None)
        if report and report.status == "submitted":
            if report.participants_male is not None and report.participants_female is not None:
                total_participants_actual += report.participants_male + report.participants_female
                events_with_actuals += 1
            if e.expected_outcome and e.expected_outcome.strip():
                objectives_achieved.add(e.expected_outcome.strip())
            follow_up_actions_logged += report.follow_up_actions.count()

    return {
        "total_events": len(events),
        "completed_events": len(completed),
        "upcoming_events": len(upcoming),
        "cancelled_postponed_events": len(cancelled_postponed),
        "total_participants_actual": total_participants_actual,
        "events_with_submitted_actuals": events_with_actuals,
        "organizations_partners_engaged": len(_organizations_engaged(events)),
        "objectives_achieved": len(objectives_achieved),
        "follow_up_actions_logged": follow_up_actions_logged,
    }


def build_performance_overview(events):
    """Section B — Actuals only, no Planned vs Actual table and no
    invented Achievement % (see module docstring). The two rates below
    are the only ones the current schema can honestly support:
    Event Completion Rate (completed / total) and Objective Achievement
    Rate (distinct objectives actually reported on / distinct objectives
    stated across all matching events). Follow-up Completion Rate is
    left out — FollowUpAction has no status field yet to compute it from.
    """
    total = len(events)
    completed = sum(1 for e in events if e.status == EventStatus.COMPLETED)

    objectives_stated = set()
    objectives_achieved = set()
    total_participants_actual = 0
    for e in events:
        if e.expected_outcome and e.expected_outcome.strip():
            objectives_stated.add(e.expected_outcome.strip())
        report = getattr(e, "post_event_report", None)
        if report and report.status == "submitted":
            if e.expected_outcome and e.expected_outcome.strip():
                objectives_achieved.add(e.expected_outcome.strip())
            if report.participants_male is not None and report.participants_female is not None:
                total_participants_actual += report.participants_male + report.participants_female

    def pct(numerator, denominator):
        return round((numerator / denominator) * 100, 1) if denominator else None

    return {
        "event_completion_rate": pct(completed, total),
        "objective_achievement_rate": pct(len(objectives_achieved), len(objectives_stated)),
        "participant_reach": total_participants_actual,
        "partner_engagement": len(_organizations_engaged(events)),
    }


def build_event_activity(events):
    """Event Name / Date / Category / Event Type / Region / Lead
    Organization / Partner / Status / Participant Count / Post-Event
    Report Status — per spec section C, minus the Program/Project column
    (doesn't exist; see module docstring).

    Participant Count uses the submitted actual when available, falling
    back to the event's own expected/total-expected figure otherwise —
    labeled accordingly on the frontend so it's never presented as a
    verified actual when it isn't one.

    `status`/`category` are the (admin-editable, config-driven) display
    labels — `status_code`/`category_code` are the underlying values,
    included so the frontend can reliably filter/color-code by value
    without depending on label text that an Admin could rename.
    `status_code` is Event.get_computed_status() (Event Status Update) —
    Upcoming/Ongoing/Held/Completed/Postponed/Cancelled — not the raw
    stored `status` column, since Upcoming/Ongoing/Held all share one
    raw value and only the computed code actually distinguishes them.
    """
    rows = []
    for e in events:
        report = getattr(e, "post_event_report", None)
        if report and report.status == "submitted":
            report_status = "submitted"
            participant_count = (report.participants_male or 0) + (report.participants_female or 0)
            participant_count_is_actual = True
        elif e.is_report_overdue:
            report_status = "overdue"
            participant_count = e.total_expected_participants
            participant_count_is_actual = False
        else:
            report_status = "pending"
            participant_count = e.total_expected_participants
            participant_count_is_actual = False

        rows.append({
            "event_id": e.id,
            "title": e.title,
            "start_date": e.start_date,
            "end_date": e.end_date,
            "category": e.get_category_label(),
            "category_code": e.category,
            "event_type": e.event_type,
            "event_type_label": e.event_type_full_label,
            "region": e.region_group_label,
            "location": e.location_label,
            "lead_organization": e.organization_lead_agency,
            "partner": e.co_organizer_name,
            "status": e.get_status_label(),
            "status_code": e.get_computed_status(),
            "participant_count": participant_count,
            "participant_count_is_actual": participant_count_is_actual,
            "post_event_report_status": report_status,
        })
    return rows


def _group_key(event, axis):
    # International events group by their country, not their state/province.
    value = event.region_group_label if axis == "region" else getattr(event, axis, None)
    return value.strip() if value and value.strip() else "Unspecified"


def build_key_achievements(events):
    """Section D — pulled straight from already-submitted Event Status
    Reports (Event Overview, Key Learnings & Action Points);
    never asks the reporter to re-enter anything. Grouped by Category,
    Thematic Area, and Region — see module docstring for why not
    Program/Project/Objective.
    """
    items = []
    for e in events:
        report = getattr(e, "post_event_report", None)
        if not report or report.status != "submitted":
            continue
        for field, field_label in (
            ("major_accomplishment", "Event Overview"),
            ("best_practices_lessons_actions", "Key Learnings & Action Points"),
        ):
            text = (getattr(report, field) or "").strip()
            if text:
                items.append({
                    "event_id": e.id,
                    "event_title": e.title,
                    "type": field_label,
                    "text": text,
                    "category": e.get_category_label(),
                    "thematic_area": _group_key(e, "thematic_area"),
                    "region": _group_key(e, "region"),
                })

    def grouped_by(axis):
        groups = defaultdict(list)
        for item in items:
            groups[item[axis]].append(item)
        return dict(sorted(groups.items(), key=lambda kv: kv[0].lower()))

    return {
        "items": items,
        "by_category": grouped_by("category"),
        "by_thematic_area": grouped_by("thematic_area"),
        "by_region": grouped_by("region"),
    }


def _recurring_text_analysis(events, field_name):
    """Shared by Challenges and Recommendations — both sections ask for
    the same two things: (1) recurring entries with a frequency count,
    (2) the original event-specific entries retained as-is.

    "Recurring" is identified by exact text match after normalizing case
    and surrounding whitespace only — no fuzzy/semantic matching. Real
    NLP similarity clustering would risk merging two genuinely different
    challenges/recommendations that happen to read similarly, which is
    exactly the kind of invented/assumed information the spec says not
    to introduce. This is a deliberately conservative, honest definition
    of "recurring."
    """
    normalized_groups = {}  # normalized text -> {"display": str, "entries": [...]}
    for e in events:
        report = getattr(e, "post_event_report", None)
        if not report or report.status != "submitted":
            continue
        text = (getattr(report, field_name) or "").strip()
        if not text:
            continue
        key = " ".join(text.lower().split())
        bucket = normalized_groups.setdefault(key, {"display": text, "entries": []})
        bucket["entries"].append({"event_id": e.id, "event_title": e.title, "text": text})

    recurring = sorted(
        (
            {"text": bucket["display"], "frequency": len(bucket["entries"]), "events": bucket["entries"]}
            for bucket in normalized_groups.values()
            if len(bucket["entries"]) > 1
        ),
        key=lambda r: -r["frequency"],
    )
    event_specific = [
        bucket["entries"][0] for bucket in normalized_groups.values() if len(bucket["entries"]) == 1
    ]
    return {"recurring": recurring, "event_specific": event_specific}


def build_challenges(events):
    return _recurring_text_analysis(events, "challenges_faced")


def build_recommendations(events):
    return _recurring_text_analysis(events, "recommendation_conclusion")


def build_communications_performance(events):
    """Section G — built entirely from existing SupportRequest/TodoItem
    data. A request counts as "Completed" once every to-do item on it is
    done; "Overdue" if the event has already ended and it's still not
    fully done; otherwise "Pending". (SupportRequest has no status field
    of its own — this mirrors the same derivation used elsewhere, e.g.
    Event.is_report_overdue's end-date-based logic.)
    """
    today = timezone.localdate()
    with_comms = [e for e in events if e.needs_comms_support]
    requests = [e.support_request for e in events if e.has_support_request]

    completed_requests = 0
    pending_requests = 0
    overdue_requests = 0
    by_support_type = defaultdict(lambda: {"total": 0, "completed": 0})

    labels = dict(ConfigOption.objects.filter(list_type=ConfigListType.SUPPORT_TYPE).values_list("value", "label"))

    for sr in requests:
        todos = list(sr.todo_items.all())
        total_todos = len(todos)
        done_todos = sum(1 for t in todos if t.is_done)
        is_fully_done = total_todos > 0 and done_todos == total_todos
        if is_fully_done:
            completed_requests += 1
        elif sr.event.end_date < today:
            overdue_requests += 1
        else:
            pending_requests += 1

        for t in todos:
            label = labels.get(t.support_type, t.support_type)
            by_support_type[label]["total"] += 1
            if t.is_done:
                by_support_type[label]["completed"] += 1

    return {
        "events_requiring_support": len(with_comms),
        "total_requests": len(requests),
        "completed_requests": completed_requests,
        "pending_requests": pending_requests,
        "overdue_requests": overdue_requests,
        "by_support_type": [
            {"support_type": k, "total": v["total"], "completed": v["completed"]}
            for k, v in sorted(by_support_type.items())
        ],
    }


def _build_summary_text(events, summary, period_label=None):
    """Section A: \"generate a short automatic summary based on the
    selected period and filters\" — composed entirely from the same
    numbers already computed above (no new data), phrased as a sentence
    instead of a table. Returns None when there's nothing to summarize
    (no events matched), so the frontend can show its own empty state
    instead of a summary claiming zero of everything.
    """
    if summary["total_events"] == 0:
        return None

    period_phrase = f"In {period_label}, " if period_label else "Across the selected filters, "
    parts = [
        f"{period_phrase}the organization logged {summary['total_events']} event(s) "
        f"({summary['completed_events']} completed, {summary['upcoming_events']} upcoming, "
        f"{summary['cancelled_postponed_events']} cancelled/postponed)."
    ]
    if summary["events_with_submitted_actuals"] > 0:
        parts.append(
            f"Submitted Event Status Reports account for {summary['total_participants_actual']} participant(s) "
            f"across {summary['organizations_partners_engaged']} partner organization(s)."
        )
    else:
        parts.append(
            f"{summary['organizations_partners_engaged']} partner organization(s) were involved; "
            "no Event Status Reports have been submitted yet, so participant reach isn't available."
        )
    if summary["objectives_achieved"] > 0:
        parts.append(f"{summary['objectives_achieved']} distinct objective(s) were reported on as achieved.")
    if summary["follow_up_actions_logged"] > 0:
        parts.append(f"{summary['follow_up_actions_logged']} follow-up action(s) were logged.")
    return " ".join(parts)


def build_planned_vs_actual():
    """Six-report spec asks every organization-wide report to show
    Planned vs Actual (Events/Participants/Objectives) where the system
    "has both planned and actual values." It doesn't have planned values
    for any of the three — no target/plan model or field exists anywhere
    — so this returns an explicit, honest "not available" result rather
    than a table of zeros or 100%/0% achievement figures that would look
    like real data but aren't.
    """
    return {
        "available": False,
        "reason": "No planned/target values for events, participants, or objectives exist in the system yet.",
    }


def build_follow_up_summary(events):
    """Follow-up Summary (spec: Total/Completed/In Progress/Overdue/
    Completion Rate) — only Total and Overdue are actually computable
    from the current schema (see module docstring: FollowUpAction has no
    status field). Completed, In Progress, and Completion Rate are
    returned as None rather than guessed at.
    """
    today = timezone.localdate()
    total = 0
    overdue = 0
    for e in events:
        report = getattr(e, "post_event_report", None)
        if not report or report.status != "submitted":
            continue
        for action in report.follow_up_actions.all():
            total += 1
            if action.deadline < today:
                overdue += 1
    return {
        "total_actions": total,
        "overdue_actions": overdue,
        "completed_actions": None,
        "in_progress_actions": None,
        "completion_rate": None,
        "note": "Completed/In Progress/Completion Rate aren't available - Follow-up Actions "
        "don't have a status field yet (only action, responsible person, and deadline).",
    }


def build_partner_summary(events):
    """Partner Summary (Executive Management Report spec): Number of
    Partners, Events Involving Partners, Co-organized Events, Partner
    Participation — all derivable from the two existing free-text org
    fields (see module docstring on why there's no structured Partner
    model to query instead). "Partner Participation" is the sum of
    submitted-report participant counts across events that name a
    partner, same actuals-only rule as everywhere else in this module.
    """
    events_with_partner = [e for e in events if e.organization_lead_agency or e.co_organizer_name]
    co_organized = [e for e in events if e.co_organizer_name]

    partner_participation = 0
    for e in events_with_partner:
        report = getattr(e, "post_event_report", None)
        if report and report.status == "submitted":
            if report.participants_male is not None and report.participants_female is not None:
                partner_participation += report.participants_male + report.participants_female

    return {
        "total_partners": len(_organizations_engaged(events)),
        "events_involving_partners": len(events_with_partner),
        "co_organized_events": len(co_organized),
        "partner_participation": partner_participation,
    }


def build_organizational_performance_report(events_qs, period_label=None):
    events = list(
        events_qs.prefetch_related("post_event_report__follow_up_actions", "support_request__todo_items")
    )
    executive_summary = build_executive_summary(events)
    executive_summary["summary_text"] = _build_summary_text(events, executive_summary, period_label)
    return {
        "executive_summary": executive_summary,
        "performance_overview": build_performance_overview(events),
        "planned_vs_actual": build_planned_vs_actual(),
        "event_activity": build_event_activity(events),
        "partner_summary": build_partner_summary(events),
        "key_achievements": build_key_achievements(events),
        "challenges": build_challenges(events),
        "recommendations": build_recommendations(events),
        "communications_performance": build_communications_performance(events),
        "follow_up_summary": build_follow_up_summary(events),
        # Sections shown on the Management Report page, additive to those above.
        "participant_overview": build_participant_overview(events),
        "thematic_area_breakdown": build_thematic_area_breakdown(events),
        "engagement_level_breakdown": build_engagement_level_breakdown(events),
        "support_level_breakdown": build_support_level_breakdown(events),
        "financial_overview": build_financial_overview(events),
        "highlights": build_highlights(events),
        "outcomes_achieved": build_outcomes_achieved(events),
        "attention_items": build_attention_items(events),
    }


def _submitted_reports(events):
    """Shared helper: (event, report) pairs for events with a submitted
    Event Status Report — the actuals-only rule used throughout this
    module applies here too."""
    for e in events:
        report = getattr(e, "post_event_report", None)
        if report and report.status == "submitted":
            yield e, report


def build_participant_overview(events):
    """Management Report v2, Participant Overview: Total / Female / Male
    — actuals only (same rule as build_executive_summary's participant
    count), since expected counts aren't real attendance."""
    total_female = 0
    total_male = 0
    for _e, report in _submitted_reports(events):
        if report.participants_male is not None and report.participants_female is not None:
            total_female += report.participants_female
            total_male += report.participants_male
    return {
        "total_participants": total_female + total_male,
        "female": total_female,
        "male": total_male,
    }


def _breakdown_by(events, code_fn, label_fn):
    """Generic count-by-code breakdown, sorted largest first — same
    approach as the frontend's own countBy() used for chart data
    elsewhere, done server-side here so the Management Report doesn't
    need to duplicate the label-lookup logic (get_thematic_area_label
    etc.) in JavaScript."""
    counts = {}
    for e in events:
        code = code_fn(e)
        if not code:
            continue
        if code not in counts:
            counts[code] = {"code": code, "label": label_fn(e), "count": 0}
        counts[code]["count"] += 1
    return sorted(counts.values(), key=lambda row: row["count"], reverse=True)


def build_thematic_area_breakdown(events):
    return _breakdown_by(events, lambda e: e.thematic_area, lambda e: e.get_thematic_area_label())


def build_engagement_level_breakdown(events):
    return _breakdown_by(events, lambda e: e.engagement_level, lambda e: e.get_engagement_level_label())


def build_support_level_breakdown(events):
    """Support Level here is the Financial/Technical/Both field on Event
    (SupportLevelChoice) — distinct from Communications Support
    (banners/photographers/etc.), per that field's own model docstring."""
    return _breakdown_by(
        events,
        lambda e: e.support_level,
        lambda e: e.get_support_level_label(),
    )


def build_financial_overview(events):
    """Management Report v2, Financial Overview — actuals only, same
    timing rule as participants: PostEventReport.total_expenditure is
    only meaningful once entered against a submitted report. Events
    without a recorded expenditure simply don't contribute, rather than
    being treated as $0 spend."""
    total = 0
    events_with_cost = 0
    participants_for_cost = 0
    by_thematic = {}
    for e, report in _submitted_reports(events):
        if report.total_expenditure is None:
            continue
        total += report.total_expenditure
        events_with_cost += 1
        if report.participants_male is not None and report.participants_female is not None:
            participants_for_cost += report.participants_male + report.participants_female
        key = e.thematic_area
        if key not in by_thematic:
            by_thematic[key] = {"code": key, "label": e.get_thematic_area_label(), "total": 0}
        by_thematic[key]["total"] += report.total_expenditure

    return {
        "total_expenditure": total if events_with_cost else None,
        "average_cost_per_event": round(total / events_with_cost, 2) if events_with_cost else None,
        "cost_per_participant": round(total / participants_for_cost, 2) if participants_for_cost else None,
        "events_with_recorded_cost": events_with_cost,
        "by_thematic_area": sorted(by_thematic.values(), key=lambda row: row["total"], reverse=True),
    }


def build_highlights(events):
    """Management Report v2, Highlights — the period's most notable
    events, ranked by actual attendance (the one objective size signal
    the system has). Limited to submitted reports for the same
    actuals-only reason as everywhere else; an event with no submitted
    report has no verified size to rank by."""
    ranked = []
    for e, report in _submitted_reports(events):
        if report.participants_male is None or report.participants_female is None:
            continue
        count = report.participants_male + report.participants_female
        ranked.append((count, e))
    ranked.sort(key=lambda pair: pair[0], reverse=True)
    return [
        {
            "event_id": e.id,
            "title": e.title,
            "participant_count": count,
            "engagement_level": e.get_engagement_level_label(),
        }
        for count, e in ranked[:5]
    ]


def build_outcomes_achieved(events):
    """Management Report v2, Outcomes Achieved — pulled directly from
    Post-Event Report's major_accomplishment field, per event, rather
    than re-deriving anything new. Limited to submitted reports with
    non-blank text."""
    items = []
    for e, report in _submitted_reports(events):
        text = (report.major_accomplishment or "").strip()
        if not text:
            continue
        items.append({"event_id": e.id, "event_title": e.title, "text": text})
    return items


def build_attention_items(events):
    """Management Report v2, Attention Items: events postponed/cancelled
    in the period (with the reason already captured on Event.status_reason),
    plus events whose report is overdue — reusing Event.is_report_overdue
    rather than re-deriving that rule here."""
    postponed_cancelled = [
        {
            "event_id": e.id,
            "title": e.title,
            "status": e.get_status_label(),
            "reason": e.status_reason or "",
        }
        for e in events
        if e.status in (EventStatus.CANCELLED, EventStatus.POSTPONED)
    ]
    missing_reports = [
        {"event_id": e.id, "title": e.title, "end_date": e.end_date}
        for e in events
        if e.is_report_overdue
    ]
    return {
        "postponed_cancelled": postponed_cancelled,
        "missing_reports": missing_reports,
    }
