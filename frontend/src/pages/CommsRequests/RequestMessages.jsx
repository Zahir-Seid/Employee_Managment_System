import { useEffect, useRef, useState } from "react";
import { communicationsApi } from "../../api/communications";
import { useAuth } from "../../auth/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { extractErrorMessage } from "../../utils/format";

// Must match the backend (apps/communications/attachments.py), which is the
// real enforcement; these only give early feedback.
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt";
const ALLOWED_EXT = ACCEPT.split(",");

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function downloadAttachment(att, showToast) {
  try {
    const { data } = await communicationsApi.fetchAttachmentBlob(att.url);
    const href = URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = href;
    link.download = att.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 5000);
  } catch (error) {
    showToast("Couldn't download that file.", "error");
  }
}

// Image attachment: thumbnail (loaded with the auth header) that opens larger.
function ImageAttachment({ att, onOpen }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let revoked = false;
    let href = null;
    communicationsApi
      .fetchAttachmentBlob(att.url)
      .then(({ data }) => {
        if (revoked) return;
        href = URL.createObjectURL(data);
        setSrc(href);
      })
      .catch(() => setSrc(null));
    return () => {
      revoked = true;
      if (href) URL.revokeObjectURL(href);
    };
  }, [att.url]);
  if (!src) return <div className="h-24 w-32 rounded-md bg-surface-sunken animate-pulse" aria-label={att.name} />;
  return (
    <button type="button" onClick={() => onOpen({ src, name: att.name })} title={att.name} className="block">
      <img src={src} alt={att.name} className="h-24 w-auto max-w-[200px] rounded-md border border-line object-cover" />
    </button>
  );
}

// Messages & Clarifications: the conversation attached to one Support
// Request, between the requester, the assigned Communications members and
// the Communications Lead. Everyone who can open the request can read it;
// only those three groups can post, and only while the request is open.
// Messages can't be edited or deleted.
export default function RequestMessages({ request, onRequestChanged }) {
  const { user, isCommunicationsLead } = useAuth();
  const { showToast } = useToast();
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [isClarification, setIsClarification] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [files, setFiles] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [dividerBeforeId, setDividerBeforeId] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const sectionRef = useRef(null);
  const fileInputRef = useRef(null);
  const initialLoadDone = useRef(false);
  const markedUpTo = useRef(null);

  const isRequester = !!user && request.event_owner_id === user.id;
  const isAssignedToMe = !!request.assigned_to?.some((u) => u.id === user?.id);
  const isParticipant = isRequester || isAssignedToMe || isCommunicationsLead;
  const isResolved = request.status === "completed" || request.status === "declined";
  const canPost = isParticipant && !isResolved;
  const canRequestClarification = canPost && !isRequester;

  async function loadMessages() {
    try {
      const { data } = await communicationsApi.listSupportRequestMessages(request.id);
      const list = data.results || data;
      setMessages(list);
      if (!initialLoadDone.current) {
        initialLoadDone.current = true;
        const firstUnread = list.find((m) => m.is_unread);
        setDividerBeforeId(firstUnread ? firstUnread.id : null);
      }
      return list;
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
      return [];
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    initialLoadDone.current = false;
    markedUpTo.current = null;
    setDividerBeforeId(null);
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id]);

  // Opening the conversation clears the unread state: once the thread is on
  // screen, tell the server the newest message has been seen. The divider
  // stays for this visit so the reader can still see where the new ones start.
  useEffect(() => {
    if (isLoading || !isParticipant || messages.length === 0) return undefined;
    const newest = messages[messages.length - 1].created_at;
    if (markedUpTo.current === newest) return undefined;
    const hasUnread = messages.some((m) => m.is_unread);
    if (!hasUnread) {
      markedUpTo.current = newest;
      return undefined;
    }
    let cancelled = false;
    async function markRead() {
      if (cancelled || markedUpTo.current === newest) return;
      markedUpTo.current = newest;
      try {
        await communicationsApi.markSupportRequestMessagesRead(request.id, newest);
        if (onRequestChanged) await onRequestChanged();
      } catch {
        markedUpTo.current = null;
      }
    }
    if (typeof IntersectionObserver === "undefined" || !sectionRef.current) {
      markRead();
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        markRead();
      }
    });
    observer.observe(sectionRef.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isLoading, isParticipant, request.id]);

  function addFiles(selected) {
    const next = [...files];
    for (const f of selected) {
      const ext = `.${(f.name.split(".").pop() || "").toLowerCase()}`;
      if (!ALLOWED_EXT.includes(ext)) {
        showToast(`'${f.name}': file type not allowed.`, "error");
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        showToast(`'${f.name}' is larger than 10 MB.`, "error");
        continue;
      }
      if (f.size === 0) {
        showToast(`'${f.name}' is empty.`, "error");
        continue;
      }
      if (next.length >= MAX_FILES) {
        showToast(`You can attach at most ${MAX_FILES} files per message.`, "error");
        break;
      }
      next.push(f);
    }
    setFiles(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function send(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body && files.length === 0) return;
    setIsSending(true);
    try {
      await communicationsApi.postSupportRequestMessage(request.id, {
        body,
        replyTo: replyTo?.id,
        isClarification: isClarification && canRequestClarification,
        files,
      });
      setDraft("");
      setIsClarification(false);
      setReplyTo(null);
      setFiles([]);
      const list = await loadMessages();
      // Your own message never counts as unread; keep the mark in step.
      if (list.length) markedUpTo.current = list[list.length - 1].created_at;
      // Posting can change the request's status (Needs Clarification /
      // Clarification Provided), so refresh the page's copy of it.
      if (onRequestChanged) await onRequestChanged();
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    } finally {
      setIsSending(false);
    }
  }

  function jumpTo(messageId) {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(messageId);
    setTimeout(() => setHighlightId((cur) => (cur === messageId ? null : cur)), 1800);
  }

  return (
    <div className="card p-5" ref={sectionRef} id="messages-and-clarifications">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-base">Messages &amp; Clarifications</h3>
        <button type="button" className="text-xs text-ink-faint hover:text-ink" onClick={loadMessages}>
          Refresh
        </button>
      </div>
      <p className="text-xs text-ink-faint mb-3">
        Conversation between the requester, the assigned Communications team members and the Communications Lead.
        Messages can't be edited or deleted.
      </p>

      <div className="space-y-3 max-h-[28rem] overflow-y-auto mb-4 pr-1">
        {isLoading ? (
          <p className="text-sm text-ink-faint">Loading messages...</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-ink-faint">No messages yet.</p>
        ) : (
          messages.map((m) => {
            const mine = m.sender === user?.id;
            return (
              <div key={m.id}>
                {m.id === dividerBeforeId && (
                  <div className="flex items-center gap-2 my-2" role="separator" aria-label="Unread messages">
                    <div className="flex-1 border-t border-ems-primary/50" />
                    <span className="text-xs font-semibold text-ems-primary">Unread</span>
                    <div className="flex-1 border-t border-ems-primary/50" />
                  </div>
                )}
                <div
                  id={`msg-${m.id}`}
                  className={
                    "rounded-lg px-3 py-2 text-sm border transition-colors " +
                    (highlightId === m.id ? "bg-pill-warningLight border-warning " : mine ? "bg-navy-50 border-navy-100 " : "bg-surface-muted border-line ")
                  }
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-xs text-ink-muted">
                      <span className="font-semibold text-ink">{m.sender_name}</span>
                      {m.is_requester ? " · Requester" : m.sender_role ? ` · ${m.sender_role}` : ""}
                      {" · "}
                      {new Date(m.created_at).toLocaleString()}
                    </p>
                    {m.is_clarification_request && (
                      <span className="text-xs font-semibold text-pill-purple">Clarification requested</span>
                    )}
                  </div>

                  {m.reply_to_summary && (
                    <button
                      type="button"
                      onClick={() => jumpTo(m.reply_to_summary.id)}
                      className="mt-1.5 w-full text-left border-l-2 border-ink-faint bg-surface px-2 py-1 rounded-r text-xs text-ink-muted hover:bg-surface-sunken"
                    >
                      <span className="font-semibold">In reply to {m.reply_to_summary.sender_name}</span>
                      <span className="block truncate">{m.reply_to_summary.excerpt}</span>
                    </button>
                  )}

                  {m.body && <p className="text-ink whitespace-pre-wrap mt-1.5">{m.body}</p>}

                  {m.attachments?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {m.attachments.map((att) =>
                        att.is_image ? (
                          <ImageAttachment key={att.id} att={att} onOpen={setLightbox} />
                        ) : (
                          <button
                            key={att.id}
                            type="button"
                            onClick={() => downloadAttachment(att, showToast)}
                            className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-navy-700 hover:underline"
                            title="Download"
                          >
                            <span className="max-w-[220px] truncate">{att.name}</span>
                            <span className="text-ink-faint">{formatSize(att.size)}</span>
                          </button>
                        )
                      )}
                    </div>
                  )}

                  {canPost && (
                    <div className="mt-1.5 text-right">
                      <button
                        type="button"
                        className="text-xs text-ink-faint hover:text-ems-primary"
                        onClick={() => setReplyTo({ id: m.id, sender_name: m.sender_name, excerpt: m.body || "(attachment)" })}
                      >
                        Reply
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {canPost ? (
        <form onSubmit={send} className="space-y-2">
          {replyTo && (
            <div className="flex items-start justify-between gap-2 border-l-2 border-ems-primary bg-surface-muted px-2 py-1 text-xs text-ink-muted">
              <span className="min-w-0">
                <span className="font-semibold">Replying to {replyTo.sender_name}</span>
                <span className="block truncate">{replyTo.excerpt}</span>
              </span>
              <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply" className="text-ink-faint hover:text-ink">
                ×
              </button>
            </div>
          )}
          <textarea
            className="form-input w-full"
            rows={3}
            placeholder={isRequester ? "Write a message to Communications..." : "Write a message..."}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={4000}
          />
          {files.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="inline-flex items-center gap-2 rounded-full bg-surface-sunken px-3 py-1 text-xs text-ink">
                  <span className="max-w-[180px] truncate">{f.name}</span>
                  <span className="text-ink-faint">{formatSize(f.size)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    className="text-ink-faint hover:text-ink"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-4">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => addFiles(Array.from(e.target.files || []))}
              />
              <button
                type="button"
                className="text-sm text-navy-700 hover:underline disabled:opacity-50"
                disabled={files.length >= MAX_FILES}
                onClick={() => fileInputRef.current?.click()}
              >
                Attach files
              </button>
              {canRequestClarification && (
                <label className="flex items-center gap-2 text-sm text-ink-muted">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-line"
                    checked={isClarification}
                    onChange={(e) => setIsClarification(e.target.checked)}
                  />
                  Request clarification from the requester
                </label>
              )}
            </div>
            <button
              type="submit"
              className="btn-primary px-4 py-1.5 text-sm"
              disabled={isSending || (!draft.trim() && files.length === 0)}
            >
              {isSending ? "Sending..." : isClarification ? "Send Clarification Request" : "Send"}
            </button>
          </div>
          <p className="text-xs text-ink-faint">
            Up to {MAX_FILES} files, 10 MB each: JPG, PNG, WebP, PDF, Word, Excel, PowerPoint, CSV or TXT.
          </p>
        </form>
      ) : isResolved && isParticipant ? (
        <p className="text-sm text-ink-muted border border-line rounded-md bg-surface-muted px-3 py-2">
          This request is {request.status_display}, so the conversation is read-only.{" "}
          {isCommunicationsLead
            ? "Reopen the request above to allow further messages."
            : "The Communications Lead can reopen it to allow further messages."}
        </p>
      ) : !isParticipant ? (
        <p className="text-xs text-ink-faint">
          Only the requester, the assigned team members and the Communications Lead can post messages.
        </p>
      ) : null}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-label={lightbox.name}
        >
          <img src={lightbox.src} alt={lightbox.name} className="max-h-full max-w-full rounded-md" />
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label="Close"
            className="absolute top-4 right-5 text-white text-3xl leading-none"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
