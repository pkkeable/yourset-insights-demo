import contextlib
import fcntl
import json
import os
import stat
import tempfile
from pathlib import Path


def verify_path(path, private=False):
    path = Path(path).absolute()
    for part in [*reversed(path.parents), path]:
        if part.is_symlink():
            raise PermissionError("symlink_rejected")
    if path.exists():
        s = path.stat()
        if s.st_uid != os.getuid():
            raise PermissionError("owner_mismatch")
        if private and stat.S_IMODE(s.st_mode) & 0o077:
            raise PermissionError("private_mode_required")
    return path


def runtime():
    return (
        Path.home()
        / "Library"
        / "Application Support"
        / "YourSetInsights"
        / "GarminCollector"
    )


def prepare(root):
    os.umask(0o077)
    verify_path(root)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    verify_path(root, True)
    for name in ["auth", "exports"]:
        p = root / name
        verify_path(p)
        p.mkdir(mode=0o700, exist_ok=True)
        verify_path(p, True)
    return root


@contextlib.contextmanager
def process_lock(root):
    p = verify_path(root / "process.lock", True)
    fd = os.open(p, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def atomic_json(path, value):
    path = verify_path(path, True)
    verify_path(path.parent, True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".write-")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(value, f, sort_keys=True, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
