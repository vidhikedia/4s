-- Campus Skill Exchange: PostgreSQL relational schema for Neon production deployment

-- Compatibility functions for SQLite date/datetime functions
CREATE OR REPLACE FUNCTION datetime(text) RETURNS timestamp AS $$
  SELECT CURRENT_TIMESTAMP;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION date(text) RETURNS date AS $$
  SELECT CURRENT_DATE;
$$ LANGUAGE sql IMMUTABLE;

DROP TABLE IF EXISTS NOTIFICATION CASCADE;
DROP TABLE IF EXISTS STUDENT_BADGE CASCADE;
DROP TABLE IF EXISTS BADGE CASCADE;
DROP TABLE IF EXISTS MESSAGE CASCADE;
DROP TABLE IF EXISTS AVAILABILITY CASCADE;
DROP TABLE IF EXISTS FEEDBACK CASCADE;
DROP TABLE IF EXISTS SESSION CASCADE;
DROP TABLE IF EXISTS EXCHANGE CASCADE;
DROP TABLE IF EXISTS SKILL_WANTED CASCADE;
DROP TABLE IF EXISTS SKILL_OFFERED CASCADE;
DROP TABLE IF EXISTS SKILL CASCADE;
DROP TABLE IF EXISTS STUDENT CASCADE;

CREATE TABLE STUDENT (
    StudentID    SERIAL PRIMARY KEY,
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
    LastSeenAt   TEXT,
    SkillMasterShown INTEGER DEFAULT 0
);

CREATE TABLE SKILL (
    SkillID    SERIAL PRIMARY KEY,
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
    ExchangeID   SERIAL PRIMARY KEY,
    TeacherID    INTEGER NOT NULL,
    LearnerID    INTEGER NOT NULL,
    SkillID      INTEGER NOT NULL,
    Status       TEXT NOT NULL DEFAULT 'Pending'
        CHECK (Status IN ('Pending','Accepted','Completed','Rejected','Cancelled')),
    RequestDate  TEXT NOT NULL DEFAULT (CURRENT_DATE::text),
    Note         TEXT,
    UpdatedAt    TEXT DEFAULT (CURRENT_TIMESTAMP::text),
    CHECK (TeacherID <> LearnerID),
    FOREIGN KEY (TeacherID) REFERENCES STUDENT(StudentID),
    FOREIGN KEY (LearnerID) REFERENCES STUDENT(StudentID),
    FOREIGN KEY (SkillID)   REFERENCES SKILL(SkillID)
);

CREATE TABLE SESSION (
    SessionID     SERIAL PRIMARY KEY,
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
    FeedbackID        SERIAL PRIMARY KEY,
    ExchangeID        INTEGER NOT NULL,
    GivenBy           INTEGER NOT NULL,
    Rating            INTEGER NOT NULL CHECK (Rating BETWEEN 1 AND 5),
    Comments          TEXT,
    CreatedAt         TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    ClarityRating     INTEGER CHECK (ClarityRating IS NULL OR ClarityRating BETWEEN 1 AND 5),
    PatienceRating    INTEGER CHECK (PatienceRating IS NULL OR PatienceRating BETWEEN 1 AND 5),
    PunctualityRating INTEGER CHECK (PunctualityRating IS NULL OR PunctualityRating BETWEEN 1 AND 5),
    WouldRecommend    INTEGER DEFAULT 1 CHECK (WouldRecommend IN (0,1)),
    UNIQUE (ExchangeID, GivenBy),
    FOREIGN KEY (ExchangeID) REFERENCES EXCHANGE(ExchangeID) ON DELETE CASCADE,
    FOREIGN KEY (GivenBy)    REFERENCES STUDENT(StudentID)
);

CREATE TABLE AVAILABILITY (
    AvailabilityID SERIAL PRIMARY KEY,
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
    MessageID   SERIAL PRIMARY KEY,
    SenderID    INTEGER NOT NULL,
    ReceiverID  INTEGER NOT NULL,
    Body        TEXT NOT NULL,
    SentAt      TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
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
    EarnedAt        TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    ActivityTrigger TEXT,
    PRIMARY KEY (StudentID, BadgeID),
    FOREIGN KEY (StudentID) REFERENCES STUDENT(StudentID) ON DELETE CASCADE,
    FOREIGN KEY (BadgeID)   REFERENCES BADGE(BadgeID)   ON DELETE CASCADE
);

CREATE TABLE NOTIFICATION (
    NotificationID SERIAL PRIMARY KEY,
    StudentID      INTEGER NOT NULL,
    Type           TEXT NOT NULL,
    Title          TEXT NOT NULL,
    Message        TEXT NOT NULL,
    Link           TEXT,
    RelatedType    TEXT,
    RelatedID      TEXT,
    CreatedAt      TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    IsRead         INTEGER NOT NULL DEFAULT 0 CHECK (IsRead IN (0,1)),
    FOREIGN KEY (StudentID) REFERENCES STUDENT(StudentID) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_offered_skill ON SKILL_OFFERED(SkillID);
CREATE INDEX IF NOT EXISTS idx_wanted_skill  ON SKILL_WANTED(SkillID);
CREATE INDEX IF NOT EXISTS idx_exchange_teacher ON EXCHANGE(TeacherID);
CREATE INDEX IF NOT EXISTS idx_exchange_learner ON EXCHANGE(LearnerID);
CREATE INDEX IF NOT EXISTS idx_message_pair ON MESSAGE(SenderID, ReceiverID);
CREATE INDEX IF NOT EXISTS idx_availability_student ON AVAILABILITY(StudentID);
CREATE INDEX IF NOT EXISTS idx_student_badge ON STUDENT_BADGE(StudentID);
CREATE INDEX IF NOT EXISTS idx_notification_student ON NOTIFICATION(StudentID);

CREATE INDEX IF NOT EXISTS idx_exchange_skill ON EXCHANGE(SkillID);
CREATE INDEX IF NOT EXISTS idx_exchange_status ON EXCHANGE(Status);
CREATE INDEX IF NOT EXISTS idx_session_exchange ON SESSION(ExchangeID);
CREATE INDEX IF NOT EXISTS idx_session_status_date ON SESSION(Status, SessionDate);
CREATE INDEX IF NOT EXISTS idx_feedback_exchange ON FEEDBACK(ExchangeID);
CREATE INDEX IF NOT EXISTS idx_feedback_givenby ON FEEDBACK(GivenBy);
CREATE INDEX IF NOT EXISTS idx_message_receiver_read ON MESSAGE(ReceiverID, IsRead);
CREATE INDEX IF NOT EXISTS idx_notification_student_read ON NOTIFICATION(StudentID, IsRead);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_active_unique ON EXCHANGE(TeacherID, LearnerID, SkillID) WHERE Status IN ('Pending', 'Accepted');
