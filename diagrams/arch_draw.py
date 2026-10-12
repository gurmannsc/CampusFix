import cairosvg
F="Arial"; o=[]
W,H=1500,1010
def add(s):o.append(s)
def t(x,y,s,sz=19,w="normal",a="middle"):
    ls=s.split("\n"); lh=sz*1.25; y0=y-(len(ls)-1)*lh/2
    for i,l in enumerate(ls): add(f'<text x="{x}" y="{y0+i*lh+sz*0.35}" font-family="{F}" font-size="{sz}" font-weight="{w}" text-anchor="{a}">{l}</text>')
def box(x,y,w,h,label,sz=18,fill="white",sw=1.5,rx=6):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="black" stroke-width="{sw}"/>'); t(x+w/2,y+h/2,label,sz)
def layer(y,h,title,sub):
    add(f'<rect x="20" y="{y}" width="1460" height="{h}" fill="#f2f2f2" stroke="black" stroke-width="2"/>')
    t(40,y+24,title,21,"bold","start"); t(40,y+50,sub,16,"normal","start")
def arrow2(x,y1,y2,label):
    add(f'<line x1="{x}" y1="{y1+12}" x2="{x}" y2="{y2-12}" stroke="black" stroke-width="2"/>')
    for (yy,d) in ((y1,1),(y2,-1)):
        add(f'<polygon points="{x},{yy} {x-8},{yy+14*d} {x+8},{yy+14*d}" fill="black"/>')
    t(x+14,(y1+y2)/2,label,16,"normal","start")
# Presentation
layer(20,230,"Presentation Layer (client)","React web application in the browser, mobile-friendly")
xs=[60,410,760,1110]; names=["Campus User Portal\n(Student / Faculty)","Maintenance Staff\nPortal","Supervisor\nConsole","Administrator\nDashboard"]
for x,n in zip(xs,names): box(x,100,330,110,n)
arrow2(750,250,330,"HTTPS requests / JSON responses (REST API)")
# Application
layer(330,400,"Application Layer (server)","Node.js + Express REST API")
box(60,410,1380,56,"Authentication and Role-Based Access Middleware",18)
svc=["Complaint\nService","Assignment\nService","Resolution\nService","Escalation\nScheduler","Notification\nService","Report\nService"]
for i,n in enumerate(svc): box(60+i*232,495,212,110,n,17)
t(750,665,"Business rules: priority deadlines, status transitions, 48-hour auto-close, escalation levels",16)
arrow2(750,730,810,"SQL queries")
# Data
layer(810,180,"Data Layer","Central data store (data-centered repository)")
box(300,880,420,90,"MySQL Database\n(users, complaints, categories, locations,\nrules, updates, feedback, escalations)",15)
box(780,880,420,90,"File Storage\n(complaint photos)",17)
svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}"><rect width="100%" height="100%" fill="white"/>'+"".join(o)+"</svg>"
open("arch.svg","w").write(svg)
