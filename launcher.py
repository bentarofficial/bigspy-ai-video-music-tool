"""AI Music Video.exe: cai thu vien neu can roi khoi dong server an va mo trinh duyet."""
import subprocess
import sys
from pathlib import Path

root = Path(sys.executable if getattr(sys, "frozen", False) else __file__).resolve().parent
ps = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]
if subprocess.call(ps + [str(root / "scripts" / "setup.ps1")], cwd=root) == 0:
    subprocess.call(ps + [str(root / "scripts" / "start.ps1")], cwd=root)
