p = r"C:\Users\marki\llm-guardian\src\core\response-cache.ts"
out = r"C:\Users\marki\llm-guardian\scripts\_diag_out.txt"
src = open(p, encoding="utf-8").read()
lines = src.split("\n")
with open(out, "w", encoding="utf-8") as f:
    f.write(f"total lines: {len(lines)}\n")
    # print the regions tsc flagged: 45-60, 65-80, 175-225, 255-261
    for lo, hi in [(40, 80), (170, 230), (250, len(lines))]:
        f.write(f"\n===== {lo}-{hi} =====\n")
        for i in range(lo, min(len(lines), hi)):
            f.write(f"{i + 1}| {lines[i]!r}\n")
