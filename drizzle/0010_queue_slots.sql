CREATE TABLE queue_slots (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES settings(owner) ON DELETE CASCADE,
 weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6), local_time TEXT NOT NULL,
 timezone TEXT NOT NULL, UNIQUE(owner,weekday,local_time,timezone)
);
