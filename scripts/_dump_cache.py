p = r"C:\Users\marki\llm-guardian\src\core\response-cache.ts"
out = r"C:\Users\marki\llm-guardian\scripts\_diag_out.txt"
lines = open(p, encoding="utf-8").read().split("\n")
with open(out, "w", encoding="utf-8") as f:
    f.write(f"total lines: {len(lines)}\n")
    for i in range(len(lines)):
        f.write(f"{i+1}|{lines[i]}\n")
