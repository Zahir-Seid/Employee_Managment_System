# Generated manually for the Dashboard Big Events feature.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('events', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='event',
            name='big_event_photo',
            field=models.ImageField(blank=True, null=True, upload_to='big_event_photos/%Y/%m/'),
        ),
    ]
