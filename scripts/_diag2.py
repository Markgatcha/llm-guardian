import sys
sys.path.insert(0, r"C:\Users\marki\AppData\Local\hermes\scripts")
# read files directly with python to avoid the flaky read_file tool

def show(path, a, b, label):
    print(f"===== {label} ({path}:{a}-{b}) =====")
    with open(path, encoding="utf-8") as f:
        lines = f.readlines()
    for i in range(a - 1, min(b, len(lines))):
        print(f"{i+1}|{lines[i]}", end="")
    print()

base = r"C:\Users\marki\llm-guardian"
show(base + r"\src\core\types.ts", 205, 246, "types.ts interfaces")
show(base + r"\src\core\orchestrator.ts", 1, 60, "orchestrator imports")
show(base + r"\src\core\orchestrator.ts", 355, 400, "orchestrator 355-400")

# grep usages
import subprocess
for pat in ["deriveProvider", "providerFromModel", "extractProvider", "modelProvider"]:
    print(f"===== grep {pat} =====")
    r = subprocess.run(["grep", "-rn", pat, base + r"\src", base + r"\scripts"],
                       capture_output=True, text=True, shell=False)
    # grep.exe may not exist on git-bash PATH from python; fallback
    if r.returncode != 0 and not r.stdout:
        import os
        for root, _dirs, files in os.walk(base + r"\src"):
            for fn in files:
                if fn.endswith(".ts"):
                    p = os.path.join(root, fn)
                    try:
                        with open(p, encoding="utf-8") as f:
                            for n, ln in enumerate(f, 1):
                                if pat in ln:
                                    print(f"{p}:{n}: {ln.rstrip()}")
                    except Exception:
                        pass
    else:
        print(r.stdout)

with open(base + r"\scripts\test-cache.ts", encoding="utf-8") as f:
    print("===== scripts/test-cache.ts =====")
    print(f.read())
