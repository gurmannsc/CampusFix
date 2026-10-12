# Deviations from the submitted design

Record here any place where the code differs from the report, with a one-line reason.
Keep this short; examiners may ask about it.

| Date | Area | Design says | Code does | Reason |
|---|---|---|---|---|
| 2026-10-12 | Seed accounts / login | Demo script lists logins as `student1`, `supervisor1`, ... | Login is by email: `student1@nmims.edu` etc. (password `demo123`) | `User.login(email, password)` and the `email` attribute in the class diagram. |
| 2026-10-12 | Seed accounts | Demo script lists electrician1, plumber1, carpenter1 as staff | Also seeds hvac1, hvac2, hvac3 (unavailable), itsupport1, civil1, housekeeper1 | Demo step 1 is an HVAC complaint and step 2 needs eligible HVAC staff plus one unavailable. |
