import io
import os
from xml.sax.saxutils import escape

from django.utils import timezone
from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

styles = getSampleStyleSheet()
title_style = ParagraphStyle("EMSTitle", parent=styles["Title"], fontSize=18, spaceAfter=12)
heading_style = ParagraphStyle("EMSHeading", parent=styles["Heading2"], spaceBefore=14, spaceAfter=6)
subheading_style = ParagraphStyle("EMSSubheading", parent=styles["Heading3"], spaceBefore=10, spaceAfter=4)
# Justified, since the narrative fields read as prose.
body_style = ParagraphStyle("EMSBody", parent=styles["BodyText"], alignment=TA_JUSTIFY)

# Logo bundled with the backend so report generation doesn't depend on the
# frontend being reachable.
LOGO_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "logo.png")


def _build_table(rows, header=False, col_widths=None):
    table = Table(rows, colWidths=col_widths)
    style = [
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        style.append(("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F3864")))
        style.append(("TEXTCOLOR", (0, 0), (-1, 0), colors.white))
        style.append(("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"))
    table.setStyle(TableStyle(style))
    return table


# Content width on a Letter page with the default 1" margins.
_PAGE_CONTENT_WIDTH = letter[0] - 2 * inch


_cell_style = ParagraphStyle("EMSCell", parent=styles["BodyText"], fontSize=9, leading=11, spaceBefore=0, spaceAfter=0)


def _cell(text, bold=False):
    """Cell content as a Paragraph so long text (event titles, venues,
    organization names, checkbox labels) wraps inside its cell. A plain
    string never wraps in reportlab and runs over into the next column."""
    text = escape(str(text))
    return Paragraph(f"<b>{text}</b>" if bold else text, _cell_style)


def _grid_table(rows, columns, col_widths=None):
    """Builds the Introduction / Participant Summary tables as ONE real
    reportlab Table with a fixed number of equal-width columns, instead
    of a separate mini-table per row. Each `rows` entry is a list of
    (text, bold) cells — fewer than `columns` entries is fine (most rows
    have 2, the checkbox rows have up to `columns`): the last cell in a
    short row is merged (SPANned) across whatever columns are left, so
    every row still shares the same column boundaries as the rows above
    and below it, and the whole thing reads as one structured grid
    instead of a stack of differently-sized boxes.
    """
    data = []
    span_commands = []
    for r_idx, cells in enumerate(rows):
        row_data = [_cell(text, bold) for text, bold in cells]
        n = len(cells)
        while len(row_data) < columns:
            row_data.append("")
        if n < columns:
            span_commands.append(("SPAN", (n - 1, r_idx), (columns - 1, r_idx)))
        data.append(row_data)

    col_widths = col_widths or [_PAGE_CONTENT_WIDTH / columns] * columns
    style = [
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    style.extend(span_commands)

    table = Table(data, colWidths=col_widths)
    table.setStyle(TableStyle(style))
    return table


# --- Event report template ---------------------------------------------
# Same layout as docx_generator._add_event_report_body; keep the two in step.

# Plain-text boxes: the built-in PDF fonts have no ballot-box glyphs, so the
# Unicode boxes all printed as the same black square and a ticked option
# could not be told from an empty one.
_CHECKBOX_CHECKED = "[X]"
_CHECKBOX_EMPTY = "[  ]"


def _checkbox_label(label, checked):
    return f"{label}: {_CHECKBOX_CHECKED if checked else _CHECKBOX_EMPTY}"


_INTRODUCTION_COLUMNS = 5
_PARTICIPANT_SUMMARY_COLUMNS = 6


def _introduction_table(event):
    rows = [
        [("Name of the event", True), (event.title, False)],
        [("Event place/Venue:", True), (", ".join(part for part in (event.venue, event.city, event.country if event.category == "international" else "") if part), False)],
        [
            ("Reported by", True), (event.owner.get_full_name() or event.owner.email, False),
            ("Reporting date:", True), (timezone.now().date().isoformat(), False),
        ],
        [
            ("Event Type", True),
            (_checkbox_label("Training", event.event_type == "training"), False),
            (_checkbox_label("Workshop", event.event_type == "workshop"), False),
            (_checkbox_label("Conference", event.event_type == "conference"), False),
            (_checkbox_label("Supportive Supervision", event.event_type == "supportive_supervision"), False),
        ],
        [
            ("", False),
            (_checkbox_label(
                event.event_type_full_label if event.event_type == "rm" else "Review Meeting",
                event.event_type == "rm",
            ), False),
            (_checkbox_label(
                event.event_type_full_label if event.event_type == "other" else "Other",
                event.event_type == "other",
            ), False),
        ],
        [
            ("Event Start date:", True), (str(event.start_date), False),
            ("End date:", True), (str(event.end_date), False),
        ],
        [
            ("Mode of the event:", True),
            (_checkbox_label("In-person", event.mode_of_event == "in_person"), False),
            (_checkbox_label("Virtual", event.mode_of_event == "virtual"), False),
        ],
    ]
    # First column a little wider so labels like "Event place/Venue:" fit on one line.
    widths = [1.5 * inch, 1.25 * inch, 1.25 * inch, 1.25 * inch, 1.25 * inch]
    return _grid_table(rows, columns=_INTRODUCTION_COLUMNS, col_widths=widths)


def _participant_summary_table(report):
    total = report.participants_total if report else None
    male = report.participants_male if report else None
    female = report.participants_female if report else None
    org_rows = report.participants_by_organization if report else []
    left = org_rows[:6]
    right = org_rows[6:11]
    letters = "ABCDEFGHIJK"
    na = lambda v: v if v is not None else "N/A"

    # Total participants is shown once, in a cell spanning the M and F rows.
    data = [
        [_cell("Total participants", True), "", _cell(na(total)), _cell("M", True), _cell(na(male)), ""],
        ["", "", "", _cell("F", True), _cell(na(female)), ""],
    ]
    for i in range(6):
        left_label, left_count = left[i] if i < len(left) else ("", "")
        right_label, right_count = right[i] if i < len(right) else ("", "")
        data.append([
            _cell(letters[i], True), _cell(left_label), _cell(left_count),
            _cell(letters[i + 6] if i < 5 else "", True), _cell(right_label), _cell(right_count),
        ])

    # Wide name columns so organization names have room; count columns are narrow.
    widths = [0.4 * inch, 2.0 * inch, 0.85 * inch, 0.4 * inch, 2.0 * inch, 0.85 * inch]
    table = Table(data, colWidths=widths)
    table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("SPAN", (0, 0), (1, 1)),
        ("SPAN", (2, 0), (2, 1)),
        ("SPAN", (4, 0), (5, 0)),
        ("SPAN", (4, 1), (5, 1)),
        ("VALIGN", (0, 0), (2, 1), "MIDDLE"),
    ]))
    return table


def _add_event_report_body(elements, event, section_start=1):
    """Sections I-VII of the new template, for one event. `section_start`
    lets Generic/Thematic Area scope keep numbering consecutive across
    the WHOLE document rather than restarting at "I." for every event —
    returns the next unused section number so the caller can chain calls.
    """
    report = event.post_event_report if event.has_post_event_report else None
    roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]
    n = section_start

    def heading(text):
        nonlocal n
        elements.append(Paragraph(f"{roman[n - 1]}. {text}", heading_style))
        n += 1

    heading("Introduction")
    elements.append(Paragraph(event.description or "N/A", body_style))
    elements.append(Spacer(1, 4))
    elements.append(_introduction_table(event))
    elements.append(Spacer(1, 10))

    heading("Participant Summary")
    elements.append(Paragraph("Organization of training participants", body_style))
    elements.append(Spacer(1, 4))
    elements.append(_participant_summary_table(report))
    elements.append(Spacer(1, 10))

    heading("Event Objective")
    elements.append(Paragraph(event.expected_outcome or "N/A", body_style))

    heading("Personal Objective relevant to EE")
    elements.append(Paragraph(event.personal_objective or "N/A", body_style))

    heading("Event Overview")
    elements.append(Paragraph((report.major_accomplishment if report else "") or "N/A", body_style))

    heading("Key Learnings & Action Points")
    practices = (report.best_practices_lessons_actions if report else "") or "N/A"
    lines = [l.strip() for l in practices.split("\n") if l.strip()] or ["N/A"]
    for line in lines:
        elements.append(Paragraph(line, body_style))

    if report and report.challenges_faced:
        heading("Challenges & Issues")
        elements.append(Paragraph(report.challenges_faced, body_style))

    heading("Partnership opportunities")
    elements.append(Paragraph((report.recommendation_conclusion if report else "") or "N/A", body_style))

    return n


def _logo_element():
    if not os.path.exists(LOGO_PATH):
        return None
    # Fixed width; height follows the logo's aspect ratio to avoid distortion.
    with PILImage.open(LOGO_PATH) as im:
        aspect_ratio = im.height / im.width
    width = 0.84 * inch
    return Image(LOGO_PATH, width=width, height=width * aspect_ratio)


def generate_single_event_pdf(event, requesting_user):
    """Report Scope = Single Event; also used by the Generate PDF button
    on Event Details. Period does not apply here. Layout matches the
    staff-supplied template — see _add_event_report_body above.

    This is the actual Event Status Report download — logo moves to the
    top-right corner here specifically, per request. The generic/
    thematic-area period reports below are a different document and keep
    the logo left-aligned as before (mirrors docx_generator.py's same
    single-event-only scoping, so PDF/Word don't drift apart on this).
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.5 * inch, bottomMargin=0.5 * inch)
    elements = []
    logo = _logo_element()
    if logo:
        logo.hAlign = "RIGHT"
        elements.append(logo)
        elements.append(Spacer(1, 6))

    _add_event_report_body(elements, event)

    doc.build(elements)
    buffer.seek(0)
    return buffer


def generate_generic_report_pdf(events, start, end, period_label, requesting_user):
    """Report Scope = Generic (Stage 6, FR40-FR43): the same per-event
    template as Single Event, repeated once per matching event (with a
    page break between), rather than the old flat summary table.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.5 * inch, bottomMargin=0.5 * inch)
    elements = []
    logo = _logo_element()
    if logo:
        elements.append(logo)
        elements.append(Spacer(1, 6))
    elements.append(Paragraph("Event Management System Report", title_style))
    elements.append(Paragraph(f"{period_label} report: {start} to {end}", heading_style))

    for i, event in enumerate(events):
        if i > 0:
            elements.append(PageBreak())
        _add_event_report_body(elements, event)

    doc.build(elements)
    buffer.seek(0)
    return buffer


def generate_thematic_area_report_pdf(grouped_events, start, end, period_label, requesting_user):
    """Report Scope = Thematic Area: the same per-event template as
    Single Event, grouped under a heading per thematic area, one page
    break between events.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.5 * inch, bottomMargin=0.5 * inch)
    elements = []
    logo = _logo_element()
    if logo:
        elements.append(logo)
        elements.append(Spacer(1, 6))
    elements.append(Paragraph("Event Management System Report by Thematic Area", title_style))
    elements.append(Paragraph(f"{period_label} report: {start} to {end}", heading_style))

    first = True
    for thematic_area, events in grouped_events.items():
        if not first:
            elements.append(PageBreak())
        first = False
        elements.append(Paragraph(f"{thematic_area} ({len(events)} event{'s' if len(events) != 1 else ''})", subheading_style))
        for i, event in enumerate(events):
            if i > 0:
                elements.append(PageBreak())
            _add_event_report_body(elements, event)

    doc.build(elements)
    buffer.seek(0)
    return buffer
