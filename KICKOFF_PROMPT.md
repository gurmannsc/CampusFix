Paste this as your first message in Claude Code, from inside the campusfix folder:

---
Read CLAUDE.md, then every file in docs/, and look at diagrams/ (the .svg files are the rendered
UML). Skim report/CampusFix_SE_Project_Report.pdf for context.

Then, before writing any code:
1. Summarise in about 10 lines what you will build and how it maps to the diagrams.
2. List anything in docs/ that is ambiguous or contradictory, and ask me about it.
3. Check my machine: Node version, npm, and whether MySQL 8 is installed and running. If MySQL is
   missing, tell me how to install it for my OS and wait.

After I answer, start milestone M0 from docs/08-build-plan.md. Stop at the end of each milestone,
show me what you did and the test results, and wait for my go-ahead before the next one. 
---
