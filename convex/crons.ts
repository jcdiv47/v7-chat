import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Mark running runs whose heartbeat has gone stale as failed (server died mid-run).
crons.interval(
  "sweep stale runs",
  { seconds: 60 },
  internal.runs.sweepStaleRuns,
  {},
);

export default crons;
