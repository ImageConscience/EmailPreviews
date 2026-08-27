"use client";

import { useActionState, useState, useTransition } from "react";
import {
  changeRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInviteAction,
  type FormState,
} from "@/actions/members";
import { SubmitButton } from "@/components/SubmitButton";
import type { Role } from "@/lib/auth";

interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  token: string;
  expiresAt: string;
}

const initial: FormState = {};

export function MembersPanel({
  companyId,
  currentUserId,
  currentRole,
  members,
  invites,
}: {
  companyId: string;
  currentUserId: string;
  currentRole: Role;
  members: Member[];
  invites: Invite[];
}) {
  const [state, invite] = useActionState(inviteMemberAction.bind(null, companyId), initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canManage = currentRole !== "member";

  const run = (fn: () => Promise<void>) =>
    startTransition(async () => {
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That did not work.");
      }
    });

  const inviteUrl = state.inviteUrl
    ? `${typeof window === "undefined" ? "" : window.location.origin}${state.inviteUrl}`
    : null;

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="card-head">
          <h2>Members</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th className="tight">Role</th>
              <th className="tight">Joined</th>
              {canManage && <th className="tight" />}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const isSelf = member.userId === currentUserId;
              return (
                <tr key={member.id}>
                  <td>
                    <strong>{member.name}</strong>
                    {isSelf && <span className="badge" style={{ marginLeft: 6 }}>you</span>}
                    <span className="hint">{member.email}</span>
                  </td>
                  <td className="tight">
                    {canManage && !isSelf ? (
                      <select
                        value={member.role}
                        disabled={pending}
                        onChange={(e) =>
                          run(() => changeRoleAction(companyId, member.id, e.target.value as Role))
                        }
                        style={{ width: "auto" }}
                      >
                        <option value="member">member</option>
                        <option value="admin">admin</option>
                        {currentRole === "owner" && <option value="owner">owner</option>}
                      </select>
                    ) : (
                      <span className="badge">{member.role}</span>
                    )}
                  </td>
                  <td className="tight hint">{member.joinedAt}</td>
                  {canManage && (
                    <td className="tight">
                      {!isSelf && (
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          disabled={pending}
                          onClick={() => {
                            if (!window.confirm(`Remove ${member.email} from this company?`)) return;
                            run(() => removeMemberAction(companyId, member.id));
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canManage && (
        <div className="card card-pad" style={{ marginTop: 14 }}>
          <h2 style={{ marginBottom: 12 }}>Invite someone</h2>
          <form action={invite}>
            {state.error && <div className="alert alert-error">{state.error}</div>}
            {state.ok && <div className="alert alert-ok">{state.ok}</div>}
            {inviteUrl && (
              <label className="field">
                <span>Invitation link</span>
                <input type="text" readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
                <span className="hint">
                  The app does not send email, so pass this link along yourself. It expires in 14
                  days.
                </span>
              </label>
            )}
            <div className="row" style={{ alignItems: "flex-end", gap: 12 }}>
              <label className="field" style={{ flex: "1 1 240px", marginBottom: 0 }}>
                <span>Email</span>
                <input type="email" name="email" required placeholder="teammate@example.com" />
              </label>
              <label className="field" style={{ flex: "0 0 140px", marginBottom: 0 }}>
                <span>Role</span>
                <select name="role" defaultValue="member">
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </label>
              <SubmitButton pendingLabel="Creating…">Create invitation</SubmitButton>
            </div>
          </form>
        </div>
      )}

      {canManage && invites.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-head">
            <h2>Pending invitations</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th className="tight">Role</th>
                <th className="tight">Expires</th>
                <th>Link</th>
                <th className="tight" />
              </tr>
            </thead>
            <tbody>
              {invites.map((item) => (
                <tr key={item.id}>
                  <td>{item.email}</td>
                  <td className="tight">
                    <span className="badge">{item.role}</span>
                  </td>
                  <td className="tight hint">{item.expiresAt}</td>
                  <td>
                    <input
                      type="text"
                      readOnly
                      value={`/signup?invite=${item.token}`}
                      onFocus={(e) => e.target.select()}
                      style={{ fontSize: 12 }}
                    />
                  </td>
                  <td className="tight">
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={pending}
                      onClick={() => run(() => revokeInviteAction(companyId, item.id))}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
