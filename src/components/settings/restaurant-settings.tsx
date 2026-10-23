"use client";

import { useEffect, useState } from "react";

import { CommitInput } from "@/components/menu-editor/fields";
import { TeamActivity } from "@/components/settings/team-activity";
import { GuidanceCard } from "@/components/ui/guidance-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  addMember,
  deleteRestaurant,
  fetchMembers,
  fetchPendingInvitations,
  fetchRestaurants,
  removeMember,
  renameRestaurant,
  resendInvitation,
  revokeInvitation,
  updateMemberRole,
  type MemberOption,
  type PendingInvitation,
  type RestaurantOption,
} from "@/features/tenancy/client";

/**
 * Restaurant settings: rename inline, manage the team (owner-only writes),
 * and delete behind a danger zone that spells out what cascades. Members
 * can see the team; the writes refuse non-owners server-side too, so the UI
 * never has to guess — it just reports what the API answered.
 *
 * The team panel is keyed by restaurant id, so switching restaurants
 * remounts it with fresh state instead of resetting state in effects.
 */

interface RestaurantSettingsProps {
  signedIn: boolean;
  /** The signed-in user id, to mark their own row in the team list. */
  currentUserId: string | null;
}

export function RestaurantSettings({ signedIn, currentUserId }: RestaurantSettingsProps) {
  const [restaurants, setRestaurants] = useState<RestaurantOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after each successful team change so the activity card reloads.
  const [teamVersion, setTeamVersion] = useState(0);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchRestaurants();
        if (cancelled) return;
        setRestaurants(list);
        const owners = list.filter((r) => r.role === "owner");
        if (owners.length === 1 && owners[0]) setSelectedId(owners[0].id);
      } catch {
        if (!cancelled) {
          setLoadError("Could not load your restaurants. Check your connection and try again.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const owned = restaurants?.filter((r) => r.role === "owner") ?? [];
  const staffOnly = restaurants !== null && owned.length === 0 && restaurants.length > 0;
  const selected = owned.find((r) => r.id === selectedId) ?? null;

  async function handleRename(name: string) {
    if (!selected) return;
    const previous = selected.name;
    setRestaurants((prev) => (prev ?? []).map((r) => (r.id === selected.id ? { ...r, name } : r)));
    try {
      const updated = await renameRestaurant(selected.id, name);
      setRestaurants((prev) => (prev ?? []).map((r) => (r.id === updated.id ? updated : r)));
    } catch {
      // Roll the optimistic edit back so the field shows the truth again.
      setRestaurants((prev) =>
        (prev ?? []).map((r) => (r.id === selected.id ? { ...r, name: previous } : r))
      );
      setError("Could not rename the restaurant. Try again.");
    }
  }

  async function handleDeleteRestaurant() {
    if (!selected || deleting) return;
    if (
      !window.confirm(
        `Delete “${selected.name}” permanently? Its menus, published pages and orders are deleted too. This cannot be undone.`
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteRestaurant(selected.id);
      setRestaurants((prev) => (prev ?? []).filter((r) => r.id !== selected.id));
      setSelectedId("");
    } catch {
      setError("Could not delete the restaurant. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-bold text-stone-900">Restaurant settings</h2>

      {!signedIn && (
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <p className="text-sm font-medium text-stone-900">Sign in to manage your restaurants</p>
          <p className="mt-1 text-xs leading-5 text-stone-500">
            Restaurant names, team members and deletion live in your account.
          </p>
          <a
            href="/sign-in"
            className="mt-3 inline-block rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          >
            Sign in
          </a>
        </div>
      )}

      {signedIn && loadError && <p className="text-xs text-red-700">{loadError}</p>}

      {signedIn && restaurants === null && !loadError && (
        <div role="status" aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">Loading your restaurants…</span>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-3 h-9 w-full max-w-sm" />
            <Skeleton className="mt-3 h-3 w-2/5" />
            <div className="mt-4 flex gap-2">
              <Skeleton className="h-8 w-28 rounded-full" />
              <Skeleton className="h-8 w-20 rounded-full" />
            </div>
          </div>
        </div>
      )}

      {staffOnly && (
        <p className="rounded-2xl border border-stone-200 bg-white p-5 text-xs leading-5 text-amber-800">
          You are only a staff member of the restaurants on this account. Only an owner can change
          settings — ask the owner to do it from their sign-in.
        </p>
      )}

      {signedIn && restaurants !== null && owned.length === 0 && !staffOnly && (
        <GuidanceCard
          title="You don't own a restaurant yet"
          steps={[
            "Open My menus and pick a menu — upload a photo first if you don't have one yet.",
            "Use “Move my menus to my account” on it: moving a menu creates the restaurant that owns it.",
            "Come back here to rename it, staff it, or delete it.",
          ]}
          action={{ href: "/menus", label: "Go to My menus" }}
        />
      )}

      {owned.length > 0 && (
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
            Restaurant
            <select
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              <option value="" disabled>
                Choose a restaurant…
              </option>
              {owned.map((restaurant) => (
                <option key={restaurant.id} value={restaurant.id}>
                  {restaurant.name}
                </option>
              ))}
            </select>
          </label>

          {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
        </div>
      )}

      {selected && (
        <>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <h3 className="text-sm font-bold tracking-tight text-stone-900">Name</h3>
            <p className="mt-1 text-xs leading-5 text-stone-500">
              Shown to your team and on your published menu pages.
            </p>
            <div className="mt-2 max-w-sm">
              <CommitInput
                label={`Rename ${selected.name}`}
                value={selected.name}
                onCommit={(name) => void handleRename(name)}
              />
            </div>
          </div>

          <TeamCard
            key={selected.id}
            restaurantId={selected.id}
            restaurantName={selected.name}
            currentUserId={currentUserId}
            onTeamChanged={() => setTeamVersion((version) => version + 1)}
          />

          <TeamActivity
            key={`activity-${selected.id}`}
            restaurantId={selected.id}
            refreshKey={teamVersion}
          />

          <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
            <h3 className="text-sm font-bold tracking-tight text-red-900">Danger zone</h3>
            <p className="mt-1 text-xs leading-5 text-red-800">
              Deleting “{selected.name}” removes its menus, published pages and orders from your
              account. This cannot be undone.
            </p>
            <button
              type="button"
              onClick={() => void handleDeleteRestaurant()}
              disabled={deleting}
              className="mt-3 rounded-full border border-red-700 px-4 py-1.5 text-sm font-semibold text-red-800 transition-colors hover:bg-red-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
            >
              {deleting ? "Deleting…" : `Delete ${selected.name}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

interface TeamCardProps {
  restaurantId: string;
  restaurantName: string;
  currentUserId: string | null;
  /** Called after a change lands, so the audit trail can reload. */
  onTeamChanged: () => void;
}

/** The team list plus add/role/remove controls, scoped to one restaurant. */
function TeamCard({ restaurantId, restaurantName, currentUserId, onTeamChanged }: TeamCardProps) {
  const [members, setMembers] = useState<MemberOption[] | null>(null);
  const [pending, setPending] = useState<PendingInvitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<"owner" | "staff">("staff");
  const [adding, setAdding] = useState(false);
  const [memberBusy, setMemberBusy] = useState<string | null>(null);
  const [pendingBusy, setPendingBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchMembers(restaurantId);
        if (!cancelled) setMembers(list);
      } catch {
        if (!cancelled) setError("Could not load the team. Check your connection and try again.");
      }
    })();
    // Pending invitations are optional chrome: if this fails, the member
    // list still renders (and the server still enforces the roles).
    void (async () => {
      try {
        const list = await fetchPendingInvitations(restaurantId);
        if (!cancelled) setPending(list);
      } catch {
        if (!cancelled) setPending([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  async function refreshPending() {
    try {
      setPending(await fetchPendingInvitations(restaurantId));
    } catch {
      // Keep whatever list we had; the next load will retry.
    }
  }

  async function handleResend(invitation: PendingInvitation) {
    if (pendingBusy) return;
    setPendingBusy(invitation.id);
    setError(null);
    setNotice(null);
    try {
      await resendInvitation(restaurantId, invitation.id);
      setNotice(
        `Invitation re-sent to ${invitation.email}. The previous link no longer works.`
      );
    } catch (resendError) {
      setError(
        resendError instanceof Error ? resendError.message : "Could not resend the invitation."
      );
    } finally {
      setPendingBusy(null);
      // The link is rotated before the email is sent, so a failed delivery
      // still changed the row (and left an audit event) — re-read both.
      await refreshPending();
      onTeamChanged();
    }
  }

  async function handleRevoke(invitation: PendingInvitation) {
    if (pendingBusy) return;
    setPendingBusy(invitation.id);
    setError(null);
    setNotice(null);
    try {
      await revokeInvitation(restaurantId, invitation.id);
      setPending((prev) => prev?.filter((row) => row.id !== invitation.id) ?? prev);
      setNotice(`Invitation to ${invitation.email} revoked. The emailed link no longer works.`);
    } catch (revokeError) {
      setError(
        revokeError instanceof Error ? revokeError.message : "Could not revoke the invitation."
      );
    } finally {
      setPendingBusy(null);
      onTeamChanged();
    }
  }

  async function handleAddMember() {
    const email = addEmail.trim();
    if (!email || adding) return;
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      const result = await addMember(restaurantId, email, addRole);
      if (result.kind === "member") {
        setMembers((prev) => [...(prev ?? []), result.member]);
        setNotice(`${result.member.name} joined as ${result.member.role}.`);
      } else {
        setNotice(
          `Invitation emailed to ${result.invitation.email}. They'll join as ${result.invitation.role} once they accept it.`
        );
      }
      setAddEmail("");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Could not add the member. Try again.");
    } finally {
      setAdding(false);
      // A failed delivery can still leave a pending invitation (the row is
      // written before the email is sent) — show it so it can be resent or
      // revoked instead of silently lingering, and reload the trail since
      // the invitation itself was recorded.
      await refreshPending();
      onTeamChanged();
    }
  }

  async function handleRoleChange(member: MemberOption, role: "owner" | "staff") {
    if (memberBusy) return;
    setMemberBusy(member.userId);
    setError(null);
    try {
      const updated = await updateMemberRole(restaurantId, member.userId, role);
      setMembers((prev) => prev?.map((m) => (m.userId === updated.userId ? updated : m)) ?? prev);
      onTeamChanged();
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : "Could not change the role. Try again.");
      try {
        // The row must show the server's truth after a refused change.
        setMembers(await fetchMembers(restaurantId));
      } catch {
        // Keep the error message; the list may be one edit behind.
      }
    } finally {
      setMemberBusy(null);
    }
  }

  async function handleRemoveMember(member: MemberOption) {
    if (memberBusy) return;
    if (
      !window.confirm(
        `Remove “${member.name}” from ${restaurantName}? They lose access to its menus and orders.`
      )
    ) {
      return;
    }
    setMemberBusy(member.userId);
    setError(null);
    try {
      await removeMember(restaurantId, member.userId);
      setMembers((prev) => prev?.filter((m) => m.userId !== member.userId) ?? prev);
      onTeamChanged();
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : "Could not remove the member. Try again."
      );
    } finally {
      setMemberBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <h3 className="text-sm font-bold tracking-tight text-stone-900">Team</h3>
      <p className="mt-1 text-xs leading-5 text-stone-500">
        Owners can change menus, publish and manage the team. Staff see the order board and the
        menus.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-stone-600">
          Add by email
          <input
            type="email"
            value={addEmail}
            onChange={(event) => setAddEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleAddMember();
            }}
            placeholder="teammate@cafe.com"
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
          Role
          <select
            value={addRole}
            onChange={(event) => setAddRole(event.target.value as "owner" | "staff")}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          >
            <option value="staff">Staff</option>
            <option value="owner">Owner</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void handleAddMember()}
          disabled={adding || addEmail.trim().length === 0}
          className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          {adding ? "Adding…" : "Add member"}
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-stone-400">
        If they already have an account they join immediately; otherwise we email them a one-time
        invitation link that accepts on sign-in (expires in 7 days).
      </p>

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      {notice && !error && <p className="mt-2 text-xs text-emerald-800">{notice}</p>}

      {members === null && !error && (
        <div role="status" aria-busy="true" className="mt-3 flex flex-col gap-2">
          <span className="sr-only">Loading the team…</span>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="flex items-center gap-3 rounded-xl border border-stone-200 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="mt-1.5 h-3 w-1/2" />
              </div>
              <Skeleton className="h-7 w-24 rounded-full" />
            </div>
          ))}
        </div>
      )}

      {members !== null && (
        <ul className="mt-3 space-y-2">
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-stone-900">
                  {member.name.trim() ? member.name : member.email}
                  {member.userId === currentUserId && (
                    <span className="ml-1 text-xs font-normal text-stone-400">(you)</span>
                  )}
                </p>
                <p className="truncate text-xs text-stone-500">{member.email}</p>
              </div>
              <select
                value={member.role}
                onChange={(event) =>
                  void handleRoleChange(member, event.target.value as "owner" | "staff")
                }
                disabled={memberBusy === member.userId}
                aria-label={`Role for ${member.name}`}
                className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="owner">Owner</option>
                <option value="staff">Staff</option>
              </select>
              <button
                type="button"
                onClick={() => void handleRemoveMember(member)}
                disabled={memberBusy === member.userId}
                className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:border-red-700 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {pending !== null && pending.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold tracking-wide text-amber-900 uppercase">
            Pending invitations
          </p>
          <ul className="mt-2 space-y-2">
            {pending.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-stone-900">
                    {invitation.email}
                  </p>
                  <p className="text-[11px] leading-4 text-stone-500">
                    {invitation.role === "owner" ? "Owner" : "Staff"} · invited by{" "}
                    {invitation.invitedByName.trim() || "a teammate"} · expires{" "}
                    {new Date(invitation.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleResend(invitation)}
                  disabled={pendingBusy === invitation.id}
                  className="rounded-full border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-stone-700 transition-colors hover:border-amber-700 hover:text-amber-900 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                >
                  Resend
                </button>
                <button
                  type="button"
                  onClick={() => void handleRevoke(invitation)}
                  disabled={pendingBusy === invitation.id}
                  className="rounded-full border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:border-red-700 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
