import math, cairosvg
FONT="Arial"; FS=18
W,H=1640,770
o=[]
def add(s): o.append(s)
def text(x,y,s,size=FS,anchor="middle",weight="normal",bg=True):
    lines=s.split("\n"); lh=size*1.25
    y0=y-(len(lines)-1)*lh/2
    if bg:
        wmax=max(len(l) for l in lines)*size*0.53
        bx={"middle":x-wmax/2,"start":x,"end":x-wmax}[anchor]
        add(f'<rect x="{bx-3}" y="{y0-size*0.9}" width="{wmax+6}" height="{lh*len(lines)+2}" fill="white"/>')
    for i,l in enumerate(lines):
        add(f'<text x="{x}" y="{y0+i*lh+size*0.35}" font-family="{FONT}" font-size="{size}" text-anchor="{anchor}" font-weight="{weight}">{l}</text>')
S={}
def state(k,x,y,label,w=None):
    w=w or len(label)*FS*0.55+36; h=46
    add(f'<rect x="{x-w/2}" y="{y-h/2}" width="{w}" height="{h}" rx="16" fill="white" stroke="black" stroke-width="1.6"/>')
    text(x,y,label,bg=False)
    S[k]=(x,y,w/2,h/2)
def L(k,side,off=0):
    x,y,a,b=S[k]
    return {"l":(x-a,y+off),"r":(x+a,y+off),"t":(x+off,y-b),"b":(x+off,y+b)}[side]
def head(px,py,ux,uy,s=13):
    nx,ny=-uy,ux
    add(f'<polyline points="{px-ux*s+nx*s*.5:.1f},{py-uy*s+ny*s*.5:.1f} {px:.1f},{py:.1f} {px-ux*s-nx*s*.5:.1f},{py-uy*s-ny*s*.5:.1f}" fill="none" stroke="black" stroke-width="1.5"/>')
def path(pts):
    add('<polyline points="'+" ".join(f"{x:.1f},{y:.1f}" for x,y in pts)+'" fill="none" stroke="black" stroke-width="1.5"/>')
    (x1,y1),(x2,y2)=pts[-2],pts[-1]; d=math.hypot(x2-x1,y2-y1)
    head(x2,y2,(x2-x1)/d,(y2-y1)/d)

# frame
add('<rect x="10" y="10" width="1620" height="750" fill="white" stroke="black" stroke-width="1.8"/>')
add('<polygon points="10,10 140,10 140,30 128,42 10,42" fill="white" stroke="black" stroke-width="1.5"/>')
text(72,26,"Complaint",17,weight="bold",bg=False)

# composite state Open
cx1,cy1,cx2,cy2=150,175,1010,600
add(f'<rect x="{cx1}" y="{cy1}" width="{cx2-cx1}" height="{cy2-cy1}" rx="22" fill="white" stroke="black" stroke-width="1.6"/>')
add(f'<line x1="{cx1}" y1="{cy1+34}" x2="{cx2}" y2="{cy1+34}" stroke="black" stroke-width="1.2"/>')
text((cx1+cx2)/2,cy1+17,"Open",17,weight="bold",bg=False)

state("sub",300,290,"Submitted")
state("asg",590,290,"Assigned")
state("inp",830,290,"In Progress")
state("hold",830,490,"On Hold")
state("reo",590,490,"Reopened")
state("esc",590,95,"Escalated")
state("res",1280,290,"Resolved")
state("clo",1545,290,"Closed")
state("inv",300,720,"Invalid")

def initial(x,y): add(f'<circle cx="{x}" cy="{y}" r="11" fill="black"/>')
def final(x,y):
    add(f'<circle cx="{x}" cy="{y}" r="15" fill="white" stroke="black" stroke-width="1.6"/>')
    add(f'<circle cx="{x}" cy="{y}" r="9" fill="black"/>')

initial(300,95)
path([(300,106),L("sub","t")]); text(288,140,"/ calculateDueAt()",anchor="end")
# Open -> Escalated (from composite boundary)
path([(555,cy1),(555,95+23)]); text(545,150,"when(now > dueAt) /\nnotifySupervisor()",anchor="end")
# Escalated -> Assigned
path([(625,95+23),(625,290-23)]); text(637,150,"resolveEscalation() /\nupdateDueAt()",anchor="start")
# self loop on Escalated
ex=S["esc"][0]+S["esc"][2]
add(f'<path d="M {ex} 84 C {ex+55} 70, {ex+55} 120, {ex+4} 106" fill="none" stroke="black" stroke-width="1.5"/>')
head(ex,105,-0.95,-0.3)
text(ex+62,95,"after(24 hours) /\nnotifyAdministrator()",anchor="start")
# inside Open
path([L("sub","r"),L("asg","l")]); text(445,252,"assign(staff) /\nnotifyAssignee()")
path([L("asg","r"),L("inp","l")]); text(703,258,"startWork()")
path([L("inp","b",-22),L("hold","t",-22)]); text(800,390,"partsNeeded()",anchor="end")
path([L("hold","t",22),L("inp","b",22)]); text(862,390,"partsReceived()",anchor="start")
path([L("reo","t"),L("asg","b")]); text(578,390,"assign(staff) /\nnotifyAssignee()",anchor="end")
# In Progress -> Resolved (crosses boundary)
path([L("inp","r"),L("res","l")]); text(1145,240,"markResolved(remarks) /\nrequestConfirmation()")
# Resolved -> Closed (two transitions)
r=S["res"]; c=S["clo"]
path([(r[0]+r[2],280),(c[0]-c[2],280)]); text(1418,240,"confirm(rating) /\nrecordFeedback()")
path([(r[0]+r[2],302),(c[0]-c[2],302)]); text(1418,342,"after(48 hours) /\nautoClose()")
# Closed -> final
path([L("clo","b"),(1545,420-15)]); final(1545,420)
# Resolved -> Reopened
path([L("res","b"),(1280,560),(590,560),L("reo","b")]); text(1292,440,"rejectFix(reason) /\nnotifySupervisor()",anchor="start")
# Submitted -> Invalid
path([L("sub","b"),L("inv","t")]); text(312,650,"markInvalid(reason)\n[invalid or duplicate] /\nnotifyReporter()",anchor="start")
# Invalid -> final
path([L("inv","r"),(500-15,720)]); final(500,720)

svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><rect width="100%" height="100%" fill="white"/>'+"".join(o)+"</svg>"
open("state.svg","w").write(svg)
cairosvg.svg2png(bytestring=svg.encode(),write_to="state.png",output_width=W*2)
