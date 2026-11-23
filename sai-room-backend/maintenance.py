"""Consistent daily SQLite backups, separate from the public static directories."""
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from database import DB_PATH


def daily_backup():
    location = os.environ.get('SAI_BACKUP_DIR')
    if not location or not DB_PATH.is_file():
        return None
    directory = Path(location)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = directory / (datetime.now(timezone.utc).strftime('sai-%Y-%m-%d') + '.sqlite3')
    if target.exists():
        return target
    with NamedTemporaryFile(prefix='.sai-backup-', dir=directory, delete=False) as file:
        temporary = Path(file.name)
    try:
        with sqlite3.connect(DB_PATH) as source, sqlite3.connect(temporary) as destination:
            source.backup(destination)
            if destination.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise RuntimeError('Database backup verification failed')
        os.chmod(temporary, 0o600)
        os.replace(temporary, target)
        snapshots = sorted(directory.glob('sai-????-??-??.sqlite3'))
        for expired in snapshots[:-7]:
            expired.unlink()
        return target
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    result = daily_backup()
    print('Database backup ready.' if result else 'No database or backup directory configured.')
