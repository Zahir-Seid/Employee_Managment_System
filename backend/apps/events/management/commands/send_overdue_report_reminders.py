from django.core.management.base import BaseCommand

from apps.events.services.notifications import notify_overdue_reports


class Command(BaseCommand):
    """FR37 (staff request): the "Event Status Report Overdue" notification
    type has existed since the Notification model was introduced, but
    nothing ever triggered it — the Dashboard's Overdue Alerts banner
    reads the same is_report_overdue condition at render time, but that's
    a passive display, not a push notification/email to the person who
    actually needs to act.

    Each user's own overdue events are also notified automatically when
    their bell checks for notifications (NotificationUnreadCountView), so no
    scheduler is needed for people who use the app. Run this command daily
    (cron, a systemd timer, etc.) to also reach owners who haven't logged in.
    Example crontab entry (once a day, 7am):

        0 7 * * * cd /path/to/backend && /path/to/venv/bin/python manage.py send_overdue_report_reminders

    Each event is reminded once (see Event.report_overdue_notified_at) —
    not re-sent every single day it stays overdue — to avoid burying the
    owner in repeat emails. Re-run manually any time with --force to
    re-notify everyone currently overdue regardless of that guard, e.g.
    for a one-off catch-up reminder.
    """

    help = "Sends an Event Status Report Overdue notification (in-app + email) to the owner of each overdue event."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Re-notify every currently-overdue event, even ones already notified before.",
        )

    def handle(self, *args, **options):
        sent_count = notify_overdue_reports(force=options["force"])
        self.stdout.write(self.style.SUCCESS(f"Sent {sent_count} overdue report reminder(s)."))
