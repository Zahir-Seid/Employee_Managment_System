"""Item #5: Word (.docx) export, alongside the existing PDF/Excel formats.
Mirrors pdf_generator.py's three entry points (single event / generic /
thematic area) so all three formats stay in sync on what a report contains.

Layout follows the staff-supplied Event_Report_TEMPLATE_REPLICA.docx (see
_add_event_report_body's docstring for the exact section list and what was
deliberately left out).
"""

import io
import os

from django.utils import timezone
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt, RGBColor

HEADER_RGB = RGBColor(0x19, 0x2B, 0x74)  # Royal Blue, per the EMS brand palette (§12)

# Section heading color, and shading/border for the boxed narrative sections.
SECTION_HEADING_RGB = RGBColor(0x0F, 0x1F, 0x3D)
BOX_BORDER_HEX = "0F1F3D"
BOX_FILL_HEX = "F2F4F7"  # matches the web preview's bg-surface-muted

# Bundled logo, shared with pdf_generator.
LOGO_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "logo.png")


def _remove_paragraph_bottom_border(paragraph):
    """python-docx's built-in 'Title' style (level=0) draws a horizontal
    rule under the text by default — this strips it via direct formatting
    (which overrides the style), so the report title reads clean, matching
    the "no horizontal lines under the title" requirement.
    """
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement

    pPr = paragraph._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "nil")
    pBdr.append(bottom)
    pPr.append(pBdr)


def _add_title(doc, text):
    heading = doc.add_heading(text, level=0)
    _remove_paragraph_bottom_border(heading)
    for run in heading.runs:
        run.font.color.rgb = HEADER_RGB


def _add_kv_table(doc, rows):
    """Kept for potential reuse — no longer called by the current
    single/generic/thematic templates (see _add_event_report_body), which
    use _add_grid_table's single-fixed-grid-with-merges approach instead
    to match the source template's per-row column counts while still
    sharing one set of column boundaries down the whole table.
    """
    table = doc.add_table(rows=0, cols=2)
    table.style = "Light List Accent 1"
    for label, value in rows:
        row = table.add_row()
        row.cells[0].text = label
        row.cells[0].paragraphs[0].runs[0].font.bold = True
        row.cells[1].text = str(value)
    return table


# --- Event report template ---------------------------------------------
# Used for Single Event, Generic and Thematic Area reports; the latter two
# render it once per event with a page break between. "Objectives of the
# Meeting" is now split into "Personal Objective" (Event.personal_objective)
# and "Event Objective" (Event.expected_outcome). "Project name" and "DUP's role" are
# intentionally omitted since the system doesn't track them. Sections are
# numbered consecutively (I, II, III...).

_CHECKBOX_CHECKED = "\u2612"  # ☒
_CHECKBOX_EMPTY = "\u2610"  # ☐


# Content width on a Letter page with the default 1" margins.
_PAGE_CONTENT_WIDTH_IN = 6.5


def _add_grid_table(doc, rows, columns):
    """Builds the Introduction / Participant Summary tables as ONE real
    Word table with a fixed number of equal-width columns, instead of a
    separate mini-table per row. Each `rows` entry is a list of
    (text, bold) cells — fewer than `columns` entries is fine (most rows
    have 2, the checkbox rows have up to `columns`): the last cell in a
    short row is merged across whatever columns are left, so every row
    still shares the same column boundaries as the rows above and below
    it, and the whole thing reads as one structured grid — matching
    normal column/row sizing — instead of a stack of differently-sized
    boxes.
    """
    n_rows = len(rows)
    table = doc.add_table(rows=n_rows, cols=columns)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False

    # Set grid column widths before merging; a merged cell's width is the sum of
    # the columns it covers.
    col_width = Inches(_PAGE_CONTENT_WIDTH_IN / columns)
    for row in table.rows:
        for cell in row.cells:
            cell.width = col_width

    for r_idx, cells in enumerate(rows):
        n = len(cells)
        for c_idx, (text, bold) in enumerate(cells):
            cell = table.cell(r_idx, c_idx)
            if c_idx == n - 1 and n < columns:
                cell = cell.merge(table.cell(r_idx, columns - 1))
            cell.text = str(text)
            if bold and cell.paragraphs[0].runs:
                cell.paragraphs[0].runs[0].font.bold = True
    return table


def _checkbox_label(label, checked):
    return f"{label}: {_CHECKBOX_CHECKED if checked else _CHECKBOX_EMPTY}"


def _set_cell_shading(cell, hex_color):
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement

    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tcPr.append(shd)


def _set_cell_left_border(cell, rgb_hex):
    """Only the left edge gets a (thick, accent-colored) border — the other
    three are explicitly set to "nil" so the surrounding table doesn't pick
    up a default single-line border on every side.
    """
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement

    tcPr = cell._tc.get_or_add_tcPr()
    tcBorders = OxmlElement("w:tcBorders")
    for edge in ("top", "left", "bottom", "right"):
        el = OxmlElement(f"w:{edge}")
        if edge == "left":
            el.set(qn("w:val"), "single")
            el.set(qn("w:sz"), "24")
            el.set(qn("w:space"), "0")
            el.set(qn("w:color"), rgb_hex)
        else:
            el.set(qn("w:val"), "nil")
        tcBorders.append(el)
    tcPr.append(tcBorders)


def _set_cell_margins(cell, top=120, left=160, bottom=120, right=120):
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement

    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = OxmlElement("w:tcMar")
    for edge, val in (("top", top), ("left", left), ("bottom", bottom), ("right", right)):
        node = OxmlElement(f"w:{edge}")
        node.set(qn("w:w"), str(val))
        node.set(qn("w:type"), "dxa")
        tcMar.append(node)
    tcPr.append(tcMar)


def _add_boxed_section(doc, title):
    """The Introduction/Participant Summary sections already have their
    own bordered table doing the visual separation, so they stay a plain
    heading (see `heading()` below). The narrative-only sections from
    Objectives onward instead render as a single-cell, borderless-except-
    left-edge table with a light fill — a shaded callout, matching the
    EE-supplied template — with the heading and body sharing that one
    cell so the whole block reads as one unit. Returns the cell so the
    caller can add its body paragraphs into it.
    """
    table = doc.add_table(rows=1, cols=1)
    table.autofit = False
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    cell = table.cell(0, 0)
    cell.width = Inches(_PAGE_CONTENT_WIDTH_IN)
    _set_cell_shading(cell, BOX_FILL_HEX)
    _set_cell_left_border(cell, BOX_BORDER_HEX)
    _set_cell_margins(cell)

    heading_paragraph = cell.paragraphs[0]
    run = heading_paragraph.add_run(title)
    run.font.bold = True
    run.font.size = Pt(12)
    run.font.color.rgb = SECTION_HEADING_RGB
    return cell


_INTRODUCTION_COLUMNS = 4
_PARTICIPANT_SUMMARY_COLUMNS = 6


def _add_introduction_table(doc, event):
    rows = [
        [("Name of the event", True), (event.title, False)],
        [("Event place/Venue:", True), (", ".join(part for part in (event.venue, event.city, event.country if event.category == "international" else "") if part), False)],
        [
            ("Reported by", True), (event.owner.get_full_name() or event.owner.email, False),
            ("Reporting date:", True), (timezone.now().date().isoformat(), False),
        ],
        [
            ("Event Type", True),
            (event.event_type_full_label, False),
        ],
        [
            ("Event Start date:", True), (str(event.start_date), False),
            ("End date:", True), (str(event.end_date), False),
        ],
        [
            ("Mode of the event:", True),
            (event.get_mode_of_event_display(), False),
        ],
    ]
    _add_grid_table(doc, rows, columns=_INTRODUCTION_COLUMNS)


def _add_participant_summary_table(doc, report):
    total = report.participants_total if report else None
    male = report.participants_male if report else None
    female = report.participants_female if report else None
    org_rows = report.participants_by_organization if report else []
    # Fixed A-K order: A-F on the left, G-K on the right.
    left = org_rows[:6]
    right = org_rows[6:11]
    letters = "ABCDEFGHIJK"

    doc.add_paragraph("Organization of training participants")
    na = lambda v: v if v is not None else "N/A"
    rows = [
        [("Total participants", True), ("", False), (na(total), False), ("M", True), (na(male), False)],
        [("", False), ("", False), ("", False), ("F", True), (na(female), False)],
    ]
    for i in range(6):
        left_label, left_count = left[i] if i < len(left) else ("", "")
        right_label, right_count = right[i] if i < len(right) else ("", "")
        rows.append([
            (letters[i], True), (left_label, False), (left_count, False),
            (letters[i + 6] if i < 5 else "", True), (right_label, False), (right_count, False),
        ])
    table = _add_grid_table(doc, rows, columns=_PARTICIPANT_SUMMARY_COLUMNS)
    # Total participants is shown once: merge it (label and number) down across
    # the M and F rows instead of repeating it on each.
    label = table.cell(0, 0).merge(table.cell(1, 1))
    label.text = "Total participants"
    label.paragraphs[0].runs[0].font.bold = True
    total_cell = table.cell(0, 2).merge(table.cell(1, 2))
    total_cell.text = str(na(total))


def _add_event_report_body(doc, event, section_start=1):
    """Sections I-VII of the new template, for one event. `section_start`
    lets Generic/Thematic Area scope keep numbering consecutive across
    the WHOLE document rather than restarting at "I." for every event —
    returns the next unused section number so the caller can chain calls.
    """
    report = event.post_event_report if event.has_post_event_report else None
    n = section_start
    roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]

    def heading(text):
        nonlocal n
        doc.add_heading(f"{roman[n - 1]}. {text}", level=1)
        n += 1

    def boxed_heading(text):
        """Same numbering as heading(), but returns the shaded callout
        cell to add body paragraphs into instead of writing directly to
        the document body."""
        nonlocal n
        cell = _add_boxed_section(doc, f"{roman[n - 1]}. {text}")
        n += 1
        return cell

    heading("Introduction")
    doc.add_paragraph(event.description or "N/A").alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    _add_introduction_table(doc, event)
    doc.add_paragraph("")

    heading("Participant Summary")
    _add_participant_summary_table(doc, report)
    doc.add_paragraph("")

    cell = boxed_heading("Event Objective")
    p = cell.add_paragraph(event.expected_outcome or "N/A")
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    doc.add_paragraph("")

    cell = boxed_heading("Personal Objective relevant to EE")
    p = cell.add_paragraph(event.personal_objective or "N/A")
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    doc.add_paragraph("")

    cell = boxed_heading("Event Overview")
    p = cell.add_paragraph(report.major_accomplishment if report else "N/A")
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    doc.add_paragraph("")

    cell = boxed_heading("Key Learnings & Action Points")
    practices = (report.best_practices_lessons_actions if report else "") or "N/A"
    for line in [l.strip() for l in practices.split("\n") if l.strip()] or ["N/A"]:
        p = cell.add_paragraph(line)
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    doc.add_paragraph("")

    if report and report.challenges_faced:
        cell = boxed_heading("Challenges & Issues")
        p = cell.add_paragraph(report.challenges_faced)
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        doc.add_paragraph("")

    cell = boxed_heading("Partnership opportunities")
    p = cell.add_paragraph((report.recommendation_conclusion if report else "") or "N/A")
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY

    return n


def generate_single_event_docx(event, requesting_user):
    doc = Document()
    # The Event Status Report download puts the logo top-right; the period
    # reports below keep it left-aligned.
    if os.path.exists(LOGO_PATH):
        logo_paragraph = doc.add_paragraph()
        logo_paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        logo_paragraph.add_run().add_picture(LOGO_PATH, width=Inches(0.6))
    _add_event_report_body(doc, event)

    buffer = io.BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    return buffer


def generate_generic_report_docx(events, start, end, period_label, requesting_user):
    doc = Document()
    if os.path.exists(LOGO_PATH):
        doc.add_picture(LOGO_PATH, width=Inches(0.6))
    _add_title(doc, "Event Management System Report")
    doc.add_paragraph(f"{period_label} report: {start} to {end}")

    for i, event in enumerate(events):
        if i > 0:
            doc.add_page_break()
        _add_event_report_body(doc, event)

    buffer = io.BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    return buffer


def generate_thematic_area_report_docx(grouped_events, start, end, period_label, requesting_user):
    doc = Document()
    if os.path.exists(LOGO_PATH):
        doc.add_picture(LOGO_PATH, width=Inches(0.6))
    _add_title(doc, "Event Management System Report by Thematic Area")
    doc.add_paragraph(f"{period_label} report: {start} to {end}")

    first = True
    for thematic_area, events in grouped_events.items():
        if not first:
            doc.add_page_break()
        first = False
        doc.add_heading(f"{thematic_area} ({len(events)} event{'s' if len(events) != 1 else ''})", level=1)
        for i, event in enumerate(events):
            if i > 0:
                doc.add_page_break()
            _add_event_report_body(doc, event)

    buffer = io.BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    return buffer
