-- Campus Skill Exchange: relational schema (from the ER model)
PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS NOTIFICATION;
DROP TABLE IF EXISTS STUDENT_BADGE;
DROP TABLE IF EXISTS BADGE;
DROP TABLE IF EXISTS MESSAGE;
DROP TABLE IF EXISTS AVAILABILITY;
DROP TABLE IF EXISTS FEEDBACK;
DROP TABLE IF EXISTS SESSION;
DROP TABLE IF EXISTS EXCHANGE;
DROP TABLE IF EXISTS SKILL_WANTED;
DROP TABLE IF EXISTS SKILL_OFFERED;
DROP TABLE IF EXISTS SKILL;
DROP TABLE IF EXISTS STUDENT;

CREATE TABLE STUDENT (
    StudentID    INTEGER PRIMARY KEY AUTOINCREMENT,
    Name         TEXT NOT NULL,
    Email        TEXT NOT NULL UNIQUE,
    Department   TEXT,
    YearOfStudy  TEXT,
    Bio          TEXT,
    HostelBlock  TEXT,
    RoomNo       TEXT,
    Password     TEXT NOT NULL,
    Avatar       TEXT,
    Phone        TEXT,
    GithubUrl    TEXT,
    LinkedinUrl  TEXT,
    PortfolioUrl TEXT,
    Interests    TEXT,
    Languages    TEXT,
    LastSeenAt   TEXT
);

CREATE TABLE SKILL (
    SkillID    INTEGER PRIMARY KEY AUTOINCREMENT,
    SkillName  TEXT NOT NULL UNIQUE,
    Category   TEXT
);

CREATE TABLE SKILL_OFFERED (
    StudentID         INTEGER NOT NULL,
    SkillID           INTEGER NOT NULL,
    ProficiencyLevel  TEXT NOT NULL DEFAULT 'Intermediate'
        CHECK (ProficiencyLevel IN ('Beginner','Intermediate','Advanced','Expert')),
    Description       TEXT,
    Availability      TEXT,
    Tags              TEXT,
    SampleTopics      TEXT,
    YearsOfExperience INTEGER DEFAULT 1,
    PRIMARY KEY (StudentID, SkillID),
    FOREIGN KEY (StudentID) REFERENCES STUDENT(StudentID) ON DELETE CASCADE,
    FOREIGN KEY (SkillID)   REFERENCES SKILL(SkillID)     ON DELETE CASCADE
);

CREATE TABLE SKILL_WANTED (
    StudentID             INTEGER NOT NULL,
    SkillID               INTEGER NOT NULL,
    DesiredLevel          TEXT NOT NULL DEFAULT 'Beginner'
        CHECK (DesiredLevel IN ('Beginner','Intermediate','Advanced','Expert')),
    Description           TEXT,
    Priority              TEXT NOT NULL DEFAULT 'Medium'
        CHECK (Priority IN ('High','Medium','Low')),
    PreferredAvailability TEXT,
    TargetGoal            TEXT,
    PRIMARY KEY (StudentID, SkillID),
    FOREIGN KEY (StudentID) REFERENCES STUDENT(StudentID) ON DELETE CASCADE,
    FOREIGN KEY (SkillID)   REFERENCES SKILL(SkillID)     ON DELETE CASCADE
);

CREATE TABLE EXCHANGE (
    ExchangeID   INTEGER PRIMARY KEY AUTOINCREMENT,
    TeacherID    INTEGER NOT NULL,
    LearnerID    INTEGER NOT NULL,
    SkillID      INTEGER NOT NULL,
    Status       TEXT NOT NULL DEFAULT 'Pending'
        CHECK (Status IN ('Pending','Accepted','Completed','Rejected','Cancelled')),
    RequestDate  TEXT NOT NULL DEFAULT (date('now')),
    Note         TEXT,
    UpdatedAt    TEXT DEFAULT (datetime('now')),
    CHECK (TeacherID <> LearnerID),
    FOREIGN KEY (TeacherID) REFERENCES STUDENT(StudentID),
    FOREIGN KEY (LearnerID) REFERENCES STUDENT(StudentID),
    FOREIGN KEY (SkillID)   REFERENCES SKILL(SkillID)
);

CREATE TABLE SESSION (
    SessionID     INTEGER PRIMARY KEY AUTOINCREMENT,
    ExchangeID    INTEGER NOT NULL,
    SessionDate   TEXT NOT NULL,
    StartTime     TEXT,
    DurationMins  INTEGER NOT NULL DEFAULT 60,
    Topic         TEXT,
    Mode          TEXT NOT NULL DEFAULT 'Offline' CHECK (Mode IN ('Online','Offline')),
    Location      TEXT,
    Status        TEXT NOT NULL DEFAULT 'Scheduled'
        CHECK (Status IN ('Scheduled','Completed','Cancelled')),
    MeetingLink   TEXT,
    Notes         TEXT,
    FOREIGN KEY (ExchangeID) REFERENCES EXCHANGE(ExchangeID) ON DELETE CASCADE
);

CREATE TABLE FEEDBACK (
    FeedbackID        INTEGER PRIMARY KEY AUTOINCREMENT,
    ExchangeID        INTEGER NOT NULL,
    GivenBy           INTEGER NOT NULL,
    Rating            INTEGER NOT NULL CHECK (Rating BETWEEN 1 AND 5),
    Comments          TEXT,
    CreatedAt         TEXT NOT NULL DEFAULT (datetime('now')),
    ClarityRating     INTEGER CHECK (ClarityRating IS NULL OR ClarityRating BETWEEN 1 AND 5),
    PatienceRating    INTEGER CHECK (PatienceRating IS NULL OR PatienceRating BETWEEN 1 AND 5),
    PunctualityRating INTEGER CHECK (PunctualityRating IS NULL OR PunctualityRating BETWEEN 1 AND 5),
    WouldRecommend    INTEGER DEFAULT 1 CHECK (WouldRecommend IN (0,1)),
    UNIQUE (ExchangeID, GivenBy),
    FOREIGN KEY (ExchangeID) REFERENCES EXCHANGE(ExchangeID) ON DELETE CASCADE,
    FOREIGN KEY (GivenBy)    REFERENCES STUDENT(StudentID)
);

CREATE TABLE AVAILABILITY (
    AvailabilityID INTEGER PRIMARY KEY AUTOINCREMENT,
    StudentID      INTEGER NOT NULL,
    DayOfWeek      TEXT NOT NULL
        CHECK (DayOfWeek IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
    StartTime      TEXT NOT NULL,
    EndTime        TEXT NOT NULL,
    Label          TEXT,
    Enabled        INTEGER NOT NULL DEFAULT 1 CHECK (Enabled IN (0,1)),
    FOREIGN KEY (StudentID) REFERENCES STUDENT(StudentID) ON DELETE CASCADE
);

CREATE TABLE MESSAGE (
    MessageID   INTEGER PRIMARY KEY AUTOINCREMENT,
    SenderID    INTEGER NOT NULL,
    ReceiverID  INTEGER NOT NULL,
    Body        TEXT NOT NULL,
    SentAt      TEXT NOT NULL DEFAULT (datetime('now')),
    IsRead      INTEGER NOT NULL DEFAULT 0 CHECK (IsRead IN (0,1)),
    CHECK (SenderID <> ReceiverID),
    FOREIGN KEY (SenderID)   REFERENCES STUDENT(StudentID) ON DELETE CASCADE,
    FOREIGN KEY (ReceiverID) REFERENCES STUDENT(StudentID) ON DELETE CASCADE
);

CREATE TABLE BADGE (
    BadgeID     TEXT PRIMARY KEY,
    Title       TEXT NOT NULL,
    Category    TEXT NOT NULL,
    Icon        TEXT NOT NULL,
    BadgeClass  TEXT NOT NULL,
    Criterion   TEXT NOT NULL,
    TargetValue INTEGER NOT NULL DEFAULT 1,
    Unit        TEXT NOT NULL DEFAULT 'sessions'
);

CREATE TABLE STUDENT_BADGE (
    StudentID       INTEGER NOT NULL,
    BadgeID         TEXT NOT NULL,
    EarnedAt        TEXT NOT NULL DEFAULT (datetime('now')),
    ActivityTrigger TEXT,
    PRIMARY KEY (StudentID, BadgeID),
    FOREIGN KEY (StudentID) REFERENCES STUDENT(StudentID) ON DELETE CASCADE,
    FOREIGN KEY (BadgeID)   REFERENCES BADGE(BadgeID)   ON DELETE CASCADE
);

CREATE TABLE NOTIFICATION (
    NotificationID INTEGER PRIMARY KEY AUTOINCREMENT,
    StudentID      INTEGER NOT NULL,
    Type           TEXT NOT NULL,
    Title          TEXT NOT NULL,
    Message        TEXT NOT NULL,
    Link           TEXT,
    RelatedType    TEXT,
    RelatedID      TEXT,
    CreatedAt      TEXT NOT NULL DEFAULT (datetime('now')),
    IsRead         INTEGER NOT NULL DEFAULT 0 CHECK (IsRead IN (0,1)),
    FOREIGN KEY (StudentID) REFERENCES STUDENT(StudentID) ON DELETE CASCADE
);

CREATE INDEX idx_offered_skill ON SKILL_OFFERED(SkillID);
CREATE INDEX idx_wanted_skill  ON SKILL_WANTED(SkillID);
CREATE INDEX idx_exchange_teacher ON EXCHANGE(TeacherID);
CREATE INDEX idx_exchange_learner ON EXCHANGE(LearnerID);
CREATE INDEX idx_message_pair ON MESSAGE(SenderID, ReceiverID);
CREATE INDEX idx_availability_student ON AVAILABILITY(StudentID);
CREATE INDEX idx_student_badge ON STUDENT_BADGE(StudentID);
CREATE INDEX idx_notification_student ON NOTIFICATION(StudentID);
