import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import apps.tv_display.models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='TVDisplaySettings',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('is_active', models.BooleanField(default=True, help_text='Master on/off for the whole TV Display rotation.')),
                ('screen_duration_seconds', models.PositiveIntegerField(default=15, help_text='How long each section stays on screen before rotating to the next.')),
                ('sections', models.JSONField(default=apps.tv_display.models._default_sections)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
            ],
        ),
    ]
