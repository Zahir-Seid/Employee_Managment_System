# Support Requests Enhancement: adds the Communications Lead role.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='user',
            name='role',
            field=models.CharField(
                choices=[
                    ('staff', 'Staff'),
                    ('communications', 'Communications'),
                    ('comms_lead', 'Communications Lead'),
                    ('leadership', 'Leadership/SMT'),
                    ('admin', 'Admin'),
                ],
                default='staff',
                max_length=20,
            ),
        ),
    ]
