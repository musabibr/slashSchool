# Slash School — Sketch Breakdown

What the Excalidraw wireframes describe, screen by screen. This is the product input for
[`mvp-architecture.md`](./mvp-architecture.md).

> Source: the team's Excalidraw room (54 frames, Feb 2025). The room link is not stored in
> this repo because it carries the scene's decryption key.

## The product in one paragraph

A school-to-home platform for private schools in Sudan (Arabic, RTL, SDG currency,
Khartoum-area addresses). Staff record the school day: lessons, homework, absence, exams,
grades, behavior and fees. Guardians follow each of their children on their phone. There are
four roles across two surfaces:

| Role | Arabic | Surface | Sketch section |
|---|---|---|---|
| Guardian / Student | ولي الأمر / الطالب | Mobile app | `Student/Parent` (17 screens) |
| Supervisor | المشرف | Mobile app | `Supervisor` (18 screens) |
| Teacher | الأستاذ | Mobile app | `الاستاذ` (11 screens) |
| Director / Admin | المدير | Web dashboard (sidebar layout) | `المدير` (6 screens) |

All mobile screens share the same header: the back button (`الرجوع`), the name of the person or
student, the school name, and the screen title in red. The login screen is the same for every
role: the logo ("قوم أقرا"), a single field labelled **"أدخل الرمز"** ("enter the code",
placeholder `#SCHOOL_A_001`) and an **Enter** button.

---

## 1. Guardian / Student app

| # | Screen | What it shows / does |
|---|---|---|
| P1 | Login | Code field + Enter. |
| P2 | Choose student (`Choose Student`) | The guardian's children, **grouped by school** (e.g., two children at "أولاد عمار المتوسطة", one at "أولاد عمار الثانوية"). A **"+"** button links another child. |
| P3 | Menu | Student name + school, then 9 tiles with **red unread badges**: Lessons `الدروس`, Homework `الواجبات`, Absence `الغياب`, Fees `الرسوم الدراسية`, Exams `الإمتحانات`, Results `النتائج`, Behavior & Discipline `السلوك والإنضباط`, Academic Calendar `التقويم الدراسي`, Announcements `الإعلانات`. |
| P4 | Lessons → subjects | A grid of the class's subjects (Arabic, Math, Chemistry, Physics, Quran, ملبسنا, مسكننا…), each with its own unread badge. |
| P5 | Lessons → one subject | Filter: Today / This week / This month / All. Each lesson card shows the title, date, pages ("الصفحة: 15 - 50"), details, and a **Homework** button that is disabled when the lesson has no homework. |
| P6 | Homework → subjects | Same subject grid as P4. |
| P7 | Homework → one subject | Same filters. Each card shows the title, date, homework details and a **"تم" (done)** checkbox. Cards are red while pending and green once done. |
| P8 | Absence | Absences this month (3), total absences (15), and a list of absent days (weekday + date). |
| P9 | Fees | Total (600,000), paid, remaining, then each installment with its amount, amount paid, arrears and status (paid / late / not yet due). |
| P10 | Exams | Two entries: **Quiz announcements** `إعلانات الإختبارات` and **Exam timetable** `جدول الإمتحانات` (currently a photo of a printed timetable). |
| P11 | Quiz announcements | Subject, date and details ("سورة النور 1–50"). Once graded, it also shows the score ("15 من 30"). |
| P12 | Results list | Result sheets: a math quiz, monthly exams, and term 1 / term 2 exams. |
| P13 | Result sheet | A table of subject, score and max score, then the total (140 / 230), the percentage and the grade (`جيد`). |
| P14 | Behavior & Discipline | Number of violations, number of penalties, then incidents (date, regulation `اللائحة`, details). |
| P15 | Academic calendar | A month view with event dots and an event list (holiday / event). This is a reference image, not a drawn design. |
| P16 | Announcements | Targeted messages: to this guardian ("please come to school…"), to one grade ("Grade 5 students…"), or to everyone. |
| P17 | Transport `الترحيل` | Driver name and phone, plus transport notices. **No menu tile links to it.** |

## 2. Supervisor app

| # | Screen | What it shows / does |
|---|---|---|
| S1 | Login | Same as P1. |
| S2 | Choose school | A list of schools. This frame has red scribbles drawn over it, so it may have been cut. |
| S3 | Menu | 7 tiles: Today's lesson `درس اليوم`, Absence, Exams, Grades `الدرجات`, Behavior, Timetables `الجداول الدراسية`, Student evaluation `تقييم الطلاب`. |
| S4 | Today's lesson hub | Add new lesson / Previous lessons. |
| S5 | Add lesson | Class, subject, lesson title, lesson details, homework yes/no, homework details, add media, then **Add**. |
| S6 | Previous lessons | Optional filters for class and subject, newest first. Each card shows the class, subject, title and date. |
| S7 | Edit lesson | Same fields as S5, with **Edit** and **Delete**. |
| S8 | Absence hub | Add absence / Edit a previous absence. |
| S9 | Record absence | Pick a class, tick the absent students, then **Record absence**. |
| S10 | Edit absence | Class + date, the list of students marked absent, then **Update**. |
| S11 | Exams hub | Add/edit exam timetable / Add quiz announcement. |
| S12 | Exam timetable builder | Class, exam type (monthly, term, weekly, final), a date picker for each subject, then **Add/Update**. |
| S13 | Quiz announcement | Class, subject, details, date, then **Add**. |
| S14 | Grades | Subject + class, a list of students with a score field each, then **Add** / **Edit**. |
| S15 | Behavior | Regulation, class, student, note, penalty, then **Send**. |
| S16 | Timetable builder | Class, teacher and weekday, then rows of period + subject (delete / add, "+"), then **Send**. |
| S17 | Student evaluation | Subject + class. For each student, a rating dropdown (`هادئ` calm / `مشاغب` disruptive) and "add comment", then **Send**. |

## 3. Teacher app

The teacher app is a subset of the supervisor app, limited to the teacher's own classes.

| # | Screen | Notes |
|---|---|---|
| T1 | Login | Same as P1. There is no school chooser. |
| T2 | Menu | 5 tiles: Today's lesson, Grades, Timetables, Student evaluation, Exams `الاختبارات`. |
| T3–T6 | Today's lesson hub / add / previous / edit | Same as S4–S7. The **add** form has "attachments" but no title and no details fields. |
| T7 | Grades | Same as S14. |
| T8 | My timetable `جدول الحصص` | Pick a day to see rows of class, period and subject. |
| T9 | Student evaluation | Same as S17. |

## 4. Director web dashboard

The sidebar has: Home, Students, Supervisors, Teachers, Guardians, Calendar, Classes, Timetables,
School regulations `اللوائح المدرسية`, and Record absence.

| # | Screen | What it shows / does |
|---|---|---|
| D1 | Home | Counters (3,523 students · 6 supervisors · 18 teachers · 2,102 guardians), a gender split (60% F / 40% M), a statistics panel and event cards. |
| D2 | Students | A "Register new student" button, a class filter and search, then a table of code (`S-25`), name, class (`الخامس - ب`) and registration date. |
| D3 | Admission & registration `القبول والتسجيل` | Student name (4 parts), guardian name (4 parts), mother name (3 parts), guardian and mother phone and WhatsApp numbers, relation, guardian occupation, workplace, locality, residence, stage (`روضة`…) and level. Required fields are starred. |
| D4 | Student page | The student row, plus actions: send fee notice, message the guardian, record a behavior violation, attendance, results, and **expel student** (red). |
| D5 | Teachers | A copy of the Students page (placeholder). |

The other sidebar pages (Supervisors, Guardians, Calendar, Classes, Timetables, Regulations,
Record absence) are **not drawn**.

---

## 5. Inconsistencies spotted in the sketch

These don't block anything, but each one points to a rule the system needs.

1. **The fee numbers don't add up.** The tiles say total 600,000, paid 300,000, remaining
   200,000. The installments show 300,000 + 100,000 = 400,000 paid. → All derived amounts are
   computed by the server, never typed in.
2. **The result percentage is wrong.** 140 / 230 = 60.9%, but the sheet says 55%. → The
   percentage and the grade are computed from configurable grade bands.
3. **The homework subject screen is titled "الدروس"** (Lessons) instead of "الواجبات".
4. **The lesson forms don't match.** The teacher form has no title or details. The supervisor
   form has no pages field. The guardian view shows title, pages and details. → Use one lesson
   form for both: class, subject, title, pages (optional), details, homework toggle + details,
   attachments.
5. **Grade entry doesn't say which assessment** the scores are for (quiz, monthly, term…). → Add
   an assessment picker.
6. **The transport screen is drawn but not linked** from the guardian menu.
7. **The admission form has no gender** (yet the dashboard shows a gender split), no date of
   birth and no class/section.
8. **The supervisor "Choose school" screen is scribbled over.** → Show it only when a user
   belongs to more than one school.
9. **A stray "Edit previous absence" button** sits inside the teacher section. → It's unclear
   whether teachers record absence. Assumed: supervisors only, for now.
10. **The subject grid lists primary-level subjects** (ملبسنا، مسكننا) for a secondary student.
    → Subjects must come from the student's grade level, not a fixed list.
11. **The teacher timetable has a "Send" button** even though it reads as view-only.
12. **The calendar and exam timetable are reference images,** not designs.
13. Typos: "Choose Stuednt", "عدد القوبات" → العقوبات, "تقيم" → تقييم, "اصافة" → إضافة,
    "هادئي" → هادئ.

## 6. Open questions for the product owner

1. **What is `#SCHOOL_A_001` on the login screen?** The architecture assumes a **per-person
   activation code** issued by the school. The alternative is a school code followed by
   credentials.
2. Do **students log in themselves**, or only guardians? The homework "done" checkbox suggests
   students use the app.
3. Should **teachers** record absence and behavior, or only supervisors?
4. Is the **student evaluation** (calm/disruptive + comment) visible to guardians? It isn't in
   their menu.
5. **Fees:** is manual payment recording enough, or is mobile payment (e.g., Bankak) expected?
   Are there sibling discounts?
6. What are the school's **grade bands** (ممتاز / جيد جداً / جيد / مقبول) thresholds?
7. Is this **one school or many** (SaaS)? The architecture assumes many, with "أولاد عمار" as
   the pilot.
8. Who can **send announcements**: the director only, or supervisors too?
9. What is a **supervisor's scope**: the whole school, or specific stages? 6 supervisors for
   3,523 students suggests one per stage.
10. **Exam timetables:** build them in the app (assumed), or keep uploading a photo or PDF?
11. Which day does the **school week** start on, for the "this week" filter?
