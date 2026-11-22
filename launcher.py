"""AI Music Video.exe: cai thu vien neu can (co cua so console), roi chay server an va mo cua so ung dung."""
import subprocess
import sys
from pathlib import Path

root = Path(sys.executable if getattr(sys, "frozen", False) else __file__).resolve().parent
ps = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]
# Exe build --noconsole: setup can console de hien tien do / loi, start thi chay an hoan toan.
if subprocess.call(ps + [str(root / "scripts" / "setup.ps1")], cwd=root,
                   creationflags=subprocess.CREATE_NEW_CONSOLE) == 0:
    subprocess.call(ps + [str(root / "scripts" / "start.ps1")], cwd=root,
                    creationflags=subprocess.CREATE_NO_WINDOW)
