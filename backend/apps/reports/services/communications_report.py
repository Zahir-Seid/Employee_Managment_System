"""Communications Report (EMS Reporting System spec §15/§16 — a
complete picture of communication activities connected to events, one
row per To-Do item rather than per event, since a single event can carry
several communication tasks of different types).

Spec §16 requires the UI to clearly separate two concepts that must never
be combined into one value:
  - Communication Support Type (TodoItem.support_type / label) — e.g.
    Photography, Videography, Graphic Design.
  - Communication Task Status — the spec asks for To Do / Assigned /
    In Progress / Review / Completed / Published-Delivered / Archived.
    TodoItem only has a single `is_done` boolean (see
    apps/communications/models.py) — there is no field anywhere that
    records which of those seven states an incomplete task is in. Rather
    than inventing a fake progression, this module reports only what the
    schema can actually support: `completed` (is_done=True) and, for
    everything not yet done, `pending` vs `overdue` (event has already
    ended) — the exact same three-way split
    services/organizational_report.build_communications_performance
    already uses for its per-support-type table, so the two reports can't
    disagree with each other (spec §27). "In Progress" and "To Do" are
    surfaced as explicit `None` fields with a note rather than left out
    silently or guessed at from `pending`.

"Outputs Produced" (spec §15 KPI) is left as `None` for the same reason:
nothing on TodoItem/SupportRequest records a delivered file, link, or
artifact — there's no "output" to count. TodoItem.notes (free text) is
surfaced per-row as context, not relabeled as a verified "output."

"Responsible Person" per activity: TodoItem has no assignee field before
completion — only `completed_by`, set once the item is marked done. Rows
report the event Owner as the person who requested/owns the work, and
`completed_by` (when set) as who actually completed it, rather than
inventing a single "Responsible" value that doesn't exist in the schema.
"""

from django.db.models import Q
from django.utils import timezone

from apps.communications.models import TodoItem

from .report_data import get_report_queryset


def get_communications_queryset(
    event_title=None,
    support_type=None,
    responsible_person=None,
    **event_filter_kwargs,
):
    """Resolves the filtered TodoItem queryset for the Communications
    Report. Event-level filters (period/date range, Program, Region,
    Event Type, Support Level, Partner/Organization) are delegated to the
    same get_report_queryset every other report uses (spec §27/§28);
    `event_title` and the To-Do-level filters below are specific to
    this report.

    (The `priority` filter/column this report used to offer was removed
    along with SupportRequest.urgency — Event Registry / Days Until
    Event update.)
    """
    events_qs, start, end = get_report_queryset(**event_filter_kwargs)
    if event_title:
        events_qs = events_qs.filter(title__icontains=event_title)

    todos = TodoItem.objects.filter(support_request__event__in=events_qs).select_related(
        "support_request__event__owner", "completed_by"
    )

    if support_type:
        todos = todos.filter(support_type=support_type)
    if responsible_person:
        todos = todos.filter(
            Q(completed_by__first_name__icontains=responsible_person)
            | Q(completed_by__last_name__icontains=responsible_person)
            | Q(support_request__event__owner__first_name__icontains=responsible_person)
            | Q(support_request__event__owner__last_name__icontains=responsible_person)
        )

    return todos.order_by("support_request__event__start_date"), start, end


def _task_status(todo, today):
    if todo.is_done:
        return "completed"
    if todo.support_request.event.end_date < today:
        return "overdue"
    return "pending"


def build_communications_rows(todos):
    today = timezone.localdate()
    rows = []
    for t in todos:
        event = t.support_request.event
        rows.append({
            "todo_id": t.id,
            "event_id": event.id,
            "event_title": event.title,
            "activity": t.label,
            "support_type": t.support_type,
            "status": _task_status(t, today),
            "requested_by": event.owner.get_full_name() if event.owner else None,
            "completed_by": t.completed_by.get_full_name() if t.completed_by else None,
            "due_date": event.end_date,
            "notes": t.notes,
        })
    return rows


def build_communications_summary(rows):
    total = len(rows)
    completed = sum(1 for r in rows if r["status"] == "completed")
    pending = sum(1 for r in rows if r["status"] == "pending")
    overdue = sum(1 for r in rows if r["status"] == "overdue")
    return {
        "total_activities": total,
        "completed": completed,
        "in_progress": None,
        "to_do": None,
        "pending": pending,
        "overdue": overdue,
        "outputs_produced": None,
        "note": (
            "Communication tasks only record a single done/not-done flag today, so "
            "In Progress, To Do, and Outputs Produced can't be reported separately - "
            "\"Pending\" below covers every not-yet-completed task that isn't overdue."
        ),
    }


def build_communications_report(todos, status_filter=None):
    rows = build_communications_rows(todos)
    if status_filter:
        rows = [r for r in rows if r["status"] == status_filter]
    return {
        "summary": build_communications_summary(rows),
        "rows": rows,
    }


# Export columns, mirroring CommunicationsReport.jsx's TABLE_COLUMNS. Callers
# must set row["responsible"] = row["completed_by"] or row["requested_by"]
# first, as the frontend does.
EXPORT_HEADERS = [
    ("Activity", "activity", 24),
    ("Event", "event_title", 30),
    ("Type", "support_type", 16),
    ("Responsible", "responsible", 22),
    ("Status", "status", 14),
    ("Due Date", "due_date", 14),
    ("Notes", "notes", 32),
]
