"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  CornerDownLeft,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import {
  initialRoles,
  type Job,
  type Role,
  type Staff,
  type State,
} from "@/lib/ranking-types";

type Proof = { code: string; userId: string };
type Inspection = {
  username: string;
  displayName: string;
  avatar?: string;
  roles: Role[];
};

async function request<T>(
  action: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch("/api/console", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...data }),
  });
  const result = (await res.json()) as T & { error?: string };
  if (!res.ok)
    throw new Error(result.error || "The request could not be completed.");
  return result;
}

export default function Console({ signedIn }: { signedIn: boolean }) {
  const [state, setState] = useState<State>({
    roles: initialRoles,
    staff: null,
    jobs: [],
    ready: false,
  });
  const [command, setCommand] = useState("");
  const [username, setUsername] = useState("");
  const [proof, setProof] = useState<{ code: string; userId: string } | null>(
    null,
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [inspection, setInspection] = useState<{
    username: string;
    displayName: string;
    avatar?: string;
    roles: Role[];
  } | null>(null);
  const [suggestions, setSuggestions] = useState<Staff[]>([]);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const halted = useRef(false);
  const canCommand =
    signedIn && state.ready && state.staff && state.staff.rank >= 9;
  const working = Boolean(busy);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/console", { cache: "no-store" });
      const data = (await res.json()) as State & { error?: string };
      if (!res.ok) throw new Error(data.error);
      setState(data);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    halted.current = false;
    return () => {
      halted.current = true;
    };
  }, []);
  useEffect(() => {
    const match =
      /^(?:promote|demote|kick|ban|check\s+roles)\s+([A-Za-z0-9_]{2,20})$/i.exec(
        command,
      );
    if (!canCommand || !match || match[1].toLowerCase() === "all") {
      setSuggestions([]);
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/console?q=${encodeURIComponent(match[1])}`,
          { signal: abort.signal },
        );
        const data = (await res.json()) as { members: Staff[] };
        if (res.ok) setSuggestions(data.members);
      } catch {
        /* A changed query cancels its earlier suggestion request. */
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [command, canCommand]);

  async function verify(stage: string) {
    setBusy(stage);
    setError("");
    setMessage("");
    try {
      const data = await request<Proof>(stage, { username });
      if (stage === "beginVerification") setProof(data);
      else {
        setProof(null);
        setMessage("Roblox account verified.");
        await refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function preview(event: React.FormEvent) {
    event.preventDefault();
    if (!command.trim()) return;
    setBusy("preview");
    setError("");
    setMessage("");
    setJob(null);
    setInspection(null);
    setSuggestions([]);
    try {
      const data = await request<{ inspection?: Inspection; job: Job }>(
        "preview",
        { command },
      );
      if (data.inspection) setInspection(data.inspection);
      else setJob(data.job);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function execute(current: Job) {
    setBusy("execute");
    setError("");
    halted.current = false;
    try {
      let next = current;
      while (!halted.current) {
        next = (await request<{ job: Job }>("execute", { jobId: current.id }))
          .job;
        setJob(next);
        if (!["queued", "running"].includes(next.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      await refresh();
      if (!halted.current)
        setMessage(
          next.status === "completed"
            ? "Command complete. Changes checked with Roblox."
            : "Review the command result below.",
        );
    } catch (e) {
      setError(
        (e as Error).message +
          " Resume to continue without repeating completed changes.",
      );
      await refresh();
    } finally {
      setBusy("");
    }
  }
  function fill(text: string) {
    setCommand(text);
    setJob(null);
    input.current?.focus();
  }

  return (
    <div className="console-shell">
      <header className="topbar">
        <a href="/" className="brand">
          <span className="brand-mark">
            <ShieldCheck size={24} strokeWidth={1.6} />
          </span>
          <span>
            AUTHORITY<span className="brand-sub">COMMUNITY OPERATIONS</span>
          </span>
        </a>
        <div className="topbar-right">
          <span className="community-id">COMMUNITY / 526651322</span>
          {signedIn ? (
            <a
              className="text-link"
              href="/signout-with-chatgpt?return_to=/"
              target="_top"
            >
              Sign out
            </a>
          ) : (
            <Button asChild variant="outline">
              <a href="/signin-with-chatgpt?return_to=/" target="_top">
                Staff sign in <ChevronRight />
              </a>
            </Button>
          )}
        </div>
      </header>
      <main className="workspace">
        <div className="page-heading">
          <div>
            <p className="eyebrow">PERSONNEL CONTROL</p>
            <h1>
              Community ranking<span className="heading-period">.</span>
            </h1>
            <p className="page-description">
              The right people. The right permissions.
            </p>
          </div>
          <span className="access-tag">
            <LockKeyhole size={14} /> ADMIN & ABOVE
          </span>
        </div>
        <div className="work-grid">
          <div className="main-column">
            <section className="panel rank-panel" aria-labelledby="rank-title">
              <div className="panel-heading">
                <div className="section-title">
                  <span className="section-index">01</span>
                  <h2 id="rank-title">Rank directory</h2>
                  <span className="count-chip">{state.roles.length} ROLES</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Refresh ranks"
                  onClick={() => void refresh()}
                  disabled={working}
                >
                  <RefreshCw size={16} />
                </Button>
              </div>
              <div className="rank-scroll">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="rank-number-column">RANK</TableHead>
                      <TableHead>ROLE NAME</TableHead>
                      <TableHead className="role-id-column">ROLE ID</TableHead>
                      <TableHead className="copy-column">
                        <span className="sr-only">Use rank</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.roles.map((role) => (
                      <TableRow key={role.id}>
                        <TableCell>
                          <span
                            className={`rank-number ${role.rank >= 9 ? "staff-rank" : ""}`}
                          >
                            {String(role.rank).padStart(2, "0")}
                          </span>
                        </TableCell>
                        <TableCell className="role-name">
                          {role.name}
                          {role.rank === 255 && (
                            <span className="protected-label">PROTECTED</span>
                          )}
                        </TableCell>
                        <TableCell className="role-id">{role.id}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Use ${role.name} role ID`}
                            onClick={() =>
                              fill(
                                command.trim()
                                  ? command.trim().replace(/\s+\d+$/, "") +
                                      ` ${role.id}`
                                  : `Promote username ${role.id}`,
                              )
                            }
                          >
                            <CornerDownLeft size={14} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="panel-footnote">
                Use a rank number or full role ID. When ranks repeat, use the
                role ID.
              </div>
            </section>
            <section
              className="panel command-panel"
              aria-labelledby="command-title"
            >
              <div className="panel-heading">
                <div className="section-title">
                  <span className="section-index">02</span>
                  <h2 id="command-title">Command console</h2>
                </div>
                <Terminal size={18} className="muted-icon" />
              </div>
              <div className="command-body">
                {suggestions.length > 0 && (
                  <div
                    className="suggestions"
                    aria-label="Username suggestions"
                  >
                    <span className="eyebrow">COMMUNITY MEMBERS</span>
                    {suggestions.map((member) => (
                      <button
                        key={member.id}
                        onClick={() => {
                          fill(command.replace(/\S+$/, member.username) + " ");
                          setSuggestions([]);
                        }}
                      >
                        {member.avatar ? (
                          <img
                            src={member.avatar}
                            alt=""
                            width={36}
                            height={36}
                          />
                        ) : (
                          <Users size={30} />
                        )}
                        <span>
                          <strong>{member.displayName}</strong>
                          <small>@{member.username}</small>
                        </span>
                        <CornerDownLeft size={14} />
                      </button>
                    ))}
                  </div>
                )}
                <form onSubmit={preview} className="command-form">
                  <span aria-hidden="true" className="prompt-chevron">
                    ›
                  </span>
                  <Input
                    ref={input}
                    value={command}
                    onChange={(e) => {
                      setCommand(e.target.value);
                      setJob(null);
                    }}
                    placeholder="Promote username 7"
                    aria-label="Ranking command"
                    maxLength={240}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={working}
                    className="command-input"
                  />
                  <Button
                    type="submit"
                    disabled={!canCommand || working || !command.trim()}
                    className="run-button"
                  >
                    {busy === "preview" ? (
                      <LoaderCircle className="spin" />
                    ) : (
                      <CornerDownLeft />
                    )}
                    <span>Review</span>
                  </Button>
                </form>
                <div className="command-examples">
                  {[
                    ["Promote", "Promote username 7", ArrowUp],
                    ["Demote", "Demote username 1", ArrowDown],
                    ["Promote all", "Promote all 4", Users],
                    ["Demote all", "Demote all 1", Users],
                    ["Kick", "Kick username", X],
                    ["Ban", "Ban username", ShieldCheck],
                  ].map(([label, example, Icon]) => {
                    const Symbol = Icon as typeof Users;
                    return (
                      <button
                        key={label as string}
                        onClick={() => fill(example as string)}
                      >
                        <Symbol size={13} />
                        {label as string}
                      </button>
                    );
                  })}
                </div>
                {!canCommand && (
                  <p className="command-note">
                    <LockKeyhole size={14} />
                    {signedIn
                      ? "Verify an Admin-or-higher Roblox account to use commands."
                      : "Sign in and verify your Roblox account to use commands."}
                  </p>
                )}
                <div className="command-examples">
                  <button onClick={() => fill("Check Roles username")}>
                    <Users size={13} />
                    Check Roles
                  </button>
                  {state.staff && state.staff.rank >= 14 && (
                    <>
                      <button onClick={() => fill("Kick all")}>
                        <X size={13} />
                        Kick all
                      </button>
                      <button onClick={() => fill("Ban all")}>
                        <ShieldCheck size={13} />
                        Ban all
                      </button>
                    </>
                  )}
                </div>
                {error && (
                  <div role="alert" className="feedback error-feedback">
                    {error}
                  </div>
                )}
                {message && (
                  <div role="status" className="feedback success-feedback">
                    <Check size={16} />
                    {message}
                  </div>
                )}
                {state.notice && (
                  <div className="feedback notice-feedback">{state.notice}</div>
                )}
                {inspection && (
                  <div className="job-review">
                    <div className="staff-identity">
                      {inspection.avatar && (
                        <img
                          src={inspection.avatar}
                          alt=""
                          width={45}
                          height={45}
                        />
                      )}
                      <div>
                        <strong>{inspection.displayName}</strong>
                        <span>@{inspection.username}</span>
                      </div>
                    </div>
                    <p>
                      {inspection.roles.length
                        ? `${inspection.roles.length} assigned roles`
                        : "This user is not a member of the community."}
                    </p>
                    {inspection.roles.map((role) => (
                      <div className="checked-role" key={role.id}>
                        <strong>{role.name}</strong>
                        <span>
                          Rank {role.rank} · ID {role.id}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {job && (
                  <div className="job-review">
                    <div className="job-title">
                      <span className="eyebrow">
                        {job.status === "preview"
                          ? "REVIEW CHANGES"
                          : "COMMAND RESULT"}
                      </span>
                      <span className="count-chip">
                        {job.status.toUpperCase()}
                      </span>
                    </div>
                    <code>{job.command}</code>
                    <p>
                      <strong>{job.total}</strong> eligible{" "}
                      {job.total === 1 ? "member" : "members"}
                      {job.target_role_name ? (
                        <>
                          {" "}
                          → <strong>{job.target_role_name}</strong>
                        </>
                      ) : (
                        ""
                      )}
                      .{" "}
                      {job.skipped > 0 &&
                        `${job.skipped} excluded or unchanged.`}
                    </p>
                    {job.target_role_name && job.status === "preview" && (
                      <p className="small-note">This replaces previous non-base roles with the selected role. The base Member role stays.</p>
                    )}
                    {job.total > 0 && job.status !== "preview" && (
                      <>
                        <Progress
                          value={
                            ((job.completed + job.failed) / job.total) * 100
                          }
                          aria-label="Command progress"
                        />
                        <p className="small-note">
                          {job.completed} completed · {job.failed} failed
                        </p>
                      </>
                    )}
                    {job.error && <p className="error-text">{job.error}</p>}
                    {["preview", "queued", "running"].includes(job.status) &&
                      job.total > 0 && (
                        <div className="job-actions">
                          <Button
                            onClick={() => void execute(job)}
                            disabled={working || !canCommand}
                          >
                            {busy === "execute" && (
                              <LoaderCircle className="spin" />
                            )}
                            {job.status === "preview"
                              ? `Apply to ${job.total} ${job.total === 1 ? "member" : "members"}`
                              : "Resume command"}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => setJob(null)}
                            disabled={working}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                  </div>
                )}
              </div>
            </section>
          </div>
          <aside className="side-column">
            <section className="panel staff-panel">
              <div className="panel-heading">
                <div className="section-title">
                  <ShieldCheck size={17} />
                  <h2>Staff access</h2>
                </div>
              </div>
              <div className="staff-body">
                {state.staff ? (
                  <>
                    <div className="staff-identity">
                      {state.staff.avatar ? (
                        <img
                          src={state.staff.avatar}
                          alt=""
                          width={52}
                          height={52}
                        />
                      ) : (
                        <Users size={40} />
                      )}
                      <div>
                        <strong>{state.staff.displayName}</strong>
                        <span>@{state.staff.username}</span>
                      </div>
                    </div>
                    <div className="verified-rank">
                      <span>{state.staff.role}</span>
                      <span>RANK {state.staff.rank}</span>
                    </div>
                    <p className="small-note">
                      Your rank is checked again before every change.
                    </p>
                  </>
                ) : (
                  <>
                    <span className="access-illustration">
                      <LockKeyhole size={27} strokeWidth={1.5} />
                    </span>
                    <h3>
                      {signedIn
                        ? "Connect your Roblox account"
                        : "Your community. Your command."}
                    </h3>
                    <p>
                      {signedIn
                        ? "Verify your profile once to confirm this Roblox account belongs to you."
                        : "Commands are available to verified community members ranked Admin or higher."}
                    </p>
                    {signedIn ? (
                      <div className="verification">
                        <label htmlFor="verify-username">
                          Exact Roblox username
                        </label>
                        <Input
                          id="verify-username"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          placeholder="YourUsername"
                          disabled={working || !!proof}
                          maxLength={20}
                        />
                        {proof ? (
                          <>
                            <p>
                              Add this code to your Roblox{" "}
                              <strong>About</strong> description, then verify.
                            </p>
                            <button
                              className="proof-code"
                              onClick={async () => {
                                await navigator.clipboard.writeText(proof.code);
                                setCopied(true);
                              }}
                            >
                              {proof.code}
                              {copied ? (
                                <Check size={14} />
                              ) : (
                                <Copy size={14} />
                              )}
                            </button>
                            <a
                              className="text-link"
                              href={`https://www.roblox.com/users/${proof.userId}/profile`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open Roblox profile <ExternalLink size={13} />
                            </a>
                            <p className="small-note">
                              Expires in 10 minutes. Remove the code after
                              verification.
                            </p>
                            <Button
                              onClick={() => void verify("verifyProfile")}
                              disabled={working}
                            >
                              {working && <LoaderCircle className="spin" />}
                              Verify profile
                            </Button>
                            <button
                              className="text-link"
                              onClick={() => setProof(null)}
                              disabled={working}
                            >
                              Use another username
                            </button>
                          </>
                        ) : (
                          <Button
                            onClick={() => void verify("beginVerification")}
                            disabled={
                              working || !username.trim() || !state.ready
                            }
                          >
                            {working && <LoaderCircle className="spin" />}Get
                            verification code
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Button asChild className="w-full">
                        <a
                          href="/signin-with-chatgpt?return_to=/"
                          target="_top"
                        >
                          Sign in to continue <ChevronRight />
                        </a>
                      </Button>
                    )}
                  </>
                )}
              </div>
            </section>
            <section className="rules-panel">
              <p className="eyebrow">COMMAND GUIDE</p>
              <div>
                <code>Promote username 7</code>
                <p>Move one member to a higher rank.</p>
              </div>
              <div>
                <code>Demote all 1</code>
                <p>Move eligible members to a lower rank.</p>
              </div>
              <div>
                <code>Kick all / Ban all</code>
                <p>Management 14+ only. Named members: Admin 9+.</p>
              </div>
              <div className="rule-divider" />
              <p>
                Use usernames, not display names. You can only manage members
                and roles below your own rank.
              </p>
              <p>Bulk changes always require a review.</p>
            </section>
          </aside>
        </div>
        {signedIn && state.staff && (
          <section className="panel history-panel">
            <div className="panel-heading">
              <div className="section-title">
                <span className="section-index">03</span>
                <h2>Your recent commands</h2>
              </div>
              <span className="small-note">Saved history</span>
            </div>
            {state.jobs.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>COMMAND</TableHead>
                    <TableHead>STATUS</TableHead>
                    <TableHead>COMPLETED</TableHead>
                    <TableHead>TIME</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.jobs.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="history-command">
                        {item.command}
                      </TableCell>
                      <TableCell>{item.status}</TableCell>
                      <TableCell>
                        {item.completed} / {item.total}
                      </TableCell>
                      <TableCell className="small-note">
                        {new Date(item.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {["queued", "running"].includes(item.status) && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={working}
                            onClick={() => {
                              setJob(item);
                              void execute(item);
                            }}
                          >
                            Resume
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="empty-history">
                <Terminal size={20} />
                <span>Your command history will appear here.</span>
              </div>
            )}
          </section>
        )}
        <footer className="footer">
          <span>
            AUTHORITY <span>/</span> COMMUNITY RANKING
          </span>
          <span>
            COMMUNITY 526651322 <span>/</span> ADMIN 9+
          </span>
        </footer>
      </main>
    </div>
  );
}
