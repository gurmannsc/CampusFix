-- CampusFix schema (MySQL 8). Mirrors docs/03-domain-model.md "MySQL mapping".
-- Class attribute names are camelCase in code and snake_case here (e.g. dueAt -> due_at).
-- Running this file DROPS and recreates every table, so `npm run setup` and
-- `npm run reset-demo` both start from a clean slate.
-- Timestamps are DATETIME values stored in UTC; the application always passes JS Dates
-- (never NOW()) so the server's own time zone does not matter.

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS escalations;
DROP TABLE IF EXISTS feedback;
DROP TABLE IF EXISTS status_updates;
DROP TABLE IF EXISTS complaints;
DROP TABLE IF EXISTS deadline_rules;
DROP TABLE IF EXISTS locations;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;

-- User hierarchy collapsed into one table (single-table inheritance).
-- Student: sap_id, program, hostel_room. Faculty: employee_id, department.
-- MaintenanceStaff: trade, is_available. Columns that do not apply to a role stay NULL.
CREATE TABLE users (
  user_id       INT AUTO_INCREMENT PRIMARY KEY,
  role          ENUM('STUDENT','FACULTY','STAFF','SUPERVISOR','ADMIN') NOT NULL,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  phone         VARCHAR(20)  NULL,
  password_hash VARCHAR(100) NOT NULL,
  sap_id        VARCHAR(20)  NULL,
  program       VARCHAR(80)  NULL,
  hostel_room   VARCHAR(20)  NULL,
  employee_id   VARCHAR(20)  NULL,
  department    VARCHAR(80)  NULL,
  trade         VARCHAR(50)  NULL,
  is_available  BOOLEAN      NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE categories (
  category_id      INT AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(50) NOT NULL UNIQUE,
  type             ENUM('INFRASTRUCTURE','SERVICE') NOT NULL,
  default_priority ENUM('CRITICAL','HIGH','MEDIUM','LOW') NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE locations (
  location_id INT AUTO_INCREMENT PRIMARY KEY,
  block       VARCHAR(50) NOT NULL,
  floor       INT         NOT NULL,
  room        VARCHAR(50) NOT NULL,
  area_type   ENUM('HOSTEL','CLASSROOM','LAB','MESS','WASHROOM','COMMON_AREA') NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- priority is the primary key: exactly one rule per priority level.
CREATE TABLE deadline_rules (
  priority                  ENUM('CRITICAL','HIGH','MEDIUM','LOW') NOT NULL PRIMARY KEY,
  resolution_hours          INT NOT NULL,
  escalation_interval_hours INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE complaints (
  complaint_id     INT AUTO_INCREMENT PRIMARY KEY,
  title            VARCHAR(150) NOT NULL,
  description      TEXT         NOT NULL,
  photo_path       VARCHAR(255) NULL,
  -- "governed by" DeadlineRule: priority doubles as the FK to deadline_rules.
  priority         ENUM('CRITICAL','HIGH','MEDIUM','LOW') NOT NULL,
  status           ENUM('SUBMITTED','INVALID','ASSIGNED','IN_PROGRESS','ON_HOLD',
                        'RESOLVED','REOPENED','ESCALATED','CLOSED') NOT NULL DEFAULT 'SUBMITTED',
  created_at       DATETIME NOT NULL,
  due_at           DATETIME NOT NULL,
  resolved_at      DATETIME NULL,
  closed_at        DATETIME NULL,
  escalation_level INT NOT NULL DEFAULT 0,
  reopen_count     INT NOT NULL DEFAULT 0,
  reporter_id      INT NOT NULL,   -- CampusUser (STUDENT or FACULTY) who raised it
  category_id      INT NOT NULL,
  location_id      INT NOT NULL,
  supervisor_id    INT NULL,       -- set when a supervisor assigns it (NULL for SERVICE)
  assignee_id      INT NULL,       -- a STAFF user, or an ADMIN user for SERVICE complaints
  CONSTRAINT fk_c_reporter   FOREIGN KEY (reporter_id)   REFERENCES users(user_id),
  CONSTRAINT fk_c_category   FOREIGN KEY (category_id)   REFERENCES categories(category_id),
  CONSTRAINT fk_c_location   FOREIGN KEY (location_id)   REFERENCES locations(location_id),
  CONSTRAINT fk_c_rule       FOREIGN KEY (priority)      REFERENCES deadline_rules(priority),
  CONSTRAINT fk_c_supervisor FOREIGN KEY (supervisor_id) REFERENCES users(user_id),
  CONSTRAINT fk_c_assignee   FOREIGN KEY (assignee_id)   REFERENCES users(user_id),
  CONSTRAINT chk_c_levels CHECK (escalation_level >= 0 AND reopen_count >= 0),
  INDEX idx_c_status_due (status, due_at),   -- EscalationScheduler.findOverdue
  INDEX idx_c_reporter (reporter_id),
  INDEX idx_c_assignee (assignee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The three tables below are composed by Complaint: deleted with it (ON DELETE CASCADE).
CREATE TABLE status_updates (
  update_id    INT AUTO_INCREMENT PRIMARY KEY,
  complaint_id INT NOT NULL,
  from_status  ENUM('SUBMITTED','INVALID','ASSIGNED','IN_PROGRESS','ON_HOLD',
                    'RESOLVED','REOPENED','ESCALATED','CLOSED') NULL,  -- NULL = initial creation
  to_status    ENUM('SUBMITTED','INVALID','ASSIGNED','IN_PROGRESS','ON_HOLD',
                    'RESOLVED','REOPENED','ESCALATED','CLOSED') NOT NULL,
  remarks      TEXT NULL,
  updated_by   INT  NULL,        -- NULL when the Timer made the change
  updated_at   DATETIME NOT NULL,
  CONSTRAINT fk_su_complaint FOREIGN KEY (complaint_id) REFERENCES complaints(complaint_id) ON DELETE CASCADE,
  CONSTRAINT fk_su_user      FOREIGN KEY (updated_by)   REFERENCES users(user_id),
  INDEX idx_su_complaint (complaint_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE feedback (
  feedback_id  INT AUTO_INCREMENT PRIMARY KEY,
  complaint_id INT NOT NULL,
  is_fixed     BOOLEAN NOT NULL,
  rating       INT NULL,         -- 1 to 5 when is_fixed = true; NULL on a rejection
  comment      TEXT NULL,        -- on a rejection this holds the reason
  given_at     DATETIME NOT NULL,
  CONSTRAINT fk_f_complaint FOREIGN KEY (complaint_id) REFERENCES complaints(complaint_id) ON DELETE CASCADE,
  CONSTRAINT chk_f_rating CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE escalations (
  escalation_id INT AUTO_INCREMENT PRIMARY KEY,
  complaint_id  INT NOT NULL,
  level         INT NOT NULL,
  reason        VARCHAR(255) NOT NULL,
  escalated_at  DATETIME NOT NULL,
  CONSTRAINT fk_e_complaint FOREIGN KEY (complaint_id) REFERENCES complaints(complaint_id) ON DELETE CASCADE,
  INDEX idx_e_complaint (complaint_id, escalated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE notifications (
  notification_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL,   -- recipient ("User receives Notification")
  complaint_id    INT NULL,       -- the complaint it is about, if any
  message         VARCHAR(255) NOT NULL,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at         DATETIME NOT NULL,
  CONSTRAINT fk_n_user      FOREIGN KEY (user_id)      REFERENCES users(user_id),
  CONSTRAINT fk_n_complaint FOREIGN KEY (complaint_id) REFERENCES complaints(complaint_id) ON DELETE CASCADE,
  INDEX idx_n_user (user_id, is_read, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
