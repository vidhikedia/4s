// Creates all tables from schema.sql / schema.pg.sql and loads sample campus data.
// Run with: npm run seed   (this RESETS the database)
const fs = require('fs');
const path = require('path');
const { db, hashPassword, runMigrations } = require('./db');

const pass = hashPassword('password123');

const students = [
  [
    'Vidhi Kedia', 'kediavidhi62@gmail.com', 'Computer Science & Engineering', '3rd Year',
    'CS student passionate about Full-Stack Web Development, Data Structures, and Database Design. Love teaching frontend basics and excited to learn Machine Learning & Cloud Architectures.',
    'A', '101', 'VK', '+91 98765 43210',
    'https://github.com/kediavidhi', 'https://linkedin.com/in/vidhi-kedia', 'https://vidhikedia.dev',
    'Full-Stack Web Development, Data Structures, Database Design, System Architecture', 'English, Hindi, Gujarati'
  ],
  [
    'Aarav Sharma', 'aarav@campus.edu', 'Computer Science', '2nd Year',
    'Learning React and teaching C fundamentals to first-year peers.',
    'A', '101', 'AS', '+91 98765 43211',
    'https://github.com/aaravsharma', 'https://linkedin.com/in/aarav-sharma', '',
    'C Programming, React, Algorithms', 'English, Hindi'
  ],
  [
    'Diya Patel', 'diya@campus.edu', 'Data Science & AI', '3rd Year',
    'Python mentor who wants to learn video editing for project demos.',
    'A', '204', 'DP', '+91 98765 43212',
    'https://github.com/diyapatel', 'https://linkedin.com/in/diya-patel', '',
    'Python, Machine Learning, Data Analytics', 'English, Hindi, Gujarati'
  ],
  [
    'Rohan Mehta', 'rohan@campus.edu', 'Applied Arts', '3rd Year',
    'Video and graphic design mentor exploring frontend development.',
    'B', '112', 'RM', '+91 98765 43213',
    'https://github.com/rohanmehta', 'https://linkedin.com/in/rohan-mehta', 'https://rohanmehta.design',
    'Video Editing, Graphic Design, Motion Graphics', 'English, Hindi'
  ],
  [
    'Sneha Iyer', 'sneha@campus.edu', 'Information Technology', '2nd Year',
    'Python scripting mentor who wants stronger SQL skills.',
    'B', '305', 'SI', '+91 98765 43214',
    'https://github.com/snehaiyer', 'https://linkedin.com/in/sneha-iyer', '',
    'Database Systems, Python, SQL', 'English, Tamil, Hindi'
  ],
  [
    'Kabir Singh', 'kabir@campus.edu', 'Architecture', '2nd Year',
    'Photography enthusiast learning public speaking for reviews.',
    'C', '210', 'KS', '+91 98765 43215',
    'https://github.com/kabirsingh', 'https://linkedin.com/in/kabir-singh', '',
    'Photography, 3D Modeling, Design', 'English, Hindi, Punjabi'
  ],
  [
    'Rashi Chandani', 'rashi@campus.edu', 'Data Science & AI', '3rd Year',
    'Machine learning mentor looking to improve React component skills.',
    'A', '310', 'RC', '+91 98765 43216',
    'https://github.com/rashichandani', 'https://linkedin.com/in/rashi-chandani', 'https://rashi.ai',
    'Machine Learning, Scikit-Learn, Deep Learning, UI Prototyping', 'English, Hindi'
  ],
  [
    'Riya Sharma', 'riya@campus.edu', 'Computer Science', '4th Year',
    'Docker and cloud mentor who wants help with SQL optimization.',
    'B', '118', 'RS', '+91 98765 43217',
    'https://github.com/riyasharma', 'https://linkedin.com/in/riya-sharma', '',
    'Cloud Computing, Docker, DevOps, Linux', 'English, Hindi'
  ],
  [
    'Devansh Parekh', 'devansh@campus.edu', 'Computer Science', '4th Year',
    'Systems programming in C. Wants to learn Figma prototyping.',
    'C', '102', 'DP', '+91 98765 43218',
    'https://github.com/devanshparekh', 'https://linkedin.com/in/devansh-parekh', '',
    'Systems Programming, Operating Systems, C, Valgrind', 'English, Hindi'
  ],
  [
    'Kavita Joshi', 'kavita@campus.edu', 'Business Administration', '3rd Year',
    'Debate finalist coaching technical public speaking.',
    'A', '220', 'KJ', '+91 98765 43219',
    '', 'https://linkedin.com/in/kavita-joshi', '',
    'Public Speaking, Debate, Pitching, Business Strategy', 'English, Hindi, Marathi'
  ],
  [
    'Tanya Kapoor', 'tanya@campus.edu', 'Design & Media', '3rd Year',
    'Figma design systems mentor who wants to learn Tailwind.',
    'B', '401', 'TK', '+91 98765 43220',
    '', 'https://linkedin.com/in/tanya-kapoor', 'https://tanyakapoor.portfolio',
    'Figma, Design Systems, Typography, Auto-Layout', 'English, Hindi'
  ],
  [
    'Ananya Iyer', 'ananya@campus.edu', 'Data Science & AI', '3rd Year',
    'Pandas and SQL mentor exploring React dashboards.',
    'C', '215', 'AI', '+91 98765 43221',
    'https://github.com/ananyaiyer', 'https://linkedin.com/in/ananya-iyer', '',
    'Pandas, NumPy, SQL, Data Visualization', 'English, Tamil, Hindi'
  ],
];

const skills = [
  ['Photoshop', 'Graphic Design'],
  ['Python', 'Python'],
  ['Video Editing', 'Media'],
  ['Mathematics', 'Academics'],
  ['Public Speaking', 'Communication'],
  ['React.js & Frontend Architecture', 'Web Development'],
  ['Database Systems & SQL Optimization', 'Data Science'],
  ['Machine Learning with Scikit-Learn', 'Data Science'],
  ['Docker & Cloud Deployment Basics', 'Web Development'],
  ['Systems Programming in C', 'C'],
  ['UI Prototyping & Figma Basics', 'UI/UX Design'],
  ['Vector Graphic Design in Adobe Illustrator', 'Graphic Design'],
  ['DSLR Photography & Composition', 'Photography'],
  ['Data Science with Pandas, SQL & NumPy', 'Data Science'],
];

const offeredSkills = [
  [1, 6, 'Advanced', 'Component lifecycles, custom hooks, state management, and responsive UI with Tailwind CSS.', 'Weekdays after 4 PM', 'React, Frontend, JavaScript, Tailwind CSS', 'Hooks, Context API, Redux Toolkit, State Lifting', 2],
  [1, 7, 'Advanced', 'Relational schema design, normalization, joins, indexing, and transaction ACID properties.', 'Weekends & Evenings', 'SQL, Database Systems, Normalization, Query Tuning', 'Schema design, B-Tree indexing, ACID transactions', 2],
  [1, 2, 'Intermediate', 'Python syntax, data structures, OOP, and scripting for college labs.', 'Weekdays 5 PM – 7 PM', 'Python, OOP, Scripting, Automation', 'Python syntax, data structures, OOP classes', 1],
  [1, 11, 'Intermediate', 'Wireframing, auto-layout, design tokens, and developer handoff in Figma.', 'Flexible (Anytime)', 'Figma, UI/UX, Wireframing, Auto-Layout', 'Design tokens, auto-layout, prototype interactions', 1],
  [2, 10, 'Advanced', 'Pointers, malloc/free, structs, and debugging segmentation faults.', 'Weekdays after 4 PM', 'C, Pointers, Memory, Data Structures', 'Pointer arithmetic, structs, dynamic memory', 2],
  [3, 2, 'Expert', 'Python for data work, notebooks, and automation scripts.', 'Weekdays', 'Python, Data Science, Scripting, Notebooks', 'Pandas pipelines, Jupyter automation', 3],
  [4, 3, 'Advanced', 'Cutting, colour, captions, and export presets for campus videos.', 'Flexible (Anytime)', 'Video Editing, Premiere, Color Grading', 'Timeline editing, multi-cam, export settings', 2],
  [4, 12, 'Intermediate', 'Pen tool, typography pairing, and logo creation.', 'Flexible (Anytime)', 'Illustrator, Vector, Typography, Branding', 'Pen tool vectors, typography pairing', 1],
  [5, 2, 'Advanced', 'Python syntax, file parsing, and automating college tasks.', 'Evenings (6 PM – 8 PM)', 'Python, Automation, File IO', 'Scripting, regex, CSV parsing', 2],
  [6, 13, 'Intermediate', 'Aperture, shutter, ISO, and natural-light portraits.', 'Weekends (Mornings)', 'Photography, DSLR, Composition, Lighting', 'Manual exposure, rule of thirds, framing', 1],
  [7, 8, 'Advanced', 'Regression, classification, and model evaluation with scikit-learn.', 'Weekday Evenings & Weekends', 'Machine Learning, Scikit-Learn, Regression, AI', 'Linear regression, confusion matrices, ROC-AUC', 2],
  [7, 11, 'Advanced', 'UI/UX wireframing and graphic layout for ML project demos.', 'Weekday Evenings & Weekends', 'UI/UX, Figma, Presentation Design', 'Dashboard wireframes, metrics presentation', 2],
  [8, 9, 'Advanced', 'Dockerfiles, compose, multi-stage builds, and deployment on campus cloud.', 'Weekdays after 5 PM', 'Docker, Containers, Cloud, DevOps', 'Dockerfiles, Docker Compose, multi-stage builds', 2],
  [9, 10, 'Expert', 'Pointers to pointers, memory layout, gdb debugging, and system calls.', 'Flexible (Anytime)', 'Systems, C, GDB, Valgrind, Memory', 'Valgrind debugging, memory layout, system calls', 3],
  [10, 5, 'Expert', 'Hook-problem-solution framework, slide pacing, and hackathon pitching.', 'Weekends', 'Public Speaking, Pitching, Communication', 'Presentation structure, vocal modulation, Q&A handling', 3],
  [11, 11, 'Advanced', 'Design systems, auto-layout 5, component variants, and prototyping.', 'Weekdays after 4 PM', 'Figma, Design Systems, Tokens, Prototyping', 'Component variants, auto-layout, design tokens', 2],
  [12, 14, 'Advanced', 'Pandas dataframes, groupby, merging, and cleaning dirty datasets.', 'Weekends', 'Pandas, NumPy, SQL, Data Cleaning', 'Data cleaning, groupby aggregates, merging', 2],
];

const wantedSkills = [
  [1, 5, 'Advanced', 'Overcome stage anxiety for hackathon presentations.', 'High', 'Evenings (6 PM – 8 PM)', 'Overcome stage anxiety for upcoming college hackathon presentations.'],
  [1, 8, 'Advanced', 'Want to build predictive models for a DBMS & AI mini-project.', 'High', 'Weekday Evenings & Weekends', 'Want to build predictive models for final semester DBMS & AI mini-project.'],
  [1, 9, 'Intermediate', 'Learn containerizing React + Node applications.', 'Medium', 'Weekdays', 'Learn containerizing React + Node applications and deploying to cloud containers.'],
  [1, 10, 'Intermediate', 'Pointers, structs, and Unix process system calls.', 'Medium', 'Weekdays after 4 PM', 'Understand pointers arithmetic, struct memory alignment, and Unix process system calls.'],
  [2, 2, 'Beginner', 'Need Python for lab assignments.', 'High', 'Weekdays after 4 PM', 'Master Python for lab assignments.'],
  [2, 6, 'Intermediate', 'Want to learn React hooks and state management.', 'High', 'Weekdays after 4 PM', 'Build React frontend components for semester course projects.'],
  [3, 3, 'Beginner', 'Need basic video editing for research presentation clips.', 'Medium', 'Weekends', 'Edit short demonstration clips for research presentations.'],
  [4, 2, 'Beginner', 'Want to learn Python for generative design and scripts.', 'Medium', 'Flexible', 'Write generative art and scripting in Python.'],
  [4, 6, 'Beginner', 'Want to implement Figma designs in React.', 'High', 'Weekdays', 'Translate Figma prototypes into live React web apps.'],
  [5, 7, 'Advanced', 'Want stronger SQL joins and indexing.', 'High', 'Evenings', 'Master complex SQL joins, indexing, and performance optimization.'],
  [6, 5, 'Beginner', 'Need confidence for architecture reviews.', 'Medium', 'Weekends', 'Deliver confident architectural defense presentations.'],
  [7, 6, 'Intermediate', 'Want React hooks and component architecture.', 'High', 'Evenings', 'Build interactive dashboards for ML model visualization.'],
  [8, 7, 'Advanced', 'Want to optimize PostgreSQL-style JOIN queries.', 'High', 'Weekdays', 'Optimize database queries for high-throughput containerized services.'],
  [9, 11, 'Beginner', 'Want Figma basics for tool UIs.', 'Medium', 'Flexible', 'Design clean interfaces for systems utilities.'],
  [10, 2, 'Beginner', 'Want Python OOP for automation scripts.', 'Medium', 'Weekends', 'Automate business report generation using Python.'],
  [11, 6, 'Intermediate', 'Want to implement design systems in the browser.', 'High', 'Weekdays', 'Build Tailwind CSS components matching Figma design tokens.'],
  [12, 6, 'Intermediate', 'Want React for data dashboards.', 'Medium', 'Weekends', 'Integrate Pandas analysis outputs with live React data charts.'],
];

const exchanges = [
  [7, 1, 8, 'Accepted', '2026-09-28', 'Looking forward to learning scikit-learn basics for my course project.', '2026-09-28 11:00:00'],
  [1, 2, 6, 'Accepted', '2026-09-30', 'Need guidance with custom hooks and React component architecture.', '2026-09-30 14:00:00'],
  [1, 5, 7, 'Completed', '2026-09-20', 'Exam prep for database normalization and index optimization.', '2026-10-02 18:30:00'],
  [3, 1, 2, 'Completed', '2026-09-18', 'Lab assignments on OOP in Python.', '2026-09-25 17:00:00'],
  [8, 1, 9, 'Pending', '2026-10-08', 'Would love to learn Docker multi-stage builds for deployment.', '2026-10-08 16:00:00'],
  [3, 2, 2, 'Completed', '2026-09-12', 'Python scripting and automation help.', '2026-09-20 15:00:00'],
];

const sessions = [
  [1, '2026-10-09', '17:30', 75, 'Linear & Logistic Regression with Pandas Preprocessing', 'Offline', 'Campus Library Hub – Study Room 3B', 'Scheduled', null, 'Bring laptop with Jupyter / VS Code and Scikit-Learn installed.'],
  [2, '2026-10-06', '16:00', 60, 'React State Lifting, Custom Hooks & Context API', 'Online', 'https://meet.google.com/4s-vidhi-aarav', 'Scheduled', 'https://meet.google.com/4s-vidhi-aarav', 'Walk through lifting state from form components into custom hooks and setting up clean React Context providers.'],
  [3, '2026-10-02', '17:00', 75, 'B-Tree Indexing & Query Plan Explain Analysis', 'Offline', 'Discussion Pod A', 'Completed', null, 'Explain B-Tree indexing, clustering, and query plan explain analysis on discussion board.'],
  [4, '2026-09-28', '16:00', 60, 'Python classes, inheritance & dunder methods', 'Online', 'https://meet.google.com/4s-python-session', 'Completed', 'https://meet.google.com/4s-python-session', 'Review python OOP syntax and custom dunder methods.'],
  [6, '2026-09-20', '15:00', 60, 'Python basics for first-year labs', 'Offline', 'Hostel A common room', 'Completed', null, 'Python basics and lab assignment walkthrough.'],
];

const feedbacks = [
  [3, 5, 5, 'Vidhi is an outstanding mentor! She explained B-Tree indexing with simple drawings.', '2026-10-02 18:30:00', 5, 5, 5, 1],
  [4, 1, 5, 'Diya explains Python really clearly.', '2026-09-28 17:10:00', 5, 5, 4, 1],
  [6, 2, 5, 'Great Python tips for lab work.', '2026-09-20 16:20:00', 5, 4, 5, 1],
  [6, 3, 4, 'Aarav is a quick learner.', '2026-09-20 16:25:00', 4, 5, 5, 1],
];

const availabilities = [
  [1, 'Monday', '16:00', '18:00', 'Evening Lab Hours', 1],
  [1, 'Tuesday', '17:00', '19:00', 'Post-Lecture Slot', 1],
  [1, 'Thursday', '16:00', '18:00', 'Library Study Hall', 1],
  [1, 'Friday', '16:30', '19:00', 'Peer Swap Sessions', 1],
  [1, 'Saturday', '10:00', '12:30', 'Morning Deep Dive', 1],
  [1, 'Saturday', '15:00', '17:30', 'Afternoon Coding Labs', 1],
  [7, 'Friday', '17:30', '19:00', 'ML lab', 1],
  [2, 'Monday', '16:00', '17:00', 'React practice', 1],
];

const messages = [
  [7, 1, 'Hi Vidhi! I saw your learning request for Machine Learning with Scikit-Learn.', '2026-10-01 10:14:00', 1],
  [1, 7, 'Hey Rashi! Yes – I want regression algorithms for our DBMS & AI project.', '2026-10-01 10:18:00', 1],
  [7, 1, 'Awesome! I booked our Friday 5:30 PM slot in Study Room 3B at the library.', '2026-10-01 10:30:00', 0],
  [8, 1, 'Hey Vidhi! Noticed your request for Docker containerization.', '2026-10-02 15:15:00', 1],
  [1, 8, 'Hi Riya! I want to containerize React + Node with Docker Compose.', '2026-10-02 15:45:00', 1],
  [8, 1, 'I scheduled a session idea for Sunday 3:00 PM over Google Meet.', '2026-10-03 16:02:00', 0],
  [2, 1, 'Hi Vidhi, thanks for accepting my request to learn React.js!', '2026-10-03 14:10:00', 1],
  [1, 2, 'Happy to help, Aarav! Have you worked with useState before?', '2026-10-03 14:25:00', 1],
  [2, 1, 'Thanks for sending the starter repository! Looking forward to tomorrow.', '2026-10-03 18:00:00', 1],
];

const badges = [
  ['badge-first-skill', 'First Teaching Skill', 'Teaching', 'BookOpen', 'badge-indigo', 'Publish 1 teaching skill offering on campus', 1, 'skills'],
  ['badge-first-request', 'First Learning Goal', 'Learning', 'Layers', 'badge-blue', 'Post 1 skill learning request on wishlist', 1, 'goals'],
  ['badge-first-match', 'First Match', 'Milestone', 'Sparkles', 'badge-purple', 'Generate 1 peer skill match on campus', 1, 'matches'],
  ['badge-first-session', 'First Session', 'Milestone', 'Calendar', 'badge-amber', 'Schedule 1 study session on your calendar', 1, 'sessions'],
  ['badge-first-completed', 'First Completed Session', 'Milestone', 'CheckCircle2', 'badge-emerald', 'Complete 1 collaborative study session', 1, 'sessions'],
  ['badge-knowledge-sharer', 'Knowledge Sharer', 'Teaching', 'GraduationCap', 'badge-purple', 'Complete 1 teaching session with a peer learner', 1, 'sessions'],
  ['badge-active-learner', 'Active Learner', 'Learning', 'Zap', 'badge-amber', 'Complete 1 learning session with a peer teacher', 1, 'sessions'],
  ['badge-top-mentor', 'Top Peer Mentor', 'Teaching', 'Award', 'badge-gold', 'Maintain a 4.90+ rating with at least 1 completed teaching session', 1, 'sessions'],
  ['badge-master-teacher', 'Master Instructor', 'Teaching', 'Star', 'badge-teal', 'Complete 3 teaching sessions with peer learners', 3, 'sessions'],
  ['badge-five-star', 'Five-Star Scholar', 'Milestone', 'Sparkles', 'badge-gold', 'Receive 3 five-star peer ratings', 3, 'reviews'],
];

const studentBadges = [
  [1, 'badge-first-skill', '2026-10-02 10:00:00', 'Published React.js & Frontend Architecture'],
  [1, 'badge-first-request', '2026-10-03 11:00:00', 'Posted Applied Machine Learning wishlist request'],
  [1, 'badge-first-match', '2026-10-04 12:00:00', 'Mutual match with Rashi Chandani'],
  [1, 'badge-first-session', '2026-10-05 14:00:00', 'Scheduled session with Aarav Sharma'],
  [1, 'badge-first-completed', '2026-10-02 18:30:00', 'Completed session on SQL Optimization'],
  [1, 'badge-knowledge-sharer', '2026-10-02 18:30:00', 'Taught session on SQL Optimization with Sneha Iyer'],
  [1, 'badge-top-mentor', '2026-10-06 19:00:00', 'Maintained 5.0 rating across verified sessions'],
  [3, 'badge-first-skill', '2026-09-15 10:00:00', 'Published Python for Data'],
  [3, 'badge-first-completed', '2026-09-18 17:30:00', 'Taught Python fundamentals to Vidhi Kedia'],
];

const notifications = [
  [1, 'match', 'New Peer Match Found!', 'You matched with Rashi Chandani for Machine Learning & React swap.', '/matches#requests', 'exchange', '1', '2026-10-01 10:15:00', 0],
  [1, 'session', 'Upcoming Session Tomorrow', 'React State Lifting with Aarav Sharma is scheduled for 4:00 PM.', '/sessions', 'session', '1', '2026-10-05 09:00:00', 0],
  [1, 'badge', 'New Badge Unlocked!', 'You earned the "Top Peer Mentor" gold badge!', '/profile', 'badge', 'badge-top-mentor', '2026-10-06 19:00:00', 1],
  [1, 'review', 'New Feedback Received', 'Sneha Iyer left you a 5-star rating for SQL optimization.', '/profile', 'feedback', '1', '2026-10-02 18:35:00', 1],
  [2, 'session', 'Session Scheduled', 'Your React session with Vidhi Kedia has been scheduled.', '/sessions', 'session', '2', '2026-10-03 14:30:00', 0],
  [7, 'match', 'Exchange Request Accepted', 'Vidhi Kedia accepted your Machine Learning exchange.', '/sessions', 'exchange', '1', '2026-09-28 11:00:00', 1],
];

async function seedDatabase() {
  const schemaFile = db.isPostgres ? 'schema.pg.sql' : 'schema.sql';
  const schemaSql = fs.readFileSync(path.join(__dirname, schemaFile), 'utf8');
  await db.exec(schemaSql);
  if (typeof runMigrations === 'function') {
    runMigrations();
  }

  const addStudent = db.prepare(
    `INSERT INTO STUDENT (
      Name, Email, Department, YearOfStudy, Bio, HostelBlock, RoomNo, Password,
      Avatar, Phone, GithubUrl, LinkedinUrl, PortfolioUrl, Interests, Languages
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const s of students) {
    await addStudent.run(...s.slice(0, 7), pass, ...s.slice(7));
  }

  const addSkill = db.prepare('INSERT INTO SKILL (SkillName, Category) VALUES (?, ?)');
  for (const s of skills) {
    await addSkill.run(...s);
  }

  const addOffered = db.prepare(
    `INSERT INTO SKILL_OFFERED (
      StudentID, SkillID, ProficiencyLevel, Description, Availability, Tags, SampleTopics, YearsOfExperience
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of offeredSkills) {
    await addOffered.run(...r);
  }

  const addWanted = db.prepare(
    `INSERT INTO SKILL_WANTED (
      StudentID, SkillID, DesiredLevel, Description, Priority, PreferredAvailability, TargetGoal
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of wantedSkills) {
    await addWanted.run(...r);
  }

  const addEx = db.prepare(
    'INSERT INTO EXCHANGE (TeacherID, LearnerID, SkillID, Status, RequestDate, Note, UpdatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (const e of exchanges) {
    await addEx.run(...e);
  }

  const addSes = db.prepare(
    `INSERT INTO SESSION (
      ExchangeID, SessionDate, StartTime, DurationMins, Topic, Mode, Location, Status, MeetingLink, Notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const s of sessions) {
    await addSes.run(...s);
  }

  const addFb = db.prepare(
    `INSERT INTO FEEDBACK (
      ExchangeID, GivenBy, Rating, Comments, CreatedAt, ClarityRating, PatienceRating, PunctualityRating, WouldRecommend
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const f of feedbacks) {
    await addFb.run(...f);
  }

  const addAvail = db.prepare(
    'INSERT INTO AVAILABILITY (StudentID, DayOfWeek, StartTime, EndTime, Label, Enabled) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const a of availabilities) {
    await addAvail.run(...a);
  }

  const addMsg = db.prepare(
    'INSERT INTO MESSAGE (SenderID, ReceiverID, Body, SentAt, IsRead) VALUES (?, ?, ?, ?, ?)'
  );
  for (const m of messages) {
    await addMsg.run(...m);
  }

  const addBadge = db.prepare(
    'INSERT INTO BADGE (BadgeID, Title, Category, Icon, BadgeClass, Criterion, TargetValue, Unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const b of badges) {
    await addBadge.run(...b);
  }

  const addStudentBadge = db.prepare(
    'INSERT INTO STUDENT_BADGE (StudentID, BadgeID, EarnedAt, ActivityTrigger) VALUES (?, ?, ?, ?)'
  );
  for (const sb of studentBadges) {
    await addStudentBadge.run(...sb);
  }

  const addNotif = db.prepare(
    'INSERT INTO NOTIFICATION (StudentID, Type, Title, Message, Link, RelatedType, RelatedID, CreatedAt, IsRead) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const n of notifications) {
    await addNotif.run(...n);
  }

  console.log(`Database created and seeded: ${db.isPostgres ? 'PostgreSQL' : 'skillexchange.db'}`);
  console.log('Demo password for all students: password123');
  console.log('Try: kediavidhi62@gmail.com  or  aarav@campus.edu');
}

// Auto-seed if executed directly (e.g. node seed.js or npm run seed)
if (require.main === module) {
  seedDatabase().catch((err) => {
    console.error('Seed error:', err);
    process.exit(1);
  });
}

module.exports = { seedDatabase };
