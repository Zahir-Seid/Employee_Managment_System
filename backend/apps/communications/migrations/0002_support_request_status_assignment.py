# Support Requests Enhancement: adds `status` (Pending Review/In
# Progress/Completed/Declined) and `assigned_to` (Communications
# team members, incl. Communications Lead) to SupportRequest.
# Priority is deliberately NOT a migration/DB field — it's derived live
# from the event's date, see SupportRequest.priority in models.py.
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('communications', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='supportrequest',
            name='status',
            field=models.CharField(
                choices=[
                    ('pending_review', 'Pending Review'),
                    ('in_progress', 'In Progress'),
                    ('completed', 'Completed'),
                    ('declined', 'Declined'),
                ],
                default='pending_review',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='supportrequest',
            name='assigned_to',
            field=models.ManyToManyField(blank=True, related_name='assigned_support_requests', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddIndex(
            model_name='supportrequest',
            index=models.Index(fields=['status'], name='communicati_status_1f3b9a_idx'),
        ),
    ]
