import math, cairosvg
FONT = "Arial"
W, H = 1160, 1380
out = []
def add(s): out.append(s)

def text(x, y, s, size=15, anchor="middle", weight="normal", bg=False):
    lines = s.split("\n")
    lh = size * 1.2
    y0 = y - (len(lines) - 1) * lh / 2
    if bg:
        wmax = max(len(l) for l in lines) * size * 0.55
        add(f'<rect x="{x-wmax/2-3}" y="{y0-size*0.85}" width="{wmax+6}" height="{lh*len(lines)}" fill="white"/>')
    for i, l in enumerate(lines):
        add(f'<text x="{x}" y="{y0+i*lh+size*0.35}" font-family="{FONT}" font-size="{size}" '
            f'text-anchor="{anchor}" font-weight="{weight}">{l}</text>')

shapes = {}
def usecase(key, x, y, label, ext=None, rx=None):
    lines = label.split("\n")
    w = rx or max(100, max(len(l) for l in lines) * 4.9 + 30)
    if ext:
        ry = 46
        add(f'<ellipse cx="{x}" cy="{y}" rx="{w}" ry="{ry}" fill="white" stroke="black" stroke-width="1.5"/>')
        dy = -6
        half = w * math.sqrt(1 - (dy/ry)**2)
        add(f'<line x1="{x-half}" y1="{y+dy}" x2="{x+half}" y2="{y+dy}" stroke="black" stroke-width="1"/>')
        text(x, y - 21, label, 17)
        text(x, y + 8, "extension points", 14)
        text(x, y + 26, ext, 14)
    else:
        ry = 24 if len(lines) == 1 else 33
        add(f'<ellipse cx="{x}" cy="{y}" rx="{w}" ry="{ry}" fill="white" stroke="black" stroke-width="1.5"/>')
        text(x, y, label, 17)
    shapes[key] = ("e", x, y, w, ry)

def actor(key, x, y, label):
    # stick figure, (x,y) = centre of body
    add(f'<circle cx="{x}" cy="{y-30}" r="11" fill="white" stroke="black" stroke-width="1.5"/>')
    add(f'<line x1="{x}" y1="{y-19}" x2="{x}" y2="{y+12}" stroke="black" stroke-width="1.5"/>')
    add(f'<line x1="{x-18}" y1="{y-8}" x2="{x+18}" y2="{y-8}" stroke="black" stroke-width="1.5"/>')
    add(f'<line x1="{x}" y1="{y+12}" x2="{x-15}" y2="{y+34}" stroke="black" stroke-width="1.5"/>')
    add(f'<line x1="{x}" y1="{y+12}" x2="{x+15}" y2="{y+34}" stroke="black" stroke-width="1.5"/>')
    text(x, y + 56, label, 17)
    shapes[key] = ("a", x, y, 22, 42)

def actor_box(key, x, y, label):
    w, h = 100, 52
    add(f'<rect x="{x-w/2}" y="{y-h/2}" width="{w}" height="{h}" fill="white" stroke="black" stroke-width="1.5"/>')
    text(x, y - 10, "«actor»", 15)
    text(x, y + 12, label, 17)
    shapes[key] = ("r", x, y, w/2, h/2)

def edge_point(key, tx, ty):
    kind, x, y, a, b = shapes[key]
    dx, dy = tx - x, ty - y
    if kind == "e":
        t = 1 / math.sqrt((dx/a)**2 + (dy/b)**2)
        return x + dx*t, y + dy*t
    if kind == "a":
        t = 1 / max(abs(dx)/a, abs(dy)/b)
        return x + dx*t, y + dy*t
    t = 1 / max(abs(dx)/a, abs(dy)/b)
    return x + dx*t, y + dy*t

def centre(key): return shapes[key][1], shapes[key][2]

def assoc(a, b):
    ax, ay = centre(a); bx, by = centre(b)
    p = edge_point(a, bx, by); q = edge_point(b, ax, ay)
    add(f'<line x1="{p[0]:.1f}" y1="{p[1]:.1f}" x2="{q[0]:.1f}" y2="{q[1]:.1f}" stroke="black" stroke-width="1.4"/>')

def open_head(px, py, ux, uy, size=13):
    nx, ny = -uy, ux
    x1, y1 = px - ux*size + nx*size*0.5, py - uy*size + ny*size*0.5
    x2, y2 = px - ux*size - nx*size*0.5, py - uy*size - ny*size*0.5
    add(f'<polyline points="{x1:.1f},{y1:.1f} {px:.1f},{py:.1f} {x2:.1f},{y2:.1f}" fill="none" stroke="black" stroke-width="1.4"/>')

def dep(a, b, label, lx=0, ly=0):
    ax, ay = centre(a); bx, by = centre(b)
    p = edge_point(a, bx, by); q = edge_point(b, ax, ay)
    add(f'<line x1="{p[0]:.1f}" y1="{p[1]:.1f}" x2="{q[0]:.1f}" y2="{q[1]:.1f}" stroke="black" stroke-width="1.4" stroke-dasharray="7,5"/>')
    d = math.hypot(q[0]-p[0], q[1]-p[1]); ux, uy = (q[0]-p[0])/d, (q[1]-p[1])/d
    open_head(q[0], q[1], ux, uy)
    text((p[0]+q[0])/2 + lx, (p[1]+q[1])/2 + ly, label, 15, bg=True)

def gen(child, parent):
    cx, cy = centre(child); px, py = centre(parent)
    p = edge_point(child, px, py); q = edge_point(parent, cx, cy)
    d = math.hypot(q[0]-p[0], q[1]-p[1]); ux, uy = (q[0]-p[0])/d, (q[1]-p[1])/d
    s = 16; bx, by = q[0]-ux*s, q[1]-uy*s
    add(f'<line x1="{p[0]:.1f}" y1="{p[1]:.1f}" x2="{bx:.1f}" y2="{by:.1f}" stroke="black" stroke-width="1.4"/>')
    nx, ny = -uy, ux
    add(f'<polygon points="{q[0]:.1f},{q[1]:.1f} {bx+nx*9:.1f},{by+ny*9:.1f} {bx-nx*9:.1f},{by-ny*9:.1f}" fill="white" stroke="black" stroke-width="1.4"/>')

# ---------------- layout ----------------
A, B = 425, 790
add(f'<rect x="235" y="15" width="760" height="1350" fill="white" stroke="black" stroke-width="1.6"/>')
text(615, 38, "CampusFix", 19, weight="bold")
usecase("track", A, 95, "Track Complaint Status")
usecase("confirm", A, 215, "Confirm Resolution", ext="fix rejected", rx=135)
usecase("rate", B, 165, "Rate Service")
usecase("reopen", B, 275, "Reopen Complaint")
usecase("raise", A, 370, "Raise Complaint", ext="photo available", rx=135)
usecase("photo", B, 385, "Attach Photo")
usecase("notify", B, 520, "Send Notification")
usecase("update", A, 600, "Update Work Status")
usecase("resolved", A, 700, "Mark Complaint\nResolved")
usecase("assign", A, 840, "Assign Complaint\nto Staff")
usecase("review", A, 945, "Review and Prioritise\nComplaint")
usecase("overdue", B, 650, "Escalate Overdue\nComplaint")
usecase("autoclose", B, 760, "Auto-close Unconfirmed\nComplaint")
usecase("manage", B, 880, "Manage Categories,\nLocations and Users")
usecase("config", B, 985, "Configure Priority\nDeadlines")
usecase("dash", B, 1090, "View Performance\nDashboard")
usecase("service", B, 1185, "Handle Service\nComplaint")
usecase("escalated", B, 1305, "Handle Escalated\nComplaint")

actor("student", 50, 120, "Student")
actor("faculty", 50, 350, "Faculty")
actor("cu", 160, 225, "Campus User")
actor("staff", 120, 650, "Maintenance\nStaff")
actor("sup", 120, 890, "Maintenance\nSupervisor")
actor("admin", 1095, 1050, "Administrator")
actor_box("timer", 1095, 705, "Timer")

gen("student", "cu"); gen("faculty", "cu")
for u in ("track", "confirm", "raise"): assoc("cu", u)
for u in ("update", "resolved"): assoc("staff", u)
for u in ("review", "assign", "escalated"): assoc("sup", u)
for u in ("manage", "config", "dash", "service", "escalated"): assoc("admin", u)
for u in ("overdue", "autoclose"): assoc("timer", u)

dep("confirm", "rate", "«include»", 0, -14)
dep("reopen", "confirm", "«extend»", 0, 16)
dep("photo", "raise", "«extend»", 0, -14)
dep("raise", "notify", "«include»", -50, 0)
dep("resolved", "notify", "«include»", 10, 18)
dep("assign", "notify", "«include»", 45, 0)
dep("overdue", "notify", "«include»", 50, 0)

svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><rect width="100%" height="100%" fill="white"/>' + "".join(out) + "</svg>"
open("usecase.svg", "w").write(svg)
cairosvg.svg2png(bytestring=svg.encode(), write_to="usecase.png", output_width=W*2)
print("done")
