import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { communicationsApi } from "../../api/communications";
import { useAuth } from "../../auth/AuthContext.jsx";
import StatusBadge from "../../components/common/StatusBadge.jsx";
import { PageLoader } from "../../components/common/Spinner.jsx";
import LoadError from "../../components/common/LoadError.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { SUPPORT_TYPE_LABELS, extractErrorMessage, formatDateRange } from "../../utils/format";
import RequestMessages from "./RequestMessages.jsx";

export default function CommsRequestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isCommunications, isCommunicationsLead, user } = useAuth();
  const { showToast } = useToast();
  const [request, setRequest] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [team, setTeam] = useState([]);
  const [assigneeSelection, setAssigneeSelection] = useState([]);
  const [isSavingAssignment, setIsSavingAssignment] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState("");

  async function load({ silent = false } = {}) {
    if (!silent) setIsLoading(true);
    setLoadError(null);
    try {
      const { data } = await communicationsApi.retrieveSupportRequest(id);
      setRequest(data);
      setAssigneeSelection((data.assigned_to || []).map((u) => u.id));
    } catch (error) {
      setLoadError(extractErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Support Requests Enhancement: only the Lead ever needs the full team
  // roster (to build the assignment control), so it's fetched lazily
  // rather than for every viewer of this page.
  useEffect(() => {
    if (!isCommunicationsLead) return;
    communicationsApi
      .listCommunicationsTeam()
      .then(({ data }) => setTeam(data.results || data))
      .catch(() => setTeam([]));
  }, [isCommunicationsLead]);

  // Links with #messages-and-clarifications (event page, header badge) jump
  // to the conversation once the request has rendered.
  useEffect(() => {
    if (isLoading || !request || window.location.hash !== "#messages-and-clarifications") return;
    document.getElementById("messages-and-clarifications")?.scrollIntoView?.({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, request?.id]);

  async function toggleItem(item) {
    setTogglingId(item.id);
    try {
      await communicationsApi.toggleTodoItem(item.id, { is_done: !item.is_done, notes: item.notes });
      await load();
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setTogglingId(null);
    }
  }

  async function deleteItem(item) {
    if (!window.confirm(`Remove "${item.label}" from this checklist? This can't be undone.`)) return;
    setDeletingId(item.id);
    try {
      await communicationsApi.deleteTodoItem(item.id);
      showToast("To-do item removed.", "success");
      await load();
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setDeletingId(null);
    }
  }

  // The Save Assignment button only appears once the selection differs from
  // what is saved (someone was added or removed). After saving, the request
  // reloads, the selection matches again, and the button disappears.
  const savedAssigneeIds = (request?.assigned_to || []).map((u) => u.id);
  const hasAssignmentChanges =
    assigneeSelection.length !== savedAssigneeIds.length ||
    assigneeSelection.some((uid) => !savedAssigneeIds.includes(uid));

  function toggleAssignee(userId) {
    setAssigneeSelection((prev) =>
      prev.includes(userId) ? prev.filter((id_) => id_ !== userId) : [...prev, userId]
    );
  }

  async function saveAssignment() {
    setIsSavingAssignment(true);
    try {
      await communicationsApi.assignSupportRequest(id, assigneeSelection);
      showToast("Assignment updated.", "success");
      await load({ silent: true });
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSavingAssignment(false);
    }
  }

  if (loadError) return <LoadError message={loadError} onRetry={load} />;
  if (isLoading || !request) return <PageLoader />;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <button onClick={() => navigate(-1)} className="jm-back-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
          Back
        </button>
        <h1 className="text-2xl mt-2">{request.event_title}</h1>
        <p className="text-sm text-ink-muted">
          {[request.event_owner, formatDateRange(request.event_start_date, request.event_end_date), request.venue].filter(Boolean).join(", ")}
        </p>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge label={request.priority_label} />
          <StatusBadge label={request.status_display} />
          {request.unread_count > 0 && (
            <a
              href="#messages-and-clarifications"
              className="inline-flex items-center rounded-full bg-ems-primary text-white text-xs font-semibold px-2.5 py-0.5"
              title="Unread messages in Messages & Clarifications"
            >
              {request.unread_count} unread {request.unread_count === 1 ? "message" : "messages"}
            </a>
          )}
        </div>
        <div>
          <p className="text-xs text-ink-faint uppercase tracking-wide mb-1">Support Types Requested</p>
          <ul className="space-y-1.5">
            {request.support_types?.map((type) => {
              const description = request.support_details?.[type];
              return (
                <li key={type} className="text-sm">
                  <span className="text-ink font-medium">{SUPPORT_TYPE_LABELS[type]}</span>
                  {description && <span className="text-ink-muted">: {description}</span>}
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <p className="text-xs text-ink-faint uppercase tracking-wide mb-0.5">Notes</p>
          <p className="text-sm text-ink">{request.notes || "N/A"}</p>
        </div>
      </div>

      {/* Assignment (Lead-only): searchable multi-select. The Lead can add,
          remove or replace assignees at any time, including themselves. */}
      {isCommunicationsLead && (
        <div className="card p-5">
          <h3 className="text-base mb-1">Assign Communications Staff</h3>
          <p className="text-xs text-ink-faint mb-3">
            Search and select one or more team members, including yourself, to work this request.
          </p>
          {assigneeSelection.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {assigneeSelection.map((uid) => {
                const member = team.find((m) => m.id === uid) || request.assigned_to?.find((m) => m.id === uid);
                return (
                  <span
                    key={uid}
                    className="inline-flex items-center gap-1 rounded-full bg-navy-50 text-navy-700 pl-3 pr-1.5 py-1 text-sm"
                  >
                    {member?.name || "Unknown"}
                    <button
                      type="button"
                      onClick={() => toggleAssignee(uid)}
                      aria-label={`Remove ${member?.name || "assignee"}`}
                      className="h-5 w-5 rounded-full hover:bg-navy-100 text-navy-700 leading-none"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <input
            type="search"
            className="form-input w-full mb-2"
            placeholder="Search team members..."
            value={assigneeSearch}
            onChange={(e) => setAssigneeSearch(e.target.value)}
          />
          <div className="max-h-48 overflow-y-auto border border-line rounded-md divide-y divide-line mb-4">
            {team
              .filter((m) => m.name.toLowerCase().includes(assigneeSearch.trim().toLowerCase()))
              .map((member) => (
                <label key={member.id} className="flex items-center gap-2 px-3 py-2 text-sm text-ink cursor-pointer hover:bg-surface-muted">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-line"
                    checked={assigneeSelection.includes(member.id)}
                    onChange={() => toggleAssignee(member.id)}
                  />
                  {member.name}
                  {member.id === user?.id && <span className="text-ink-faint text-xs">(you)</span>}
                </label>
              ))}
            {team.length > 0 &&
              !team.some((m) => m.name.toLowerCase().includes(assigneeSearch.trim().toLowerCase())) && (
                <p className="px-3 py-2 text-sm text-ink-faint">No team members match your search.</p>
              )}
          </div>
          {hasAssignmentChanges && (
            <button
              type="button"
              className="btn-primary px-4 py-1.5 text-sm"
              disabled={isSavingAssignment}
              onClick={saveAssignment}
            >
              {isSavingAssignment ? "Saving..." : "Save Assignment"}
            </button>
          )}
        </div>
      )}

      {/* Messages & Clarifications sits directly below the status and
          assignment blocks. */}
      <RequestMessages request={request} onRequestChanged={() => load({ silent: true })} />

      <div className="card p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base">To-Do List</h3>
        </div>
        <p className="text-xs text-ink-faint mb-3">
          Completing this checklist is optional. It's a tracking aid only{isCommunications ? "" : ", managed by the Communications team"}.
        </p>
        <ul className="space-y-2">
          {request.todo_items.map((item) => (
            <li key={item.id} className="group flex items-center gap-3 py-2 border-b border-line last:border-0">
              <input
                type="checkbox"
                checked={item.is_done}
                disabled={!isCommunications || togglingId === item.id || deletingId === item.id}
                onChange={() => toggleItem(item)}
                className="h-4 w-4 rounded border-line disabled:opacity-60"
              />
              <div className="flex-1">
                <p className={item.is_done ? "text-sm text-ink-faint line-through" : "text-sm text-ink"}>
                  {item.label}
                </p>
                {item.is_done && item.completed_at && (
                  <p className="text-xs text-ink-faint">Completed {new Date(item.completed_at).toLocaleDateString()}</p>
                )}
              </div>
              {isCommunications && (
                <button
                  type="button"
                  onClick={() => deleteItem(item)}
                  disabled={deletingId === item.id || togglingId === item.id}
                  title="Delete this to-do item"
                  className="shrink-0 text-ink-faint hover:text-ems-primary disabled:opacity-40 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" />
                    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
